"""stresskit command line.

    python -m stresskit serve            live sensor -> dashboard at http://localhost:8765
    python -m stresskit serve --sim      simulated sensor (no hardware needed)
    python -m stresskit serve --replay data/session-....csv [--speed 4]
    python -m stresskit plot             raw live plot (wiring / signal check)
    python -m stresskit analyze FILE     run the engine over a recording and print what it found
    python -m stresskit ports            list serial ports
    python -m stresskit voice "Hello"    say a line with the Cartesia voice (checks the key and voice)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def cmd_serve(args: argparse.Namespace) -> None:
    from .server import serve

    if args.open:
        import webbrowser

        webbrowser.open(f"http://localhost:{args.http_port}/")
    try:
        asyncio.run(serve(
            port=args.port, sim=args.sim, replay=Path(args.replay) if args.replay else None, speed=args.speed,
            host=args.host, http_port=args.http_port, record=not args.no_record,
            profile_path=Path(args.profile), data_dir=ROOT / "data",
        ))
    except KeyboardInterrupt:
        pass


def cmd_analyze(args: argparse.Namespace) -> None:
    from .engine import StressEngine
    from .replay import read_csv

    eng = StressEngine()
    t0 = None
    for sample, marker in read_csv(args.file):
        t0 = sample.t if t0 is None else t0
        if marker and not marker.startswith(("scr:", "phase:", "level:", "artifact:", "contact:")):
            print(f"{sample.t - t0:8.1f}s  >> {marker}")
        for ev in eng.process(sample.t - t0, sample.u, sample.u_sd):
            kind = ev["type"]
            if kind == "scr":
                print(f"{ev['t']:8.1f}s  SCR  +{ev['amplitude_us']:.3f} uS (rise {ev['rise_s']} s)")
            elif kind in ("phase", "level", "notice", "contact", "open_circuit"):
                detail = {k: v for k, v in ev.items() if k != "type"}
                print(f"{eng.t:8.1f}s  {kind.upper():6s} {detail}")
    st = eng.snapshot()
    print(f"\n{len(eng.scrs)} SCRs, {eng._scr.rejected} rejected as artifacts by shape, "
          f"{eng.n_artifacts} jump artifacts; final state: stress={st['stress']} level={st['level']}")


def cmd_ports(_: argparse.Namespace) -> None:
    from serial.tools import list_ports

    from .device import find_port

    for p in list_ports.comports():
        print(f"{p.device:8s} {p.vid and f'{p.vid:04x}:{p.pid:04x}' or '':10s} {p.description}")
    print(f"auto-detected XIAO: {find_port()}")


def cmd_voice(args: argparse.Namespace) -> None:
    from .cartesia import CartesiaVoice

    async def run() -> None:
        voice = CartesiaVoice.from_env(ROOT / "data")
        try:
            if not voice.configured:
                print("No Cartesia key: set CARTESIA_API_KEY or put it on the first line of data/cartesia.key.")
                return
            path = await voice.speak(args.text)
            print(f"saved {path} (voice {voice.voice_id}, {voice.model})" if path else f"failed: {voice.last_error}")
        finally:
            await voice.close()

    asyncio.run(run())


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m stresskit", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    s = sub.add_parser("serve", help="run the engine + dashboard + WebSocket API")
    src = s.add_mutually_exclusive_group()
    src.add_argument("--port", help="serial port (default: auto-detect the XIAO)")
    src.add_argument("--sim", action="store_true", help="use the built-in simulator instead of hardware")
    src.add_argument("--replay", metavar="CSV", help="replay a recorded session")
    s.add_argument("--speed", type=float, default=1.0, help="sim/replay speed multiplier")
    s.add_argument("--host", default="127.0.0.1", help="bind address (0.0.0.0 to allow other devices)")
    s.add_argument("--http-port", type=int, default=8765)
    s.add_argument("--no-record", action="store_true", help="don't save the session CSV")
    s.add_argument("--profile", default=str(ROOT / "data" / "profile.json"), help="sensor/user calibration file")
    s.add_argument("--open", action="store_true", help="open the dashboard in a browser")
    s.set_defaults(func=cmd_serve)

    p = sub.add_parser("plot", help="raw live plot (matplotlib)")
    p.set_defaults(func=lambda a: __import__("stresskit.liveplot", fromlist=["main"]).main())

    a = sub.add_parser("analyze", help="run the engine over a recorded CSV")
    a.add_argument("file")
    a.set_defaults(func=cmd_analyze)

    sub.add_parser("ports", help="list serial ports").set_defaults(func=cmd_ports)

    v = sub.add_parser("voice", help="say a line with the Cartesia voice (saved under data/voice/)")
    v.add_argument("text", nargs="?", default="Hello. I'm your lantern. Let's take a slow breath together.")
    v.set_defaults(func=cmd_voice)

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    if args.command == "plot":
        sys.argv = [sys.argv[0]]
    args.func(args)


if __name__ == "__main__":
    main()
