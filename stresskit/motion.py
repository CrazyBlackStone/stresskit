"""Finger tracing from the XIAO Sense IMU: orientation fusion and a 2D tracing cursor.

Double-integrating acceleration into finger *position* drifts by metres within seconds, so
tracing uses the finger's *pointing direction* instead, like a laser pointer or an air mouse:

* The gyroscope gives fast, smooth rotation. The accelerometer anchors "down", so roll and
  pitch never drift (Mahony complementary filter).
* The direction the finger points (``forward``, a board-frame vector) is projected onto a
  virtual screen. Left/right is the change in heading, up/down is the change in elevation,
  both measured from the recentred aim.

Heading has no absolute reference (no magnetometer), so three things limit slow drift:
automatic gyro-bias calibration whenever the board is still, freezing rotation while still,
and an explicit recenter.

``forward`` depends on how the board sits on the finger. Point the finger at the ceiling and
call :meth:`MotionTracker.forward_from_gravity` (dashboard: "Set pointing axis") to learn it.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from .device import ImuSample

AXES = {"+x": (1.0, 0.0, 0.0), "-x": (-1.0, 0.0, 0.0), "+y": (0.0, 1.0, 0.0),
        "-y": (0.0, -1.0, 0.0), "+z": (0.0, 0.0, 1.0), "-z": (0.0, 0.0, -1.0)}
DEG = math.pi / 180.0


@dataclass
class MotionConfig:
    kp: float = 1.5  # accelerometer correction gain (rad/s per unit of tilt error)
    accel_gate_g: float = 0.12  # skip the correction while | |a| - 1 g | exceeds this (hand accelerating)
    still_window_s: float = 0.5
    still_gyro_dps: float = 0.8  # per-axis std over the window
    still_rate_dps: float = 2.0  # mean rate must be this close to the learned bias
    max_gyro_offset_dps: float = 12.0  # before calibration: LSM6DS3 zero-rate offset is within +-10 dps
    still_accel_g: float = 0.01
    bias_tau_s: float = 2.0  # gyro-bias tracking time constant while still
    range_x_deg: float = 25.0  # heading change that moves the cursor from centre to the edge
    range_y_deg: float = 15.0  # elevation change that moves it from centre to the top/bottom
    max_dt_s: float = 0.1  # longer gaps restart integration instead of integrating a jump


def _norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v) if n > 1e-9 else (0.0, 0.0, 0.0)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _rotate(q, v):
    """Rotate board-frame vector v into the world frame (q maps board -> world, world z = up)."""
    w, x, y, z = q
    return (
        (1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2],
        2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2],
        2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2],
    )


def _wrap_deg(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


class MotionTracker:
    def __init__(self, config: MotionConfig | None = None, forward=(1.0, 0.0, 0.0)):
        self.cfg = config or MotionConfig()
        self.forward = _norm(forward)
        self.q: tuple[float, float, float, float] | None = None
        self.bias = [0.0, 0.0, 0.0]
        self.bias_ok = False
        self.still = False
        self.rate_hz = 0.0
        self.clock = 0.0
        self._t_prev: float | None = None
        self._win: deque = deque()
        self._center: tuple[float, float] | None = None
        self._center_pending = True
        self.last: dict | None = None

    # ------------------------------------------------------------------ commands

    def recenter(self) -> dict:
        """Make the current aim the centre of the cursor space."""
        aim = self._aim()
        if aim is None:
            self._center_pending = True
            return {"ok": True, "note": "will centre on the next still moment"}
        if abs(aim[1]) > 75.0:
            return {"ok": False, "error": "pointing almost straight up/down; aim at the screen first"}
        self._center = aim
        self._center_pending = False
        return {"ok": True}

    def set_forward(self, vec) -> dict:
        self.forward = _norm(AXES[vec] if isinstance(vec, str) else vec)
        self._center, self._center_pending = None, True
        return {"ok": True, "forward": [round(c, 4) for c in self.forward]}

    def forward_from_gravity(self) -> dict:
        """The finger is pointing at the ceiling right now: that board direction is 'forward'."""
        if not self.still or not self._win:
            return {"ok": False, "error": "hold the finger still, pointing straight up, then try again"}
        n = len(self._win)
        up = tuple(sum(a[i] for _, a, _ in self._win) / n for i in range(3))
        return self.set_forward(up)

    # ------------------------------------------------------------------ processing

    def update(self, s: ImuSample) -> dict:
        cfg = self.cfg
        dt = None
        if self._t_prev is not None:
            dt = s.t - self._t_prev
            if dt < 0:
                dt += 2**32 / 1e6  # micros() wrapped
            if not 0.0 < dt <= cfg.max_dt_s:
                dt = None
        self._t_prev = s.t
        if dt:
            self.clock += dt
            self.rate_hz += (1.0 / dt - self.rate_hz) * (0.05 if self.rate_hz else 1.0)

        a, g_raw = s.accel, s.gyro
        self._update_still(a, g_raw)
        if self.still:
            # Board at rest: whatever the gyro reads is bias. Track it, and don't rotate.
            n = len(self._win)
            mean = [sum(g[i] for _, _, g in self._win) / n for i in range(3)]
            if not self.bias_ok:
                self.bias, self.bias_ok = mean, True
            elif dt:
                k = 1.0 - math.exp(-dt / cfg.bias_tau_s)
                self.bias = [b + (m - b) * k for b, m in zip(self.bias, mean)]
        gyro = (0.0, 0.0, 0.0) if self.still else tuple(gr - b for gr, b in zip(g_raw, self.bias))

        a_mag = math.sqrt(sum(c * c for c in a))
        if self.q is None:
            self.q = self._from_gravity(a)
        elif dt:
            self._integrate(gyro, a, a_mag, dt)

        if self._center_pending and self.still:
            self.recenter()
        return self._message(s, a, gyro)

    def _update_still(self, a, g) -> None:
        cfg, w = self.cfg, self._win
        w.append((self.clock, a, g))
        while w and self.clock - w[0][0] > cfg.still_window_s:
            w.popleft()
        expected = cfg.still_window_s * (self.rate_hz or 104.0)
        if len(w) < 0.8 * expected:
            self.still = False
            return

        def std(i, idx):
            vals = [item[idx][i] for item in w]
            m = sum(vals) / len(vals)
            return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))

        a_mag = math.sqrt(sum(c * c for c in a))
        # Low variance alone isn't enough: a steady-rate turn is just as smooth. The mean rate must
        # also match the learned bias (or, before calibration, be within the gyro's offset spec).
        mean = [sum(item[2][i] for item in w) / len(w) for i in range(3)]
        offset = math.sqrt(sum((m - b) ** 2 for m, b in zip(mean, self.bias))) if self.bias_ok \
            else math.sqrt(sum(m * m for m in mean))
        self.still = (
            abs(a_mag - 1.0) < 0.05
            and offset < (cfg.still_rate_dps if self.bias_ok else cfg.max_gyro_offset_dps)
            and all(std(i, 2) < cfg.still_gyro_dps for i in range(3))
            and all(std(i, 1) < cfg.still_accel_g for i in range(3))
        )

    @staticmethod
    def _from_gravity(a):
        """Orientation with zero heading whose board 'up' (the accel direction) maps to world z."""
        u = _norm(a)
        w = 1.0 + u[2]  # dot(u, z)
        if w < 1e-6:
            return (0.0, 1.0, 0.0, 0.0)  # upside down: 180 deg about x
        c = _cross(u, (0.0, 0.0, 1.0))
        n = math.sqrt(w * w + c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
        return (w / n, c[0] / n, c[1] / n, c[2] / n)

    def _integrate(self, gyro_dps, a, a_mag, dt) -> None:
        w, x, y, z = self.q
        gx, gy, gz = (c * DEG for c in gyro_dps)
        if abs(a_mag - 1.0) < self.cfg.accel_gate_g:
            ax, ay, az = (c / a_mag for c in a)
            # Estimated "up" in the board frame (third row of the rotation matrix).
            vx, vy, vz = 2 * (x * z - w * y), 2 * (w * x + y * z), w * w - x * x - y * y + z * z
            kp = self.cfg.kp
            gx += kp * (ay * vz - az * vy)
            gy += kp * (az * vx - ax * vz)
            gz += kp * (ax * vy - ay * vx)
        h = 0.5 * dt
        q = (
            w + h * (-x * gx - y * gy - z * gz),
            x + h * (w * gx + y * gz - z * gy),
            y + h * (w * gy - x * gz + z * gx),
            z + h * (w * gz + x * gy - y * gx),
        )
        n = math.sqrt(sum(c * c for c in q))
        self.q = tuple(c / n for c in q)

    def _aim(self) -> tuple[float, float] | None:
        """(heading, elevation) of the pointing direction in degrees."""
        if self.q is None:
            return None
        d = _rotate(self.q, self.forward)
        return math.degrees(math.atan2(d[1], d[0])), math.degrees(math.atan2(d[2], math.hypot(d[0], d[1])))

    def _message(self, s: ImuSample, a, gyro) -> dict:
        cfg, q = self.cfg, self.q
        w, x, y, z = q
        roll = math.degrees(math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)))
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x)))))
        yaw = math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
        aw = _rotate(q, a)
        heading, elev = self._aim()
        valid = self._center is not None and abs(elev) < 75.0
        if valid:
            # Turning right (clockwise seen from above) lowers the heading, so negate for screen x.
            aim_x = -_wrap_deg(heading - self._center[0])
            aim_y = elev - self._center[1]
        else:
            aim_x = aim_y = 0.0
        px = max(-1.0, min(1.0, aim_x / cfg.range_x_deg))
        py = max(-1.0, min(1.0, aim_y / cfg.range_y_deg))
        r = lambda v, nd=4: round(v, nd)  # noqa: E731
        self.last = {
            "type": "imu",
            "t": r(self.clock, 3),
            "accel": [r(c) for c in a],
            "gyro": [r(c, 2) for c in gyro],
            "lin_accel": [r(aw[0]), r(aw[1]), r(aw[2] - 1.0)],
            "quat": [r(c, 5) for c in q],
            "euler_deg": {"roll": r(roll, 2), "pitch": r(pitch, 2), "yaw": r(yaw, 2)},
            "pointer": {"x": r(px), "y": r(py), "valid": valid},
            "aim_deg": {"x": r(aim_x, 2), "y": r(aim_y, 2)},
            "still": self.still,
        }
        return self.last

    def status(self) -> dict:
        return {
            "rate_hz": round(self.rate_hz, 1),
            "gyro_calibrated": self.bias_ok,
            "gyro_bias_dps": [round(b, 3) for b in self.bias],
            "forward": [round(c, 4) for c in self.forward],
            "centered": self._center is not None,
            "range_deg": {"x": self.cfg.range_x_deg, "y": self.cfg.range_y_deg},
        }
