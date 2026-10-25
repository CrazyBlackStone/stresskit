import math

import pytest

from stresskit import conversion
from stresskit.dsp import LowPass, SCRDetector
from stresskit.engine import READY, EngineConfig, StressEngine
from stresskit.sim import EDASimulator, Segment, bateman


def run(sim: EDASimulator, seconds: float, engine: StressEngine | None = None):
    """Drive an engine with the simulator; return (engine, per-sample log)."""
    eng = engine or StressEngine()
    log = []
    while sim.t < seconds:
        t, counts, sd = sim.step()
        events = eng.process(t, counts / sim.full_scale, sd / sim.full_scale)
        log.append((t, sim.label, eng.level, eng.stressed, eng.stress, events))
    return eng, log


def fraction(log, label, after_s, pred):
    """Fraction of samples in segment ``label`` (after its first ``after_s`` seconds) matching pred."""
    rows, start = [], None
    for t, lab, level, stressed, stress, _ in log:
        if lab != label:
            start = None
            continue
        start = t if start is None else start
        if t - start >= after_s:
            rows.append((level, stressed, stress))
    assert rows, f"no samples for segment {label!r}"
    return sum(1 for r in rows if pred(*r)) / len(rows)


# --------------------------------------------------------------------------- conversion

@pytest.mark.parametrize("b", [0.1, 0.3, 0.5])
@pytest.mark.parametrize("g", [0.3, 2.0, 8.0])
def test_conversion_roundtrip(g, b):
    u = conversion.reading_for_conductance(g, b)
    if u > 0:
        assert conversion.conductance_us(u, b) == pytest.approx(g, rel=1e-9)


def test_seeed_formula_is_off_by_ten():
    # Seeed: R = (1024 + 2x) * 10000 / (512 - x); schematic: R6 = 200k, b = 0.5
    x = 300
    seeed_r = (1024 + 2 * x) * 10000 / (512 - x)
    ours_r = 1e6 / conversion.conductance_us(x / 1024, 0.5)
    assert ours_r == pytest.approx(10 * seeed_r, rel=1e-9)


# --------------------------------------------------------------------------- SCR shape test

def _through_sensor(gfun, seconds=12.0, fs=10, sub=50):
    """Conductance through the board's 1 MOhm/100 nF filter and the firmware's 100 ms average."""
    dt, rc, t, out = 1 / (fs * sub), gfun(0.0), 0.0, []
    for _ in range(int(seconds * fs)):
        acc = 0.0
        for _ in range(sub):
            t += dt
            rc += (gfun(t) - rc) * (1 - math.exp(-dt / 0.1))
            acc += rc
        out.append(acc / sub)
    return out


def _detect(xs):
    lp, det = LowPass(1.0, 10), SCRDetector(10)
    found = [r for i, x in enumerate(xs) if (r := det.update(i / 10, lp(x), x))]
    return found, det.rejected


@pytest.mark.parametrize("amp", [0.03, 0.1, 0.5])
def test_scr_detected(amp):
    found, rejected = _detect(_through_sensor(lambda t: 4.0 + amp * bateman(t - 2.0)))
    assert len(found) == 1 and rejected == 0
    assert found[0].amplitude_us == pytest.approx(amp, rel=0.05)
    assert 1.0 <= found[0].rise_time <= 3.0


@pytest.mark.parametrize("step", [0.05, 0.2, 0.6])
def test_step_artifact_rejected(step):
    found, rejected = _detect(_through_sensor(lambda t: 4.0 + (step if t > 2.0 else 0.0)))
    assert found == [] and rejected == 1


def test_pressure_bump_rejected():
    found, _ = _detect(_through_sensor(lambda t: 4.0 + (0.3 if 2.0 < t < 3.5 else 0.0)))
    assert found == []


# --------------------------------------------------------------------------- whole engine

SCENARIO = [
    Segment(8, 0.0, False, "off"),
    Segment(150, 0.05, True, "rest"),
    Segment(120, 0.9, True, "stress"),
    Segment(180, 0.05, True, "recovery"),
]
SEEDS = range(1, 9)  # SCRs are random; judge the detector over several sessions, not one draw


