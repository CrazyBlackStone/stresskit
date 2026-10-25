"""HTTP + WebSocket server: sensor -> StressEngine -> any number of clients (dashboard, game).

    GET  /             live dashboard
    GET  /game         Lantern, the calming game
    GET  /nurse        caregiver view of a game session
    GET  /ws           WebSocket: JSON messages (see README), send {"cmd": ...} to control
    GET  /api/state    latest state snapshot (for engines that prefer polling)
    GET  /api/imu      latest IMU / finger-tracing sample
    POST /api/command  {"cmd": "calibrate" | "reference_start" | "imu_recenter" | ...}
    GET  /api/voice/status         Cartesia voice: configured or not (see cartesia.py; never the key)
    POST /api/voice/say            {"text"} -> audio/mpeg in the Lantern's voice, or 503 (no Cartesia)
    POST /api/voice/transcribe     audio body (webm/ogg/wav...) -> {"text"} via Cartesia speech-to-text, or 503
"""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import math
import random
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

from aiohttp import WSMsgType, web

from . import __version__, conversion
from .cartesia import CartesiaVoice
from .device import ImuSample, Sample, SerialReader
from .engine import EngineConfig, Profile, StressEngine
from .motion import AXES, MotionTracker
from .replay import read_csv
from .sim import EDASimulator, MotionSimulator

log = logging.getLogger("stresskit")
WEB_DIR = Path(__file__).resolve().parent / "web"
STATE_HZ = 4.0
HISTORY_S = 180.0
STRESS_HISTORY_S = 3 * 3600.0  # 1 Hz stress log for the caregiver view
MOVING_GYRO_DPS = 20.0
MOVING_ACCEL_G = 0.06


class Recorder:
    """One CSV row per sample, plus markers/events; readable by replay.read_csv."""

    COLS = ["host_time", "t_ms", "counts", "counts_sd", "full_scale", "u", "eda_us", "contact", "valid",
            "signal", "phase", "stress", "level", "stressed", "scl_us", "scr_rate", "marker"]

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._f = path.open("w", newline="")
        self._w = csv.writer(self._f)
        self._w.writerow(self.COLS)
        self._markers: list[str] = []
        self._n = 0

    def mark(self, text: str) -> None:
        self._markers.append(text.replace(",", ";"))

    def write(self, s: Sample, eng: StressEngine) -> None:
        if self._f.closed:  # a sample queued by the serial thread can land after shutdown
            return

        def f(x, nd=4):
            return "" if x is None or x != x else f"{x:.{nd}f}"
        scl = eng._tonic.median() if len(eng._tonic) else None
        self._w.writerow([
            f"{s.host_time:.3f}", int(round(s.t * 1000)), f"{s.counts:.2f}", f"{s.counts_sd:.2f}", s.full_scale,
            f"{s.u:.5f}", f(eng.y), int(eng.contact), int(eng.signal == "ok"), eng.signal, eng.phase,
            f(eng.stress, 1), eng.level, int(eng.stressed), f(scl), f"{eng._rate.rate:.2f}", "|".join(self._markers),
        ])
        self._markers.clear()
        self._n += 1
        if self._n % 20 == 0:
            self._f.flush()

    def close(self) -> None:
        self._f.close()


class ImuRecorder:
    """Raw IMU plus the tracing cursor, one row per IMU sample (~104 Hz)."""

    COLS = ["host_time", "t", "ax", "ay", "az", "gx", "gy", "gz", "px", "py", "valid", "still"]

    def __init__(self, path: Path):
        self.path = path
        self._f = path.open("w", newline="")
        self._w = csv.writer(self._f)
        self._w.writerow(self.COLS)
        self._n = 0

    def write(self, s: ImuSample, msg: dict) -> None:
        if self._f.closed:
            return
        p = msg["pointer"]
        self._w.writerow([f"{s.host_time:.3f}", f"{s.t:.6f}", *(f"{v:.4f}" for v in s.accel),
                          *(f"{v:.3f}" for v in s.gyro), p["x"], p["y"], int(p["valid"]), int(msg["still"])])
        self._n += 1
        if self._n % 100 == 0:
            self._f.flush()

    def close(self) -> None:
        self._f.close()


