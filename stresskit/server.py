"""HTTP + WebSocket server: sensor -> StressEngine -> any number of clients (dashboard, game).

    GET  /             live dashboard
    GET  /ws           WebSocket: JSON messages (see README), send {"cmd": ...} to control
    GET  /api/state    latest state snapshot (for engines that prefer polling)
    POST /api/command  {"cmd": "calibrate" | "reference_start" | ...}
"""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

from aiohttp import WSMsgType, web

from . import __version__, conversion
from .device import Sample, SerialReader
from .engine import EngineConfig, Profile, StressEngine
from .replay import read_csv
from .sim import EDASimulator

log = logging.getLogger("stresskit")
WEB_DIR = Path(__file__).resolve().parent / "web"
STATE_HZ = 4.0
HISTORY_S = 180.0


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


class Hub:
    """Owns the engine; fans results out to WebSocket clients. Runs entirely on the event loop."""

    def __init__(self, engine: StressEngine, recorder: Recorder | None, source: str):
        self.engine = engine
        self.recorder = recorder
        self.source = source
        self.device_status = "starting"
        self.clients: set[asyncio.Queue] = set()
        self.history: deque[dict] = deque()
        self.recent_events: deque[dict] = deque(maxlen=200)
        self.sim: EDASimulator | None = None
        self.last_sample_at = 0.0
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
            }
        return snap

    def broadcast(self, msg: dict) -> None:
        dead = []
        for q in self.clients:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)  # client stopped reading; drop it rather than buffer forever
        for q in dead:
            self.clients.discard(q)

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
            self.broadcast({"type": "mark", "time": round(time.time(), 3), "t": round(eng.t, 2), "label": label})
            result = {"ok": True}
        elif cmd == "sim":
            if self.sim is None:
                return {"ok": False, "error": "not running the simulator"}
            if "stress" in msg:
                self.sim.manual_stress = None if msg["stress"] is None else max(0.0, min(1.0, float(msg["stress"])))
            if "contact" in msg:
                self.sim.manual_contact = None if msg["contact"] is None else bool(msg["contact"])
            if msg.get("auto"):
                self.sim.manual_stress = self.sim.manual_contact = None
            result = {"ok": True}
        elif cmd == "state":
            return {"ok": True, "state": self.state()}
        else:
            return {"ok": False, "error": f"unknown cmd {cmd!r}"}
        self.broadcast(self.state())
        return result


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


def build_app(hub: Hub) -> web.Application:
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

    async def index(_: web.Request) -> web.StreamResponse:
        return web.FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    async def api_state(_: web.Request) -> web.Response:
        return web.json_response(hub.state())

    async def api_command(request: web.Request) -> web.Response:
        try:
            msg = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"ok": False, "error": "body must be JSON"}, status=400)
        try:
            return web.json_response(hub.command(msg))
        except (KeyError, ValueError, TypeError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)

    async def ws_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20.0)
        await ws.prepare(request)
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        await ws.send_json(hub.hello())
        hub.clients.add(queue)

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
                    reply = hub.command(data)
                except (json.JSONDecodeError, KeyError, ValueError, TypeError) as exc:
                    data, reply = {}, {"ok": False, "error": str(exc)}
                await ws.send_json({"type": "ack", "cmd": data.get("cmd"), "id": data.get("id"), **reply})
        finally:
            hub.clients.discard(queue)
            sender.cancel()
        return ws

    app = web.Application(middlewares=[cors])
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/state", api_state)
    app.router.add_post("/api/command", api_command)
    app.router.add_route("OPTIONS", "/api/command", api_state)
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
    recorder = None
    if record:
        tag = "sim" if sim else "replay" if replay else "session"
        recorder = Recorder(data_dir / time.strftime(f"{tag}-%Y%m%d-%H%M%S.csv"))
    source = "simulator" if sim else f"replay:{replay.name}" if replay else "serial"
    hub = Hub(engine, recorder, source)

    app = build_app(hub)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, host, http_port).start()
    url = f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{http_port}"
    print(f"stresskit {__version__}: dashboard {url}/   websocket ws://{url.split('://')[1]}/ws", flush=True)
    if recorder:
        print(f"recording to {recorder.path}", flush=True)

    loop = asyncio.get_running_loop()
    tasks: list[asyncio.Task] = []
    reader: SerialReader | None = None
    if sim:
        tasks.append(asyncio.create_task(run_sim(hub, EDASimulator(), speed)))
    elif replay:
        tasks.append(asyncio.create_task(run_replay(hub, replay, speed)))
    else:
        reader = SerialReader(
            lambda s: loop.call_soon_threadsafe(hub.on_sample, s),
            lambda msg: loop.call_soon_threadsafe(hub.set_status, msg),
            port=port,
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
        await runner.cleanup()