def test_scenario_detects_stress_and_calm():
    stressed, calm_recovery = [], []
    for seed in SEEDS:
        sim = EDASimulator(seed=seed, loop=False, scenario=SCENARIO)
        eng, log = run(sim, sim.total_seconds)
        assert eng.profile.u_open == pytest.approx(0.58, abs=0.003)  # open circuit learned at start
        assert any(e["type"] == "phase" and e["phase"] == READY for *_, evs in log for e in evs)
        assert fraction(log, "rest", 120, lambda lv, st, s: not st) == 1.0, f"false alarm at rest, seed {seed}"
        stressed.append(fraction(log, "stress", 45, lambda lv, st, s: st))
        calm_recovery.append(fraction(log, "recovery", 90, lambda lv, st, s: lv == "calm"))
    assert sum(stressed) / len(stressed) > 0.8, stressed
    assert min(stressed) > 0.4, stressed
    assert sum(calm_recovery) / len(calm_recovery) > 0.8, calm_recovery


def test_electrode_drift_alone_is_never_stress():
    # Strong wetting-in drift (default sim: SCL +43 % over the first minutes), no stress.
    sim = EDASimulator(seed=2, loop=False, base_scl=1.0, scenario=[Segment(8, 0, False, "off"), Segment(600, 0.0, True, "rest")])
    eng, log = run(sim, sim.total_seconds)
    assert not any(st for _, _, _, st, _, _ in log)


def test_motion_artifacts_do_not_cause_stress():
    sim = EDASimulator(seed=3, loop=False, artifact_rate_per_min=4.0,
                       scenario=[Segment(8, 0, False, "off"), Segment(480, 0.05, True, "rest")])
    eng, log = run(sim, sim.total_seconds)
    assert eng.n_artifacts > 0 or eng._scr.rejected > 0
    assert fraction(log, "rest", 150, lambda lv, st, s: not st) > 0.95


def test_contact_loss_and_return():
    sim = EDASimulator(seed=4, loop=False, scenario=[
        Segment(8, 0, False, "off"), Segment(150, 0.05, True, "rest"),
        Segment(10, 0.05, False, "lifted"), Segment(60, 0.05, True, "back"),
    ])
    eng, log = run(sim, sim.total_seconds)
    assert fraction(log, "lifted", 1, lambda lv, st, s: not st) == 1.0
    assert eng.contact and eng.phase == READY


def test_personal_reference_rescales():
    sim = EDASimulator(seed=5, loop=False, scenario=[
        Segment(8, 0, False, "off"), Segment(150, 0.05, True, "rest"), Segment(90, 0.6, True, "task"),
    ])
    eng = StressEngine()
    started = False
    while sim.t < sim.total_seconds:
        t, c, sd = sim.step()
        eng.process(t, c / sim.full_scale, sd / sim.full_scale)
        if sim.label == "task" and not started:
            assert eng.start_reference()["ok"]
            started = True
    summary = eng.stop_reference()
    assert summary["ok"] and summary["personalized"]
    assert eng.profile.rate_full is not None or eng.profile.tonic_full is not None


def test_wrong_pot_offset_still_works():
    # True b = 0.15 but the open circuit clips at 0.58, so the engine assumes b = 0.42 and
    # under-reads conductance by ~2x. Everything is relative to the user's own baseline, so
    # decisions should barely change.
    stressed = []
    for seed in SEEDS:
        sim = EDASimulator(seed=seed, b=0.15, loop=False, scenario=SCENARIO[:3])
        eng, log = run(sim, sim.total_seconds, StressEngine(EngineConfig()))
        assert eng.b == pytest.approx(0.42, abs=0.01)
        assert fraction(log, "rest", 120, lambda lv, st, s: not st) == 1.0
        stressed.append(fraction(log, "stress", 45, lambda lv, st, s: st))
    assert sum(stressed) / len(stressed) > 0.75, stressed
