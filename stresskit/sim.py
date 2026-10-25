"""Synthetic EDA that looks like the real sensor: for tests and for building a frontend
without wearing the electrodes.

Model: tonic level x (1 + 0.35 * slow stress) x electrode "wetting-in" after contact, plus
Bateman-shaped SCRs whose rate and size grow with stress, plus noise and optional
pressure artifacts. The conductance goes through the Grove circuit model, the board's
1 MOhm / 100 nF output filter and 14-bit quantisation, so it produces the same
(t, counts, counts_sd) stream as the firmware.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from . import conversion
from .device import ImuSample

TAU_RISE, TAU_DECAY = 0.75, 3.0
_T_PEAK = math.log(TAU_DECAY / TAU_RISE) * TAU_RISE * TAU_DECAY / (TAU_DECAY - TAU_RISE)
_PEAK = math.exp(-_T_PEAK / TAU_DECAY) - math.exp(-_T_PEAK / TAU_RISE)


def bateman(t: float) -> float:
    """SCR shape with unit peak (peaks ~1.3 s after onset)."""
    if t <= 0.0:
        return 0.0
    return (math.exp(-t / TAU_DECAY) - math.exp(-t / TAU_RISE)) / _PEAK


@dataclass
class Segment:
    seconds: float
    stress: float
    contact: bool = True
    label: str = ""


DEMO_SCENARIO = [
    Segment(8, 0.0, False, "fingers off"),
    Segment(150, 0.05, True, "rest (baseline)"),
    Segment(90, 0.9, True, "stressor"),
    Segment(150, 0.05, True, "recovery"),
    Segment(60, 0.6, True, "moderate stress"),
    Segment(120, 0.0, True, "calm"),
]


class EDASimulator:
    def __init__(
        self,
        fs: float = 10.0,
        b: float = 0.3,
        u_clip: float = 0.58,
        base_scl: float = 4.0,
        scenario: list[Segment] | None = None,
        loop: bool = True,
        artifact_rate_per_min: float = 0.0,
        noise_us: float = 0.0015,
        seed: int | None = None,
        full_scale: int = 16384,
        sub_steps: int = 10,
    ):
        self.fs, self.b, self.u_clip, self.base_scl = fs, b, u_clip, base_scl
        self.scenario = scenario if scenario is not None else DEMO_SCENARIO
        self.loop = loop
        self.artifact_rate = artifact_rate_per_min / 60.0
        self.noise_us = noise_us
        self.full_scale = full_scale
        self.sub_steps = sub_steps
        self.rng = random.Random(seed)
        self.t = 0.0
        self.manual_stress: float | None = None
        self.manual_contact: bool | None = None
        self.stress_tonic = 0.0
        self.responses: list[tuple[float, float]] = []
        self.wet = 0.0  # electrode/skin hydration: 0 = dry first touch, 1 = settled
        self.artifact: tuple[float, float] | None = None  # (until, gain)
        self.drift = 0.0
        self._rc = 1.0 - b
        self.true_g = 0.0
        self.label = ""

    def current(self) -> tuple[float, bool, str]:
        total = sum(s.seconds for s in self.scenario)
        t = self.t % total if self.loop and total > 0 else self.t
        seg = self.scenario[-1]
        for s in self.scenario:
            if t < s.seconds:
                seg = s
                break
            t -= s.seconds
        stress = seg.stress if self.manual_stress is None else self.manual_stress
        contact = seg.contact if self.manual_contact is None else self.manual_contact
        return stress, contact, seg.label

    @property
    def total_seconds(self) -> float:
        return sum(s.seconds for s in self.scenario)

    def step(self) -> tuple[float, float, float]:
        """Advance one output sample: (t seconds, mean counts, std counts)."""
        dt = 1.0 / (self.fs * self.sub_steps)
        rng = self.rng
        vals = []
        for _ in range(self.sub_steps):
            self.t += dt
            stress, contact, self.label = self.current()
            self.stress_tonic += (stress - self.stress_tonic) * (1.0 - math.exp(-dt / 30.0))
            # Skin under the electrodes hydrates over ~1 min of contact and dries over ~5 min off.
            self.wet += ((1.0 - self.wet) * dt / 60.0) if contact else (-self.wet * dt / 300.0)

            if contact:
                lam = (1.5 + 11.0 * stress) / 60.0
                if rng.random() < lam * dt:
                    amp = (0.05 + 0.2 * stress) * math.exp(rng.gauss(0.0, 0.5)) * self.base_scl / 4.0
                    self.responses.append((self.t, amp))
                if self.artifact is None and rng.random() < self.artifact_rate * dt:
                    self.artifact = (self.t + rng.uniform(1.0, 4.0), max(0.5, rng.gauss(1.0, 0.25)))
                if self.artifact is not None and self.t >= self.artifact[0]:
                    self.artifact = None
                self.responses = [(t0, a) for t0, a in self.responses if self.t - t0 < 30.0]
                self.drift += rng.gauss(0.0, 0.0004) * math.sqrt(dt)
                wet = 0.7 + 0.3 * self.wet
                tonic = self.base_scl * (1.0 + 0.35 * self.stress_tonic) * wet * (1.0 + self.drift)
                phasic = sum(a * bateman(self.t - t0) for t0, a in self.responses)
                g = (tonic + phasic) * (self.artifact[1] if self.artifact else 1.0)
                g += rng.gauss(0.0, self.noise_us)
                self.true_g = g
                u_target = conversion.reading_for_conductance(g, self.b)
            else:
                self.true_g = 0.0
                u_target = 1.0 - self.b
            u_target = min(max(u_target, 0.0), self.u_clip)
            self._rc += (u_target - self._rc) * (1.0 - math.exp(-dt / 0.1))  # board's RC filter
            vals.append(self._rc * self.full_scale + rng.gauss(0.0, 2.0))
        n = len(vals)
        mean = sum(vals) / n
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (n - 1))
        return self.t, mean, sd


def _mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def _transpose(m):
    return tuple(tuple(m[j][i] for j in range(3)) for i in range(3))


def _aim_matrix(heading_deg: float, elev_deg: float):
    """Board->world rotation for a flat-mounted board whose +x points along (heading, elevation)."""
    p, e = math.radians(heading_deg), math.radians(elev_deg)
    rz = ((math.cos(p), -math.sin(p), 0.0), (math.sin(p), math.cos(p), 0.0), (0.0, 0.0, 1.0))
    ry = ((math.cos(e), 0.0, -math.sin(e)), (0.0, 1.0, 0.0), (math.sin(e), 0.0, math.cos(e)))  # Ry(-elev): nose up
    return _mat_mul(rz, ry)


MOTION_SCHEDULE = [("still", 3.0), ("figure8", 18.0), ("still", 3.0), ("circle", 18.0)]


class MotionSimulator:
    """Synthetic 104 Hz IMU: a finger (board +x forward) tracing shapes, with gyro bias and noise.

    In tracker terms the cursor follows x = sin, y = sin(2 *) for "figure8" and a circle for
    "circle". ``pattern`` "auto" cycles still / figure-8 / still / circle.
    """

    def __init__(self, rate_hz: float = 104.0, pattern: str = "auto", amp_x_deg: float = 18.0,
                 amp_y_deg: float = 10.0, period_s: float = 6.0, bias_dps=(1.2, -0.8, 0.5),
                 seed: int | None = None):
        self.dt = 1.0 / rate_hz
        self.pattern = pattern
        self.amp_x, self.amp_y, self.period = amp_x_deg, amp_y_deg, period_s
        self.bias = bias_dps
        self.rng = random.Random(seed)
        self.t = 0.0
        self._pat: str | None = None
        self._pat_t = 0.0
        self._from = self._last_aim = (0.0, 0.0)
        self._R = _aim_matrix(0.0, 0.0)

    def current_pattern(self) -> str:
        if self.pattern != "auto":
            return self.pattern
        total = sum(d for _, d in MOTION_SCHEDULE)
        t = self.t % total
        for name, d in MOTION_SCHEDULE:
            if t < d:
                return name
            t -= d
        return "still"

    def _aim(self) -> tuple[float, float]:
        pat = self.current_pattern()
        if pat != self._pat:
            self._pat, self._pat_t, self._from = pat, 0.0, self._last_aim
        if pat == "still":
            return self._last_aim
        self._pat_t += self.dt
        w = 2.0 * math.pi * self._pat_t / self.period
        if pat == "circle":
            x, y = math.sin(w), math.cos(w)
        else:  # figure8
            x, y = math.sin(w), math.sin(2.0 * w)
        # Cursor x is minus the heading change (turning right lowers the heading).
        target = (-self.amp_x * x, self.amp_y * y)
        k = min(1.0, self._pat_t / 1.5)
        k = k * k * (3.0 - 2.0 * k)  # ease in from wherever the finger was
        self._last_aim = tuple(f + (tg - f) * k for f, tg in zip(self._from, target))
        return self._last_aim

    def step(self, host_time: float = 0.0) -> ImuSample:
        self.t += self.dt
        R_prev, R = self._R, _aim_matrix(*self._aim())
        self._R = R
        d = _mat_mul(_transpose(R_prev), R)
        rate = (
            (d[2][1] - d[1][2]) / 2.0 / self.dt,
            (d[0][2] - d[2][0]) / 2.0 / self.dt,
            (d[1][0] - d[0][1]) / 2.0 / self.dt,
        )
        gauss = self.rng.gauss
        gyro = tuple(math.degrees(r) + b + gauss(0.0, 0.08) for r, b in zip(rate, self.bias))
        up_body = (R[2][0], R[2][1], R[2][2])  # R^T * world z
        accel = tuple(u + gauss(0.0, 0.002) for u in up_body)
        return ImuSample(self.t, accel, gyro, host_time)
