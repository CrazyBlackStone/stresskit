"""Small streaming DSP pieces for EDA: smoothing, rolling statistics, SCR detection."""

from __future__ import annotations

import bisect
import math
from collections import deque
from dataclasses import dataclass


class LowPass:
    """2nd-order Butterworth low-pass (bilinear transform, transposed direct form II)."""

    def __init__(self, cutoff_hz: float, fs: float):
        w0 = 2.0 * math.pi * cutoff_hz / fs
        cos_w0, alpha = math.cos(w0), math.sin(w0) / math.sqrt(2.0)
        a0 = 1.0 + alpha
        self.b0 = (1.0 - cos_w0) / 2.0 / a0
        self.b1 = (1.0 - cos_w0) / a0
        self.b2 = self.b0
        self.a1 = -2.0 * cos_w0 / a0
        self.a2 = (1.0 - alpha) / a0
        self.z1 = self.z2 = 0.0
        self.primed = False

    def reset(self, x: float | None = None) -> None:
        """Start from steady state at ``x`` (no startup transient), or unprimed if None."""
        if x is None:
            self.primed = False
            return
        self.z1 = x * (1.0 - self.b0)
        self.z2 = x * (self.b2 - self.a2)
        self.primed = True

    def __call__(self, x: float) -> float:
        if not self.primed:
            self.reset(x)
        y = self.b0 * x + self.z1
        self.z1 = self.b1 * x - self.a1 * y + self.z2
        self.z2 = self.b2 * x - self.a2 * y
        return y


class RollingWindow:
    """Time-windowed values with O(n) insert and O(1) order statistics (n is small here)."""

    def __init__(self, seconds: float):
        self.seconds = seconds
        self._items: deque[tuple[float, float]] = deque()
        self._sorted: list[float] = []

    def add(self, t: float, v: float) -> None:
        self._items.append((t, v))
        bisect.insort(self._sorted, v)
        self.expire(t)

    def expire(self, now: float) -> None:
        while self._items and now - self._items[0][0] > self.seconds:
            _, old = self._items.popleft()
            del self._sorted[bisect.bisect_left(self._sorted, old)]

    def clear(self) -> None:
        self._items.clear()
        self._sorted.clear()

    def __len__(self) -> int:
        return len(self._items)

    def span(self) -> float:
        return self._items[-1][0] - self._items[0][0] if len(self._items) > 1 else 0.0

    def quantile(self, q: float) -> float:
        if not self._sorted:
            return math.nan
        pos = q * (len(self._sorted) - 1)
        lo = int(pos)
        hi = min(lo + 1, len(self._sorted) - 1)
        return self._sorted[lo] + (self._sorted[hi] - self._sorted[lo]) * (pos - lo)

    def median(self) -> float:
        return self.quantile(0.5)

    def range(self) -> float:
        return self._sorted[-1] - self._sorted[0] if self._sorted else 0.0

    def values(self) -> list[tuple[float, float]]:
        return list(self._items)


def ols_slope(points: list[tuple[float, float]]) -> float:
    """Least-squares slope (units of y per unit t) of (t, y) points."""
    n = len(points)
    if n < 3:
        return 0.0
    mt = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    num = sum((t - mt) * (y - my) for t, y in points)
    den = sum((t - mt) ** 2 for t, _ in points)
    return num / den if den > 0 else 0.0