class Hub:
    """Owns the engine; fans results out to WebSocket clients. Runs entirely on the event loop."""

    def __init__(self, engine: StressEngine, recorder: Recorder | None, source: str,
                 imu_recorder: ImuRecorder | None = None):
        self.engine = engine
        self.recorder = recorder
        self.imu_recorder = imu_recorder
        self.source = source
        self.device_status = "starting"
        self.clients: dict[asyncio.Queue, dict] = {}  # queue -> subscription prefs
        self.history: deque[dict] = deque()
        self.recent_events: deque[dict] = deque(maxlen=200)
        self.stress_history: deque[list] = deque()  # [time, stress, level, reliable] at 1 Hz
        self.marks: deque[dict] = deque(maxlen=1000)
        self._next_stress_log = 0.0
        self.sim: EDASimulator | None = None
        self.motion_sim: MotionSimulator | None = None
        self.motion = MotionTracker(forward=engine.profile.imu_forward or AXES["+x"])
        self.last_sample_at = 0.0
        self.last_imu_at = 0.0
        # Simulated EDA has no motion artifacts, so only gate SCRs on real hardware.
        self.motion_gating = source == "serial"
        self._t_offset: float | None = None
        self._next_state = 0.0

    # -------------------------------------------------------------- data in

    def on_sample(self, s: Sample) -> None:
        if self._t_offset is None:
            self._t_offset = s.t
        eng = self.engine
        events = eng.process(s.t - self._t_offset, s.u, s.u_sd)
        self.last_sample_at = s.host_time
        if self.recorder:
            for e in events:
                if e["type"] == "scr":
                    self.recorder.mark(f"scr:{e['amplitude_us']}")
                elif e["type"] in ("phase", "level", "artifact", "contact", "notice", "reference"):
                    self.recorder.mark(f"{e['type']}:{e.get('phase') or e.get('level') or e.get('contact', '')}")
            self.recorder.write(s, eng)
        now = s.host_time
        for e in events:
            e["time"] = round(now, 3)
            if e["type"] == "sample":
                self.history.append(e)
                while self.history and now - self.history[0]["time"] > HISTORY_S:
                    self.history.popleft()
            else:
                self.recent_events.append(e)
            self.broadcast(e)
        if now >= self._next_state:
            self._next_state = now + 1.0 / STATE_HZ
            self.broadcast(self.state())
        if now >= self._next_stress_log:
            self._next_stress_log = now + 1.0
            self.stress_history.append([round(now, 1), _r1(eng.stress), eng.level,
                                        eng.phase == "ready" and eng.signal == "ok"])
            while self.stress_history and now - self.stress_history[0][0] > STRESS_HISTORY_S:
                self.stress_history.popleft()

    def on_imu(self, s: ImuSample) -> None:
        msg = self.motion.update(s)
        self.last_imu_at = s.host_time
        if self.motion_gating and _moving(msg):
            self.engine.note_motion()
        msg["time"] = round(s.host_time, 3)
        if self.imu_recorder:
            self.imu_recorder.write(s, msg)
        self.broadcast(msg)

    def set_status(self, status: str) -> None:
        self.device_status = status
        log.info("device: %s", status)
        self.broadcast({"type": "status", "time": round(time.time(), 3), "device": status})

    # -------------------------------------------------------------- data out

    def state(self) -> dict:
        snap = self.engine.snapshot()
        snap["time"] = round(time.time(), 3)
        snap["device"] = {
            "source": self.source,
            "status": self.device_status,
            "streaming": time.time() - self.last_sample_at < 1.5,
        }
        if self.sim is not None:
            snap["device"]["sim"] = {
                "segment": self.sim.label,
                "stress": self.sim.manual_stress,
                "contact": self.sim.manual_contact,
                "motion": self.motion_sim.current_pattern() if self.motion_sim else None,
            }
        snap["imu"] = {
            "present": self.last_imu_at > 0,
            "streaming": time.time() - self.last_imu_at < 1.0,
            **self.motion.status(),
        }
        return snap

    def broadcast(self, msg: dict) -> None:
        kind = msg.get("type")
        dead = []
        for q, prefs in self.clients.items():
            if (kind == "imu" and not prefs["imu"]) or (kind == "sample" and not prefs["samples"]):
                continue
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)  # client stopped reading; drop it rather than buffer forever
        for q in dead:
            self.clients.pop(q, None)

    def hello(self) -> dict:
        cfg = self.engine.cfg
        return {
            "type": "hello",
            "version": __version__,
            "source": self.source,
            "fs": cfg.fs,
            "thresholds": {"calm_below": cfg.calm_below, "enter_stressed": cfg.enter_stressed,
                           "exit_stressed": cfg.exit_stressed},
            "history": list(self.history),
            "events": [e for e in self.recent_events if e["type"] == "scr"],
            "stress_history": list(self.stress_history),
            "marks": list(self.marks),
            "state": self.state(),
        }

    # -------------------------------------------------------------- commands

    def command(self, msg: dict) -> dict:
        eng, cmd = self.engine, msg.get("cmd")
        if cmd == "calibrate":
            eng.start_baseline()
            result: dict[str, Any] = {"ok": True}
        elif cmd == "open_circuit":
            eng.capture_open_circuit(float(msg.get("seconds", 2.0)))
            result = {"ok": True, "note": "keep fingers off the electrodes for 2 s"}
        elif cmd == "reference_start":
            result = eng.start_reference()
        elif cmd == "reference_stop":
            result = eng.stop_reference(apply=bool(msg.get("apply", True)))
        elif cmd == "reference_cancel":
            eng._reference = None
            result = {"ok": True}
        elif cmd == "reset_personalization":
            eng.clear_personalization()
            result = {"ok": True}
        elif cmd == "resistor":
            ohms = float(msg["ohms"])
            b = conversion.offset_from_resistor(eng.u, ohms)
            if not 0.0 <= b <= 0.5:
                result = {"ok": False, "error": f"implausible offset {b:.3f}; is the resistor across the electrodes?"}
            else:
                eng.set_offset(b, "resistor")
                result = {"ok": True, "b": round(b, 4)}
        elif cmd == "mark":
            label = str(msg.get("label", "mark"))[:80]
            if self.recorder:
                self.recorder.mark(f"mark:{label}")
            mark = {"type": "mark", "time": round(time.time(), 3), "t": round(eng.t, 2), "label": label}
            self.marks.append(mark)
            self.broadcast(mark)
            result = {"ok": True}
        elif cmd == "expect_response":
            result = eng.expect_response(float(msg["seconds"]) if "seconds" in msg else None)
            if self.sim is not None and random.random() < 0.85:
                # Simulated wearer: a big breath usually produces an SCR 1-2.5 s later.
                self.sim.responses.append((self.sim.t + random.uniform(1.0, 2.5), random.uniform(0.12, 0.3)))
            if self.recorder:
                self.recorder.mark("cue:breath")
        elif cmd == "imu_recenter":
            result = self.motion.recenter()
        elif cmd == "imu_forward":
            axis = msg.get("axis", "point_up")
            if axis == "point_up":
                result = self.motion.forward_from_gravity()
            elif isinstance(axis, str) and axis in AXES or isinstance(axis, list) and len(axis) == 3:
                result = self.motion.set_forward(axis)
            else:
                return {"ok": False, "error": "axis must be 'point_up', one of +x -x +y -y +z -z, or [x, y, z]"}
            if result["ok"]:
                eng.profile.imu_forward = result["forward"]
                eng._profile_changed()
        elif cmd == "imu_range":
            if "x_deg" in msg:
                self.motion.cfg.range_x_deg = max(2.0, float(msg["x_deg"]))
            if "y_deg" in msg:
                self.motion.cfg.range_y_deg = max(2.0, float(msg["y_deg"]))
            result = {"ok": True, **self.motion.status()["range_deg"]}
        elif cmd == "sim":
            if self.sim is None:
                return {"ok": False, "error": "not running the simulator"}
            if "stress" in msg:
                self.sim.manual_stress = None if msg["stress"] is None else max(0.0, min(1.0, float(msg["stress"])))
            if "contact" in msg:
                self.sim.manual_contact = None if msg["contact"] is None else bool(msg["contact"])
            if msg.get("motion") in ("auto", "still", "figure8", "circle") and self.motion_sim:
                self.motion_sim.pattern = msg["motion"]
            if msg.get("auto"):
                self.sim.manual_stress = self.sim.manual_contact = None
                if self.motion_sim:
                    self.motion_sim.pattern = "auto"
            result = {"ok": True}
        elif cmd == "state":
            return {"ok": True, "state": self.state()}
        else:
            return {"ok": False, "error": f"unknown cmd {cmd!r}"}
        self.broadcast(self.state())
        return result


