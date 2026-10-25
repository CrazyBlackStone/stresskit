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


@dataclass
class ImuSample:
    t: float  # device time, seconds (wraps every ~71 min; use differences)
    accel: tuple[float, float, float]  # g, board frame
    gyro: tuple[float, float, float]  # deg/s, board frame
    host_time: float


def find_port() -> str | None:
    for p in list_ports.comports():
        if p.vid == SEEED_VID and p.pid in XIAO_APP_PIDS:
            return p.device
    return None


def parse_header(line: str) -> dict[str, str]:
    return dict(kv.split("=", 1) for kv in line.lstrip("#").split() if "=" in kv)


class LineParser:
    """Turns firmware lines into Sample / ImuSample objects; header lines update the scales."""

    def __init__(self) -> None:
        self.full_scale = 16384
        self.accel_scale = 0.000122  # g per LSB (+-4 g)
        self.gyro_scale = 0.035  # dps per LSB (+-1000 dps)
        self.imu: str | None = None

    def parse(self, line: str, now: float) -> Sample | ImuSample | None:
        if line.startswith("#"):
            hdr = parse_header(line)
            if "full_scale" in hdr:
                self.full_scale = int(hdr["full_scale"])
            if "imu" in hdr:
                self.imu = None if hdr["imu"] == "none" else hdr["imu"]
            if "accel_g_per_lsb" in hdr:
                self.accel_scale = float(hdr["accel_g_per_lsb"])
            if "gyro_dps_per_lsb" in hdr:
                self.gyro_scale = float(hdr["gyro_dps_per_lsb"])
            return None
        parts = line.split(",")
        try:
            if parts[0] == "I" and len(parts) == 8:
                v = [int(x) for x in parts[2:]]
                a, g = self.accel_scale, self.gyro_scale
                return ImuSample(int(parts[1]) / 1e6, (v[0] * a, v[1] * a, v[2] * a),
                                 (v[3] * g, v[4] * g, v[5] * g), now)
            if len(parts) >= 3:
                return Sample(int(parts[0]) / 1000.0, float(parts[1]), float(parts[2]), self.full_scale, now)
        except ValueError:
            pass
        return None


class SerialReader(threading.Thread):
    """Background thread: finds the XIAO, streams samples to the callbacks, reconnects on loss."""

    def __init__(
        self,
        on_sample: Callable[[Sample], None],
        on_status: Callable[[str], None] | None = None,
        port: str | None = None,
        baud: int = 115200,
        on_imu: Callable[[ImuSample], None] | None = None,
    ):
        super().__init__(daemon=True, name="gsr-serial")
        self.on_sample = on_sample
        self.on_imu = on_imu
        self.on_status = on_status or (lambda s: None)
        self.port = port
        self.baud = baud
        self.parser = LineParser()
        self.connected_port: str | None = None
        self._stop = threading.Event()

    @property
    def full_scale(self) -> int:
        return self.parser.full_scale

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
                    ser.write(b"i")  # ask for the header (scales, IMU presence)
                    self._read_loop(ser)
            except (serial.SerialException, OSError) as exc:
                if getattr(exc, "errno", None) == 13:
                    self.on_status(f"permission denied on {port} (Linux: add yourself to the dialout group); retrying")
                else:
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
            item = self.parser.parse(raw.decode("ascii", errors="replace").strip(), now)
            if isinstance(item, Sample):
                last_data = now
                self.on_sample(item)
            elif isinstance(item, ImuSample) and self.on_imu is not None:
                self.on_imu(item)