def mad_sigma(values: list[float]) -> float:
    """Robust standard deviation estimate (median absolute deviation * 1.4826)."""
    if len(values) < 5:
        return math.nan
    s = sorted(values)
    med = s[len(s) // 2]
    dev = sorted(abs(v - med) for v in s)
    return 1.4826 * dev[len(dev) // 2]


class DecayingRate:
    """Exponentially weighted event rate (events/min) and summed magnitude (units/min).

    A steady stream of r events/min reads r; each event adds 60/tau immediately and decays
    with time constant ``tau_s``, so this behaves like a smooth ~tau-second counting window.
    """

    def __init__(self, tau_s: float):
        self.tau = tau_s
        self.rate = 0.0
        self.magnitude = 0.0
        self._t: float | None = None

    def advance(self, t: float) -> None:
        if self._t is not None and t > self._t:
            k = math.exp(-(t - self._t) / self.tau)
            self.rate *= k
            self.magnitude *= k
        self._t = t

    def add(self, t: float, magnitude: float = 0.0) -> None:
        self.advance(t)
        self.rate += 60.0 / self.tau
        self.magnitude += magnitude * 60.0 / self.tau

    def reset(self, rate: float = 0.0, magnitude: float = 0.0) -> None:
        self.rate, self.magnitude = rate, magnitude


@dataclass
class SCR:
    """One skin conductance response (trough-to-peak)."""

    t_onset: float
    t_peak: float
    amplitude_us: float
    onset_us: float

    @property
    def rise_time(self) -> float:
        return self.t_peak - self.t_onset


class SCRDetector:
    """Online trough-to-peak SCR detector that also works on a rising tonic level.

    Runs on low-passed conductance ``y``, with the unsmoothed conductance ``raw`` alongside
    for the shape test. Responses are measured against the background trend: the lowest
    non-negative slope of ``y`` over the previous ``trend_s`` seconds. During acute stress
    the tonic level climbs while SCRs fire on top of it, and a plain "rise then fall" detector
    would miss them. A response starts when the slope exceeds trend + ``onset_slope`` (uS/s).
    Its onset is the last local minimum of the detrended signal. It ends once the slope has
    been back at or below the trend for ``end_samples`` samples. It is kept only if it looks
    physiological:

    * amplitude above the extrapolated trend >= max(min_amp_us, rel_min_amp * onset level)
    * min_rise_s <= rise time <= max_rise_s (slower rises are tonic drift)
    * not too steep: in the raw signal, no two consecutive samples may climb more than
      ``max_steepness`` of the amplitude (plus a noise allowance). Real SCRs take ~1-3 s to
      rise (ratio <= ~0.4 even for fast ones after the sensor's own filtering). Electrode
      pressure and contact changes are near-instant steps (ratio ~0.55-0.8).
    """

    def __init__(
        self,
        fs: float,
        min_amp_us: float = 0.02,
        rel_min_amp: float = 0.004,
        onset_slope: float = 0.008,
        min_rise_s: float = 0.5,
        max_rise_s: float = 7.0,
        max_steepness: float = 0.5,
        noise_us: float = 0.0015,
        lookback_s: float = 3.0,
        trend_s: float = 3.0,
        end_samples: int = 2,
    ):
        self.dt = 1.0 / fs
        self.min_amp_us = min_amp_us
        self.rel_min_amp = rel_min_amp
        self.onset_slope = onset_slope
        self.min_rise_s = min_rise_s
        self.max_rise_s = max_rise_s
        self.max_steepness = max_steepness
        self.noise_us = noise_us
        self.end_samples = end_samples
        self._hist: deque[tuple[float, float]] = deque(maxlen=max(2, int(round(lookback_s * fs))))
        self._slopes: deque[float] = deque(maxlen=max(2, int(round(trend_s * fs))))
        self._raw: deque[tuple[float, float]] = deque(maxlen=int(round((max_rise_s + lookback_s + 2.0) * fs)))
        self.rejected = 0
        self.reset()

    def reset(self) -> None:
        self._prev: float | None = None
        self._hist.clear()
        self._slopes.clear()
        self._raw.clear()
        self._rising = False
        self._trend = 0.0
        self._onset = (0.0, 0.0)
        self._peak = (0.0, 0.0)  # (t, height above the trend line through the onset)
        self._stalled = 0

    def threshold(self, level_us: float) -> float:
        return max(self.min_amp_us, self.rel_min_amp * level_us)

    def update(self, t: float, y: float, raw: float | None = None) -> SCR | None:
        self._raw.append((t, y if raw is None else raw))
        prev, self._prev = self._prev, y
        if prev is None:
            self._hist.append((t, y))
            return None
        slope = (y - prev) / self.dt
        result = None

        if not self._rising:
            trend = max(0.0, min(self._slopes)) if self._slopes else 0.0
            if slope > trend + self.onset_slope:
                h = self._hist
                i = len(h) - 1
                # Walk back down the rising edge (detrended) to the trough.
                while i > 0 and h[i - 1][1] < h[i][1] - trend * (h[i][0] - h[i - 1][0]):
                    i -= 1
                self._onset = h[i] if h else (t, prev)
                self._trend = trend
                self._rising = True
                self._peak = (t, self._height(t, y))
                self._stalled = 0
        else:
            height = self._height(t, y)
            if height >= self._peak[1]:
                self._peak = (t, height)
                self._stalled = 0
            else:
                self._stalled += 1
            if self._stalled >= self.end_samples:
                result = self._finish()
            elif t - self._onset[0] > self.max_rise_s:
                # Too slow for an SCR: the background itself is climbing (e.g. the tonic ramp at
                # stress onset). Drop it and re-anchor, so the next onset uses the recent slope
                # as its trend and SCRs riding on the ramp are still caught.
                self._rising = False
                self._hist.clear()
        self._slopes.append(slope)
        self._hist.append((t, y))
        return result

    def _height(self, t: float, y: float) -> float:
        t0, y0 = self._onset
        return y - y0 - self._trend * (t - t0)

    def steepness(self, t0: float, t1: float) -> float:
        """Largest 2-sample climb of the raw signal within [t0, t1]."""
        seg = [v for ts, v in self._raw if t0 - 0.3 <= ts <= t1 + 0.05]
        return max((seg[i] - seg[i - 2] for i in range(2, len(seg))), default=0.0)

    def _finish(self) -> SCR | None:
        self._rising = False
        (t0, y0), (tp, amp) = self._onset, self._peak
        # The next onset is searched from this peak onwards. The background slopes from before
        # this response stay, so the trend survives back-to-back SCRs on a climbing level.
        self._hist.clear()
        self._hist.append((tp, y0 + amp + self._trend * (tp - t0)))
        if amp < self.threshold(y0):
            return None
        rise = tp - t0
        allowance = 4.0 * self.noise_us + 2.0 * self.dt * self._trend
        too_steep = self.steepness(t0, tp) > self.max_steepness * amp + allowance
        if not (self.min_rise_s <= rise <= self.max_rise_s) or too_steep:
            self.rejected += 1
            return None
        return SCR(t_onset=t0, t_peak=tp, amplitude_us=amp, onset_us=y0)