def _r1(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def _moving(imu: dict) -> bool:
    """Hand motion big enough to shift the electrodes; looser than the tracker's 'still'."""
    gyro = math.sqrt(sum(c * c for c in imu["gyro"]))
    lin = math.sqrt(sum(c * c for c in imu["lin_accel"]))
    return gyro > MOVING_GYRO_DPS or lin > MOVING_ACCEL_G


# ------------------------------------------------------------------ sources


async def run_sim(hub: Hub, sim: EDASimulator, speed: float) -> None:
    hub.sim = sim
    hub.set_status("simulator")
    period = 1.0 / sim.fs
    next_t = time.monotonic()
    while True:
        t, counts, sd = sim.step()
        hub.on_sample(Sample(t, counts, sd, sim.full_scale, time.time()))
        next_t += period / speed
        await asyncio.sleep(max(0.0, next_t - time.monotonic()))


async def run_motion_sim(hub: Hub, sim: MotionSimulator, speed: float) -> None:
    hub.motion_sim = sim
    next_t = time.monotonic()
    while True:
        hub.on_imu(sim.step(time.time()))
        next_t += sim.dt / speed
        await asyncio.sleep(max(0.0, next_t - time.monotonic()))


async def run_replay(hub: Hub, path: Path, speed: float) -> None:
    hub.set_status(f"replaying {path.name}")
    prev_t = None
    for sample, _marker in read_csv(path):
        if prev_t is not None:
            await asyncio.sleep(max(0.0, (sample.t - prev_t) / speed))
        prev_t = sample.t
        sample.host_time = time.time()
        hub.on_sample(sample)
    hub.set_status("replay finished")


# ------------------------------------------------------------------ web app


def build_app(hub: Hub, voice: CartesiaVoice | None = None) -> web.Application:
    voice = voice or CartesiaVoice(None, Path("data") / "voice")  # no key: the game falls back on its own
    @web.middleware
    async def cors(request: web.Request, handler: Callable) -> web.StreamResponse:
        if request.method == "OPTIONS":
            resp: web.StreamResponse = web.Response()
        else:
            resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return resp

    def page(name: str) -> Callable:
        async def handler(_: web.Request) -> web.StreamResponse:
            return web.FileResponse(WEB_DIR / name, headers={"Cache-Control": "no-cache"})
        return handler

    async def lantern_file(request: web.Request) -> web.StreamResponse:
        path = WEB_DIR / "lantern" / request.match_info["name"]  # the route pattern rules out ../
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={"Cache-Control": "no-cache", "Content-Type": "text/javascript"})

    async def api_state(_: web.Request) -> web.Response:
        return web.json_response(hub.state())

    async def api_imu(_: web.Request) -> web.Response:
        return web.json_response(hub.motion.last or {"type": "imu", "present": False})

    async def api_command(request: web.Request) -> web.Response:
        try:
            msg = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"ok": False, "error": "body must be JSON"}, status=400)
        try:
            return web.json_response(hub.command(msg))
        except (KeyError, ValueError, TypeError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    async def voice_status(_: web.Request) -> web.Response:
        return web.json_response(voice.status())

    async def voice_say(request: web.Request) -> web.StreamResponse:
        try:
            text = " ".join(str((await request.json())["text"]).split())
        except (json.JSONDecodeError, KeyError, TypeError):
            return web.json_response({"ok": False, "error": "body must be {\"text\": ...}"}, status=400)
        if not text or len(text) > 300:
            return web.json_response({"ok": False, "error": "text must be 1-300 characters"}, status=400)
        path = await voice.speak(text)
        if path is None:
            return web.json_response({"ok": False, "error": voice.last_error or "Cartesia not configured"}, status=503)
        return web.FileResponse(path, headers={"Content-Type": "audio/mpeg", "Cache-Control": "max-age=86400"})

    async def voice_transcribe(request: web.Request) -> web.Response:
        audio = await request.read()  # a few seconds of speech: well under the 1 MB body limit
        text = await voice.transcribe(audio, request.headers.get("Content-Type", "audio/webm"))
        if text is None:
            return web.json_response({"ok": False, "error": voice.last_error or "Cartesia not configured"}, status=503)
        return web.json_response({"ok": True, "text": text})

    async def close_voice(_: web.Application) -> None:
        await voice.close()

    async def ws_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20.0)
        await ws.prepare(request)
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        prefs = {"imu": True, "samples": True}
        await ws.send_json(hub.hello())
        hub.clients[queue] = prefs

        async def pump() -> None:
            while True:
                await ws.send_json(await queue.get())

        sender = asyncio.create_task(pump())
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                    if data.get("cmd") == "subscribe":  # per-connection: {"imu": false} drops the 104 Hz stream
                        for key in prefs:
                            if key in data:
                                prefs[key] = bool(data[key])
                        reply = {"ok": True, **prefs}
                    else:
                        reply = hub.command(data)
                except (json.JSONDecodeError, KeyError, ValueError, TypeError) as exc:
                    data, reply = {}, {"ok": False, "error": str(exc)}
                await ws.send_json({"type": "ack", "cmd": data.get("cmd"), "id": data.get("id"), **reply})
        finally:
            hub.clients.pop(queue, None)
            sender.cancel()
        return ws

    app = web.Application(middlewares=[cors])
    app.router.add_get("/", page("index.html"))
    app.router.add_get("/game", page("game.html"))
    app.router.add_get("/nurse", page("nurse.html"))
    app.router.add_get("/lantern/{name:[a-z0-9_-]+\\.js}", lantern_file)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/state", api_state)
    app.router.add_get("/api/imu", api_imu)
    app.router.add_post("/api/command", api_command)
    app.router.add_route("OPTIONS", "/api/command", api_state)
    app.router.add_get("/api/voice/status", voice_status)
    app.router.add_post("/api/voice/say", voice_say)
    app.router.add_post("/api/voice/transcribe", voice_transcribe)
    app.on_cleanup.append(close_voice)
    return app


