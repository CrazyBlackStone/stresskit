"""Serial link to the gsr_stream firmware: port discovery, parsing, auto-reconnect."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable

import serial
from serial.tools import list_ports

SEEED_VID = 0x2886
XIAO_APP_PIDS = {0x8045}  # 0x0045 is the bootloader, which doesn't stream


@dataclass
class Sample:
    t: float  # device time, seconds
    counts: float  # mean ADC counts over the 100 ms window
    counts_sd: float  # std of the 50 conversions inside the window (hum/noise)
    full_scale: int
    host_time: float

    @property
    def u(self) -> float:
        """Sensor output as a fraction of its 3.3 V supply."""
        return self.counts / self.full_scale

    @property
    def u_sd(self) -> float:
        return self.counts_sd / self.full_scale


def find_port() -> str | None:
    for p in list_ports.comports():
        if p.vid == SEEED_VID and p.pid in XIAO_APP_PIDS:
            return p.device
    return None


def parse_header(line: str) -> dict[str, str]:
    return dict(kv.split("=", 1) for kv in line.lstrip("#").split() if "=" in kv)


class SerialReader(threading.Thread):
    """Background thread: finds the XIAO, streams samples to ``on_sample``, reconnects on loss."""

    def __init__(
        self,
        on_sample: Callable[[Sample], None],
        on_status: Callable[[str], None] | None = None,
        port: str | None = None,
        baud: int = 115200,
    ):
        super().__init__(daemon=True, name="gsr-serial")
        self.on_sample = on_sample
        self.on_status = on_status or (lambda s: None)
        self.port = port
        self.baud = baud
        self.full_scale = 16384
        self.connected_port: str | None = None
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        announced_wait = False
        while not self._stop.is_set():
            port = self.port or find_port()
            if port is None:
                if not announced_wait:
                    self.on_status("waiting for XIAO (USB)...")
                    announced_wait = True
                time.sleep(1.0)
                continue
            announced_wait = False
            try:
                with serial.Serial(port, self.baud, timeout=1.0) as ser:
                    self.connected_port = port
                    self.on_status(f"connected on {port}")
                    ser.reset_input_buffer()
                    ser.write(b"i")  # ask for the header (full_scale etc.)
                    self._read_loop(ser)
            except (serial.SerialException, OSError) as exc:
                self.on_status(f"disconnected ({exc.__class__.__name__}); retrying")
            self.connected_port = None
            time.sleep(1.0)

    def _read_loop(self, ser: serial.Serial) -> None:
        last_data = time.time()
        while not self._stop.is_set():
            raw = ser.readline()
            now = time.time()
            if not raw:
                if now - last_data > 3.0:
                    self.on_status("no data from board")
                    last_data = now
                continue
            line = raw.decode("ascii", errors="replace").strip()
            if line.startswith("#"):
                hdr = parse_header(line)
                if "full_scale" in hdr:
                    self.full_scale = int(hdr["full_scale"])
                continue
            parts = line.split(",")
            if len(parts) < 3:
                continue
            try:
                t_ms, counts, sd = int(parts[0]), float(parts[1]), float(parts[2])
            except ValueError:
                continue
            last_data = now
            self.on_sample(Sample(t_ms / 1000.0, counts, sd, self.full_scale, now))
