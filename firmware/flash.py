"""Build and upload gsr_stream to the XIAO nRF52840 with arduino-cli.

    python firmware/flash.py            # compile + upload (auto-detects the board)
    python firmware/flash.py --port COM4
    python firmware/flash.py --compile-only

Needs arduino-cli with the "Seeeduino:nrf52" core (see README). The Seeed core passes the
sketch folder to the compiler unquoted, which breaks on paths with spaces ("cal hacks"),
so this overrides those three flags with a quoted include path.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FQBN = "Seeeduino:nrf52:xiaonRF52840Sense"
SKETCH = Path(__file__).resolve().parent / "gsr_stream"


def find_cli() -> str:
    cli = shutil.which("arduino-cli")
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "arduino-cli" / "arduino-cli.exe"
    if cli:
        return cli
    if local.exists():
        return str(local)
    sys.exit("arduino-cli not found: install it and the Seeeduino:nrf52 core (see README)")


def quoted_flag_overrides() -> list[str]:
    root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Arduino15" / "packages" / "Seeeduino" / "hardware" / "nrf52"
    versions = sorted(root.glob("*/platform.txt"))
    if not versions:
        return []
    text = versions[-1].read_text()
    args = []
    for key in ("compiler.c.flags", "compiler.S.flags", "compiler.cpp.flags"):
        m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.M)
        if m and '"-I{build.source.path}"' not in m.group(1):
            args += ["--build-property", f"{key}=" + m.group(1).replace("-I{build.source.path}", '"-I{build.source.path}"')]
    return args


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", help="serial port (default: auto-detect)")
    ap.add_argument("--compile-only", action="store_true")
    args = ap.parse_args()
    cli = find_cli()
    build = SKETCH / "build"
    subprocess.run([cli, "compile", "--fqbn", FQBN, *quoted_flag_overrides(), "--output-dir", str(build), str(SKETCH)],
                   check=True)
    if args.compile_only:
        return
    port = args.port
    if not port:
        sys.path.insert(0, str(SKETCH.parent.parent))
        from stresskit.device import find_port

        port = find_port()
    if not port:
        sys.exit("XIAO not found: plug it in with a data cable, or double-tap its reset button and pass --port")
    subprocess.run([cli, "upload", "-p", port, "--fqbn", FQBN, "--input-dir", str(build), str(SKETCH)], check=True)
    print(f"flashed {port}")


if __name__ == "__main__":
    main()