async def serve(
    *,
    port: str | None,
    sim: bool,
    replay: Path | None,
    speed: float,
    host: str,
    http_port: int,
    record: bool,
    profile_path: Path,
    data_dir: Path,
    config: EngineConfig | None = None,
) -> None:
    profile = Profile() if sim else Profile.load(profile_path)
    engine = StressEngine(config, profile, on_profile_change=None if sim else (lambda p: p.save(profile_path)))
    recorder = imu_recorder = None
    if record:
        tag = "sim" if sim else "replay" if replay else "session"
        stem = time.strftime(f"{tag}-%Y%m%d-%H%M%S")
        recorder = Recorder(data_dir / f"{stem}.csv")
        if not replay:
            imu_recorder = ImuRecorder(data_dir / f"{stem}-imu.csv")
    source = "simulator" if sim else f"replay:{replay.name}" if replay else "serial"
    hub = Hub(engine, recorder, source, imu_recorder)

    voice = CartesiaVoice.from_env(data_dir)
    app = build_app(hub, voice)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, host, http_port).start()
    url = f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{http_port}"
    print(f"stresskit {__version__}: dashboard {url}/   websocket ws://{url.split('://')[1]}/ws", flush=True)
    if recorder:
        print(f"recording to {recorder.path}", flush=True)
    print("Cartesia voice: " + (f"on (voice {voice.voice_id}, {voice.model})" if voice.configured else
          "off (set CARTESIA_API_KEY or put the key in data/cartesia.key; the game falls back meanwhile)"), flush=True)

    loop = asyncio.get_running_loop()
    tasks: list[asyncio.Task] = []
    reader: SerialReader | None = None
    if sim:
        tasks.append(asyncio.create_task(run_sim(hub, EDASimulator(), speed)))
        tasks.append(asyncio.create_task(run_motion_sim(hub, MotionSimulator(), speed)))
    elif replay:
        tasks.append(asyncio.create_task(run_replay(hub, replay, speed)))
    else:
        reader = SerialReader(
            lambda s: loop.call_soon_threadsafe(hub.on_sample, s),
            lambda msg: loop.call_soon_threadsafe(hub.set_status, msg),
            port=port,
            on_imu=lambda s: loop.call_soon_threadsafe(hub.on_imu, s),
        )
        reader.start()

    try:
        while True:
            await asyncio.sleep(5.0)
            st = hub.state()
            stress = "--" if st["stress"] is None else f"{st['stress']:5.1f}"
            print(
                f"[{time.strftime('%H:%M:%S')}] {st['phase']:15s} signal={st['signal']:12s} stress={stress} "
                f"{st['level']:8s} SCL={st['scl_us']} uS ({st['scl_change_pct']}%) SCR/min={st['scr_rate_per_min']} "
                f"q={st['quality']} clients={len(hub.clients)}",
                flush=True,
            )
    finally:
        for t in tasks:
            t.cancel()
        if reader:
            reader.stop()
        if recorder:
            recorder.close()
        if imu_recorder:
            imu_recorder.close()
        await runner.cleanup()
