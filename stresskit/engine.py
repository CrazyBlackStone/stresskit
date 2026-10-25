"""Real-time stress inference from skin conductance (EDA / GSR).

Pipeline, once per 10 Hz sample:

1. Reading -> conductance (uS) via the Grove GSR circuit model (see conversion.py).
2. Validity gating: finger contact, ADC saturation, non-physiological jumps (electrode
   pressure/contact artifacts), noisy samples and post-contact settling are all excluded.
3. 1 Hz Butterworth smoothing, then:
   * tonic level (SCL): 10 s rolling median,
   * phasic responses (SCRs): online trough-to-peak detector, giving a smoothed rate
     (SCR/min) with a ~30 s memory.
4. Personal baseline: on first contact the user rests for ~60 s. Collection is extended while
   the electrodes are still "wetting in" (conductance drifting > 6 %/min). That gives the resting
   SCL and resting SCR rate.
5. Stress index 0-100 = 65 x phasic evidence + 35 x tonic evidence, each scaled 0..1:
   * phasic: SCR rate above the resting rate, 0 at +1/min, 1 at +6/min. This is the primary
     marker because slow electrode drift cannot fake it.
   * tonic: log(SCL / tonic reference), 0 at +3 %, 1 at about +28 %. The reference starts at
     the baseline and follows drops within ~1 min. It follows rises (~3 min) only while
     there are no SCRs, which absorbs dry electrodes "wetting in" (on real data SCL doubled
     in the first minutes).
   Both full-scale points can be personalized with a short stress task (start/stop_reference).
   Tonic alone caps at 35 ("elevated"), so "stressed" (>= 55 for 4 s, released below 42 for
   8 s) always needs real SCR activity.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Callable

from . import conversion
from .dsp import SCR, DecayingRate, LowPass, RollingWindow, SCRDetector, mad_sigma, ols_slope


@dataclass
class EngineConfig:
    fs: float = 10.0
    lowpass_hz: float = 1.0
    max_gap_s: float = 0.5  # longer gaps in the stream reset the filters

    # contact & validity
    contact_margin: float = 0.012  # reading must sit this far below the open-circuit level
    contact_settle_s: float = 5.0  # ignore the first seconds after the fingers touch
    jump_up_frac: float = 0.10  # per-sample rise > 10 % of G is not physiological
    jump_down_frac: float = 0.04  # per-sample drop > 4 % of G is not physiological
    artifact_hold_s: float = 2.0
    # Within-window std (fraction of full scale). Mains hum through the body is ~0.005 with good
    # contact and the 100 ms average cancels it, so flag only hum big enough to risk clipping.
    noisy_sd: float = 0.03
    open_flat_range: float = 0.003  # open circuit is flat to ~+-0.001 (measured on hardware)
    default_b: float = 0.5  # pot offset assumed until measured (Seeed's calibration)

    # baseline
    baseline_s: float = 60.0
    baseline_settle_s: float = 10.0
    # Extend the baseline while the electrodes are still wetting in, but not for long. A very
    # long baseline risks absorbing real arousal, and the tonic reference absorbs leftover drift.
    max_baseline_s: float = 120.0
    max_baseline_drift_pct_min: float = 5.0

    # features
    tonic_window_s: float = 10.0
    rate_tau_s: float = 30.0
    scr_min_amp_us: float = 0.02
    scr_rel_amp: float = 0.004
    scr_onset_slope: float = 0.008

    # stress index (population defaults; a stress reference replaces tonic_full/rate_full)
    tonic_dead: float = 0.03
    tonic_full: float = 0.25
    rate_dead: float = 1.0
    rate_full: float = 6.0  # detected rates under stress are ~5-10/min (overlapping SCRs merge)
    # Phasic (SCR frequency) is the primary evidence: it is immune to slow electrode drift.
    # Tonic alone tops out at 35, so it can reach "elevated" but never "stressed".
    w_tonic: float = 0.35
    stress_tau_s: float = 4.0
    calm_below: float = 25.0
    enter_stressed: float = 55.0
    exit_stressed: float = 42.0
    enter_dwell_s: float = 4.0
    exit_dwell_s: float = 8.0
    hold_s: float = 15.0  # keep the last index this long through bad signal, then "unknown"

    # Tonic reference: follows drops quickly (a new, calmer resting level). It absorbs rises
    # only while there are no SCRs, which is the signature of electrodes wetting in.
    tonic_tau_down_s: float = 60.0
    tonic_tau_up_s: float = 180.0
    tonic_tau_up_early_s: float = 60.0  # faster during the first minutes, while still wetting in
    tonic_early_s: float = 300.0
    tonic_follow_below_phasic: float = 0.2
    reattach_tolerance: float = 0.3  # |log SCL change| across a contact gap that forces re-baseline

    # Excluded SCRs: a big inhale the game asked for (expect_response) and SCRs that start while the
    # sensor hand moves (note_motion) are reported but don't count toward the stress index.
    # Matched on the SCR's peak: onset comes 1-3 s after a big breath and the rise takes 1-3 s more.
    # (The detected onset can sit early when the previous response is still decaying.)
    cue_delay_s: float = 1.5
    cue_window_s: float = 8.0
    motion_margin_s: float = 1.0  # motion this close before an SCR's onset (or during its rise) taints it


@dataclass
class Profile:
    """Per-user / per-sensor settings that survive restarts."""

    b: float | None = None  # pot offset (see conversion.py)
    b_source: str | None = None  # "resistor" | "open_circuit" | "manual"
    u_open: float | None = None  # fingers-off reading
    tonic_full: float | None = None  # personalized from the stress reference
    rate_full: float | None = None
    reference: dict | None = None
    imu_forward: list[float] | None = None  # board-frame direction the finger points (finger tracing)

    @classmethod
    def load(cls, path: str | Path) -> "Profile":
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, ValueError):
            return cls()
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in names})

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(asdict(self), indent=2))


WAITING, BASELINE, READY = "waiting_contact", "baseline", "ready"


def _clip01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _r(x: float | None, nd: int = 3) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, nd)


@dataclass
class _Baseline:
    started: float
    window: RollingWindow
    clean_s: float = 0.0
    drift_pct_min: float = 0.0
    settling: bool = False
    last_y: float | None = None
    last_g: float = 0.0
    scr_times: list[float] = field(default_factory=list)
    steps: list[float] = field(default_factory=list)
    raw_steps: list[float] = field(default_factory=list)


class StressEngine:
    def __init__(
        self,
        config: EngineConfig | None = None,
        profile: Profile | None = None,
        on_profile_change: Callable[[Profile], None] | None = None,
    ):
        self.cfg = cfg = config or EngineConfig()
        self.profile = profile or Profile()
        self._on_profile_change = on_profile_change
        self.dt = 1.0 / cfg.fs

        self._lp = LowPass(cfg.lowpass_hz, cfg.fs)
        self._scr = SCRDetector(
            cfg.fs, min_amp_us=cfg.scr_min_amp_us, rel_min_amp=cfg.scr_rel_amp, onset_slope=cfg.scr_onset_slope
        )
        self._rate = DecayingRate(cfg.rate_tau_s)
        self._tonic = RollingWindow(cfg.tonic_window_s)
        self._u_recent = RollingWindow(1.0)
        self._valid_hist = RollingWindow(30.0)
        self._stress_hist = RollingWindow(30.0)

        self.t = 0.0
        self.u = math.nan
        self.u_sd = 0.0
        self.g = math.nan
        self.y = math.nan
        self.contact = False
        self.signal = "no_contact"
        self.phase = WAITING
        self.n_artifacts = 0
        self.noise_us: float | None = None
        self.scrs: list[SCR] = []

        self.base_scl: float | None = None
        self.base_rate: float | None = None
        self.stress: float | None = None
        self.stressed = False
        self.level = "unknown"
        self.e_tonic = 0.0
        self.e_phasic = 0.0

        self._t_last: float | None = None
        self._g_prev: float | None = None
        self._lp_primed = False
        self._contact_since = 0.0
        self._lost_at: float | None = None
        self._scl_before_loss: float | None = None
        self._reattach_check_at: float | None = None
        self._artifact_until = -math.inf
        self._last_valid = -math.inf
        self._above_since: float | None = None
        self._below_since: float | None = None
        self._ready_at = 0.0
        self._next_slow_tick = 0.0
        self._baseline: _Baseline | None = None
        self._open_capture: dict | None = None
        self._open_seen_at_start = False
        self._reference: dict | None = None
        self._cue: tuple[float, float] | None = None
        self._last_motion = -math.inf
        self.n_cued = self.n_motion = 0
        self._pending: list[dict] = []

    # ------------------------------------------------------------------ sensor model

    @property
    def u_open(self) -> float:
        return self.profile.u_open if self.profile.u_open is not None else 0.5

    @property
    def b(self) -> float:
        p = self.profile
        if p.b is not None and p.b_source in ("resistor", "manual"):
            return p.b
        if p.u_open is not None:
            b = conversion.offset_from_open_circuit(p.u_open)
            if b is not None:
                return b
            # Open circuit is clipped by the op-amp, so we only know 1 - b >= u_open.
            return min(self.cfg.default_b, 1.0 - p.u_open)
        return self.cfg.default_b

    @property
    def b_source(self) -> str:
        p = self.profile
        if p.b is not None and p.b_source in ("resistor", "manual"):
            return p.b_source
        if p.u_open is not None and conversion.offset_from_open_circuit(p.u_open) is not None:
            return "open_circuit"
        return "assumed"

    def _profile_changed(self) -> None:
        if self._on_profile_change:
            self._on_profile_change(self.profile)

    def set_offset(self, b: float, source: str = "manual") -> None:
        self.profile.b, self.profile.b_source = b, source
        self._profile_changed()
        self._restart_signal()
        if self.base_scl is not None:
            self.start_baseline()  # conductance scale changed, so the old baseline is meaningless

    # ------------------------------------------------------------------ commands

    def start_baseline(self) -> None:
        self.phase = BASELINE
        self._baseline = _Baseline(started=self.t, window=RollingWindow(self.cfg.max_baseline_s))
        self._reference = None
        self.stress, self.stressed, self.level = None, False, "unknown"
        self._emit("phase", phase=self.phase, reason="baseline started")

    def capture_open_circuit(self, seconds: float = 2.0) -> None:
        """Fingers must be off the electrodes for the next ``seconds``."""
        self._open_capture = {"until": self.t + seconds, "w": RollingWindow(seconds + 1.0)}

    def start_reference(self) -> dict:
        """Begin the personal stress reference (user does a stressful task, e.g. mental math)."""
        if self.base_scl is None:
            return {"ok": False, "error": "baseline not finished yet"}
        self._reference = {"start": self.t, "points": [], "scrs": []}
        self._emit("reference", active=True)
        return {"ok": True}

    def stop_reference(self, apply: bool = True) -> dict:
        ref, self._reference = self._reference, None
        if ref is None:
            return {"ok": False, "error": "no reference running"}
        duration = self.t - ref["start"]
        if duration < 30.0:
            self._emit("reference", active=False, ok=False)
            return {"ok": False, "error": f"task too short ({duration:.0f}s < 30s)"}
        # Responses build up during the task: judge the last two thirds.
        t_from = ref["start"] + duration / 3.0
        tonic = sorted(f for t, f in ref["points"] if t >= t_from)
        if len(tonic) < 10 * self.cfg.fs:
            self._emit("reference", active=False, ok=False)
            return {"ok": False, "error": "not enough clean signal during the task"}
        ref_tonic = tonic[int(0.8 * (len(tonic) - 1))]
        minutes = (self.t - t_from) / 60.0
        ref_rate = sum(1 for t in ref["scrs"] if t >= t_from) / minutes - (self.base_rate or 0.0)
        cfg = self.cfg
        tonic_ok = ref_tonic >= cfg.tonic_dead + 0.02
        rate_ok = ref_rate >= cfg.rate_dead + 1.0
        summary = {
            "ok": True,
            "duration_s": round(duration, 1),
            "scl_change_pct": round(100.0 * (math.exp(ref_tonic) - 1.0), 1),
            "scr_rate_above_baseline": round(ref_rate, 2),
            "tonic_responsive": tonic_ok,
            "phasic_responsive": rate_ok,
            "personalized": False,
        }
        if apply and (tonic_ok or rate_ok):
            # The task should land around 80 % of full scale, leaving room for stronger stress.
            if tonic_ok:
                self.profile.tonic_full = min(1.0, max(0.08, ref_tonic / 0.8))
            if rate_ok:
                self.profile.rate_full = min(20.0, max(3.0, ref_rate / 0.8))
            self.profile.reference = summary
            summary["personalized"] = True
            self._profile_changed()
        self._emit("reference", active=False, **summary)
        return summary

    def expect_response(self, seconds: float | None = None) -> dict:
        """The user is about to take a big breath on cue: its SCR is expected, not stress."""
        cfg = self.cfg
        self._cue = (self.t + cfg.cue_delay_s, self.t + (seconds or cfg.cue_window_s))
        return {"ok": True, "until_t": round(self._cue[1], 2)}

    def note_motion(self) -> None:
        """The sensor hand is moving right now (from the IMU)."""
        self._last_motion = self.t

    def clear_personalization(self) -> None:
        self.profile.tonic_full = self.profile.rate_full = self.profile.reference = None
        self._profile_changed()

    def drain_events(self) -> list[dict]:
        out, self._pending = self._pending, []
        return out

    # ------------------------------------------------------------------ processing

    def process(self, t: float, u: float, u_sd: float = 0.0) -> list[dict]:
        """Feed one sample (time in s, normalized reading 0..1, its within-window std)."""
        cfg = self.cfg
        if self._t_last is not None and not (0.0 < t - self._t_last <= cfg.max_gap_s):
            self._restart_signal()
        self._t_last = t
        self.t, self.u, self.u_sd = t, u, u_sd

        self._track_open_circuit(t, u)

        contact = u < self.u_open - cfg.contact_margin
        if contact and not self.contact:
            self._on_contact(t)
        elif self.contact and not contact:
            self._on_contact_lost(t)
        self.contact = contact

        saturated = u <= conversion.U_SATURATED_LOW
        g = self.g = conversion.conductance_us(u, self.b)
        usable = contact and not saturated

        # Non-physiological jumps and noisy windows -> short exclusion window.
        if usable and self._g_prev is not None:
            rel = (g - self._g_prev) / max(self._g_prev, 0.05)
            if rel > cfg.jump_up_frac or rel < -cfg.jump_down_frac:
                self._artifact_until = t + cfg.artifact_hold_s
                self.n_artifacts += 1
                self._emit("artifact", jump_pct=round(100 * rel, 1))
        if u_sd > cfg.noisy_sd:
            self._artifact_until = max(self._artifact_until, t + 1.0)
        self._g_prev = g if usable else None

        if usable:
            if not self._lp_primed:
                self._lp.reset(g)
                self._lp_primed = True
            self.y = self._lp(g)
        else:
            self._lp_primed = False
            self.y = math.nan

        settling = contact and t - self._contact_since < cfg.contact_settle_s
        artifact = t < self._artifact_until
        valid = usable and not settling and not artifact
        self.signal = (
            "no_contact" if not contact
            else "saturated_low" if saturated
            else "settling" if settling
            else ("noisy" if u_sd > cfg.noisy_sd else "artifact") if artifact
            else "ok"
        )
        self._valid_hist.add(t, 1.0 if valid else 0.0)
        self._rate.advance(t)

        if valid:
            self._last_valid = t
            self._tonic.add(t, self.y)
            scr = self._scr.update(t, self.y, g)
            if scr is not None:
                self._on_scr(scr)
        else:
            self._scr.reset()
        self._tonic.expire(t)

        if self.phase == WAITING and valid and self.base_scl is None:
            self.start_baseline()
        if self.phase == BASELINE:
            self._baseline_step(t, valid)
        elif self.phase == READY:
            self._check_reattach(t)

        self._update_stress(t, valid)

        if t >= self._next_slow_tick:  # 1 Hz housekeeping
            self._next_slow_tick = t + 1.0
            if self.stress is not None:
                self._stress_hist.add(t, self.stress)

        self._emit(
            "sample",
            t=round(t, 2),
            u=round(u, 5),
            eda=_r(self.y, 4),
            raw=_r(g if usable else None, 4),
            contact=contact,
            valid=valid,
        )
        return self.drain_events()

    # ------------------------------------------------------------------ internals

    def _emit(self, kind: str, **data: Any) -> None:
        self._pending.append({"type": kind, **data})

    def _restart_signal(self) -> None:
        self._lp_primed = False
        self._g_prev = None
        self._scr.reset()
        self._tonic.clear()

    def _track_open_circuit(self, t: float, u: float) -> None:
        w = self._u_recent
        w.add(t, u)
        flat = w.span() >= 0.9 and w.range() <= self.cfg.open_flat_range
        cap = self._open_capture
        if cap is not None:
            cap["w"].add(t, u)
            if t >= cap["until"]:
                self._open_capture = None
                ok = cap["w"].range() <= 4 * self.cfg.open_flat_range and cap["w"].median() >= 0.4
                if ok:
                    self._set_open(cap["w"].median())
                self._emit("open_circuit", ok=ok, u_open=_r(cap["w"].median(), 5), b=_r(self.b, 4))
            return
        if not flat:
            return
        level = w.median()
        if level < 0.45:
            return
        if not self._open_seen_at_start and self.base_scl is None and self._baseline is None:
            # Dead-flat high reading before anyone touched the sensor: that's the open circuit.
            self._open_seen_at_start = True
            if self.profile.u_open is None or abs(level - self.profile.u_open) > 0.002:
                self._set_open(level)
        elif self.profile.u_open is None or level > self.profile.u_open + 0.002:
            self._set_open(level)  # nothing can read above the open-circuit level

    def _set_open(self, level: float) -> None:
        old_b = self.b
        self.profile.u_open = round(level, 5)
        self._profile_changed()
        if abs(self.b - old_b) > 0.01:
            self._restart_signal()
            if self.base_scl is not None or self.phase == BASELINE:
                self.start_baseline()

    def _on_contact(self, t: float) -> None:
        self._contact_since = t
        self._restart_signal()
        if self._lost_at is not None and t - self._lost_at > 3.0 and self._scl_before_loss is not None:
            self._reattach_check_at = t + self.cfg.contact_settle_s + 5.0
        self._emit("contact", contact=True)

    def _on_contact_lost(self, t: float) -> None:
        self._lost_at = t
        if len(self._tonic):
            self._scl_before_loss = self._tonic.median()
        self._emit("contact", contact=False)

    def _check_reattach(self, t: float) -> None:
        if self._reattach_check_at is None or t < self._reattach_check_at or len(self._tonic) < 30:
            return
        self._reattach_check_at = None
        change = conversion.log_ratio(self._tonic.median(), self._scl_before_loss or 1.0)
        if abs(change) > self.cfg.reattach_tolerance:
            self._emit("notice", message=f"Electrodes moved (SCL {100 * (math.exp(change) - 1):+.0f} %): recalibrating")
            self.start_baseline()

    def _on_scr(self, scr: SCR) -> None:
        self.scrs.append(scr)
        del self.scrs[:-200]
        cue = self._cue
        cued = cue is not None and cue[0] <= scr.t_peak <= cue[1]
        motion = not cued and self._last_motion >= scr.t_onset - self.cfg.motion_margin_s
        if cued:
            self.n_cued += 1
            self._cue = None  # one breath, one response
        elif motion:
            self.n_motion += 1
        else:
            self._rate.add(scr.t_peak, scr.amplitude_us)
            if self._baseline is not None and self.phase == BASELINE:
                self._baseline.scr_times.append(scr.t_peak)
            if self._reference is not None:
                self._reference["scrs"].append(scr.t_peak)
        self._emit(
            "scr", t=round(scr.t_peak, 2), t_onset=round(scr.t_onset, 2),
            amplitude_us=round(scr.amplitude_us, 4), rise_s=round(scr.rise_time, 2),
            cued=cued, motion=motion, counted=not (cued or motion),
        )

    def _baseline_step(self, t: float, valid: bool) -> None:
        bl, cfg = self._baseline, self.cfg
        if bl is None:
            return
        if valid and t - self._contact_since >= cfg.baseline_settle_s:
            if bl.last_y is not None:
                bl.steps.append(self.y - bl.last_y)
                bl.raw_steps.append(self.g - bl.last_g)
            bl.last_y, bl.last_g = self.y, self.g
            bl.window.add(t, self.y)
            bl.clean_s += self.dt
        elif not valid:
            bl.last_y = None
        if bl.clean_s < cfg.baseline_s or t < self._next_slow_tick:
            return
        recent = [p for p in bl.window.values() if p[0] >= t - 30.0][:: max(1, int(cfg.fs / 2))]
        level = sorted(p[1] for p in recent)[len(recent) // 2]
        bl.drift_pct_min = 100.0 * ols_slope(recent) * 60.0 / max(level, 1e-3)
        bl.settling = abs(bl.drift_pct_min) > cfg.max_baseline_drift_pct_min
        if bl.settling and bl.clean_s < cfg.max_baseline_s:
            return
        self._finish_baseline(t, level)

    def _finish_baseline(self, t: float, level: float) -> None:
        bl, cfg = self._baseline, self.cfg
        assert bl is not None
        window_s = min(bl.clean_s, cfg.baseline_s)
        n = sum(1 for ts in bl.scr_times if ts >= t - window_s)
        # Shrink toward a typical resting rate (2/min) so one quiet or busy minute can't skew it.
        self.base_rate = (n + 2.0) / (window_s / 60.0 + 1.0)
        self.base_scl = level
        # Noise-adaptive SCR thresholds from the resting signal.
        n_steps = int(window_s * cfg.fs)
        step_sigma = mad_sigma(bl.steps[-n_steps:])
        raw_sigma = mad_sigma(bl.raw_steps[-n_steps:]) / math.sqrt(2.0)
        if not math.isnan(raw_sigma):
            self.noise_us = raw_sigma
            self._scr.noise_us = max(0.0005, raw_sigma)
            self._scr.min_amp_us = max(cfg.scr_min_amp_us, 5.0 * raw_sigma)
        if not math.isnan(step_sigma):
            self._scr.onset_slope = max(cfg.scr_onset_slope, 3.0 * step_sigma * cfg.fs)
        self._rate.reset(rate=self.base_rate)
        self._ready_at = t
        self.phase = READY
        self._baseline = None
        self.stress = 0.0
        self.level = "calm"
        self._emit(
            "phase", phase=READY, reason="baseline complete",
            baseline_scl_us=round(level, 4), baseline_scr_rate=round(self.base_rate, 2),
            drift_pct_min=round(bl.drift_pct_min, 2), scr_min_amp_us=round(self._scr.min_amp_us, 4),
            noise_us=_r(self.noise_us, 5),
        )

    def _update_stress(self, t: float, valid: bool) -> None:
        cfg, p = self.cfg, self.profile
        if self.base_scl is None or self.phase == BASELINE:
            return
        if valid and len(self._tonic) >= 10:
            scl = self._tonic.median()
            tonic_full = p.tonic_full or cfg.tonic_full
            rate_full = p.rate_full or cfg.rate_full
            above = self._rate.rate - (self.base_rate or 0.0)
            self.e_phasic = _clip01((above - cfg.rate_dead) / (rate_full - cfg.rate_dead))
            self._follow_tonic(scl)
            f_t = conversion.log_ratio(scl, self.base_scl)
            self.e_tonic = _clip01((f_t - cfg.tonic_dead) / (tonic_full - cfg.tonic_dead))
            raw = 100.0 * (cfg.w_tonic * self.e_tonic + (1.0 - cfg.w_tonic) * self.e_phasic)
            prev = self.stress if self.stress is not None else raw
            self.stress = prev + (raw - prev) * (1.0 - math.exp(-self.dt / cfg.stress_tau_s))
            if self._reference is not None:
                self._reference["points"].append((t, f_t))
        elif t - self._last_valid > cfg.hold_s:
            self.stressed, self.level = False, "unknown"
            self._above_since = self._below_since = None
            return
        if self.stress is None:
            return
        self._update_level(t, self.stress)

    def _update_level(self, t: float, s: float) -> None:
        cfg = self.cfg
        if s < cfg.enter_stressed:
            self._above_since = None
        elif self._above_since is None:
            self._above_since = t
        if s > cfg.exit_stressed:
            self._below_since = None
        elif self._below_since is None:
            self._below_since = t
        if not self.stressed and self._above_since is not None and t - self._above_since >= cfg.enter_dwell_s:
            self.stressed = True
        elif self.stressed and self._below_since is not None and t - self._below_since >= cfg.exit_dwell_s:
            self.stressed = False
        old_level = self.level
        if self.stressed:
            self.level = "stressed"
        elif old_level == "calm":
            self.level = "elevated" if s >= cfg.calm_below else "calm"
        else:  # small hysteresis band on the way back down to calm
            self.level = "calm" if s < cfg.calm_below - 3.0 else "elevated"
        if self.level != old_level:
            self._emit("level", level=self.level, stressed=self.stressed, stress=round(s, 1))

    def _follow_tonic(self, scl: float) -> None:
        """Move the tonic reference: down quickly, up slowly and only while there are no SCRs."""
        cfg = self.cfg
        if self._reference is not None:
            return  # frozen during the stress task, so the task's rise is measured in full
        f = conversion.log_ratio(scl, self.base_scl)
        if f < 0.0:
            tau = cfg.tonic_tau_down_s
        elif self.e_phasic < cfg.tonic_follow_below_phasic:
            early = self.t - self._ready_at < cfg.tonic_early_s
            tau = cfg.tonic_tau_up_early_s if early else cfg.tonic_tau_up_s
        else:
            return
        self.base_scl *= math.exp(f * (1.0 - math.exp(-self.dt / tau)))

    # ------------------------------------------------------------------ reporting

    def quality(self) -> float:
        if not len(self._valid_hist):
            return 0.0
        vals = [v for _, v in self._valid_hist.values()]
        return sum(vals) / len(vals)

    def snapshot(self) -> dict:
        cfg, p = self.cfg, self.profile
        scl = self._tonic.median() if len(self._tonic) else None
        change = None
        if scl is not None and self.base_scl:
            change = 100.0 * (scl / self.base_scl - 1.0)
        trend = None
        if len(self._stress_hist) >= 10:
            trend = ols_slope(self._stress_hist.values()) * 60.0
        cal: dict[str, Any] = {"personalized": p.tonic_full is not None or p.rate_full is not None}
        bl = self._baseline
        if self.phase == BASELINE and bl is not None:
            cal.update(
                progress=round(min(1.0, bl.clean_s / cfg.baseline_s), 3),
                remaining_s=round(max(0.0, cfg.baseline_s - bl.clean_s), 1),
                settling=bl.settling,
                drift_pct_min=round(bl.drift_pct_min, 2),
            )
        quality = self.quality()
        lo, hi = conversion.measurable_range_us(self.b)
        return {
            "type": "state",
            "t": round(self.t, 2),
            "phase": self.phase,
            "contact": self.contact,
            "signal": self.signal,
            "quality": round(quality, 2),
            "reliable": self.phase == READY and self.signal == "ok" and quality >= 0.6,
            "stress": _r(self.stress, 1),
            "level": self.level,
            "stressed": self.stressed,
            "eda_us": _r(self.y, 4),
            "scl_us": _r(scl, 4),
            "baseline_scl_us": _r(self.base_scl, 4),
            "scl_change_pct": _r(change, 1),
            "scr_rate_per_min": round(self._rate.rate, 2),
            "baseline_scr_rate_per_min": _r(self.base_rate, 2),
            "scr_amp_per_min": round(self._rate.magnitude, 4),
            "trend_per_min": _r(trend, 1),
            "evidence": {"tonic": round(self.e_tonic, 3), "phasic": round(self.e_phasic, 3)},
            "calibration": cal,
            "reference": {"active": self._reference is not None,
                          "elapsed_s": round(self.t - self._reference["start"], 1) if self._reference else None},
            "sensor": {
                "u": _r(self.u, 5), "u_sd": _r(self.u_sd, 5), "u_open": _r(self.u_open, 5),
                "b": _r(self.b, 4), "b_source": self.b_source, "range_us": [_r(lo, 2), _r(hi, 1)],
                "noise_us": _r(self.noise_us, 5),
            },
            "scr_count": len(self.scrs),
            "last_scr_ago_s": round(self.t - self.scrs[-1].t_peak, 1) if self.scrs else None,
            "artifacts": self.n_artifacts,
            "scr_excluded": {"cued": self.n_cued, "motion": self.n_motion},
            "cue_active": self._cue is not None and self.t <= self._cue[1],
        }
