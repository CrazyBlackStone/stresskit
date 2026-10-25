import math

import pytest

from stresskit.device import ImuSample, LineParser, Sample
from stresskit.motion import MotionTracker
from stresskit.sim import MotionSimulator


class ScriptedFinger(MotionSimulator):
    """Board +x forward, flat; aim (heading, elevation) follows a function of time."""

    def __init__(self, aim, **kw):
        super().__init__(seed=0, **kw)
        self.aim_fn = aim

    def _aim(self):
        return self.aim_fn(self.t)


def run(tracker, sim, seconds):
    msgs = []
    while sim.t < seconds - 1e-9:
        msgs.append(tracker.update(sim.step()))
    return msgs


def test_parser_reads_gsr_and_imu_lines():
    p = LineParser()
    p.parse("#gsr_stream v1.1 full_scale=16384 imu=lsm6ds3trc accel_g_per_lsb=0.000122 gyro_dps_per_lsb=0.035", 0)
    s = p.parse("12345,9000.50,40.1", 1.0)
    assert isinstance(s, Sample) and s.t == pytest.approx(12.345) and s.u == pytest.approx(9000.5 / 16384)
    m = p.parse("I,2000000,0,0,8197,100,-100,0", 1.0)
    assert isinstance(m, ImuSample)
    assert m.t == pytest.approx(2.0)
    assert m.accel[2] == pytest.approx(1.0, abs=1e-3)
    assert m.gyro == pytest.approx((3.5, -3.5, 0.0))
    assert p.parse("I,garbage", 1.0) is None
    p.parse("#gsr_stream v1.1 imu=none", 0)
    assert p.imu is None


def test_still_board_learns_bias_and_does_not_drift():
    sim = ScriptedFinger(lambda t: (0.0, 0.0))  # bias (1.2, -0.8, 0.5) dps baked in
    tr = MotionTracker()
    msgs = run(tr, sim, 60.0)
    assert tr.bias_ok and tr.bias == pytest.approx([1.2, -0.8, 0.5], abs=0.05)
    last = msgs[-1]
    assert last["still"] and last["pointer"]["valid"]
    assert abs(last["aim_deg"]["x"]) < 0.5 and abs(last["aim_deg"]["y"]) < 0.5
    assert abs(last["euler_deg"]["roll"]) < 0.5 and abs(last["euler_deg"]["pitch"]) < 0.5


def _move(aim_fn, settle=2.0):
    """Hold still (calibrate + centre), then run the motion; return the tracker's last message."""
    sim = ScriptedFinger(lambda t: (0.0, 0.0) if t < settle else aim_fn(t - settle))
    tr = MotionTracker()
    return run(tr, sim, settle + 1.0)[-1]


def test_turning_right_moves_cursor_right():
    # Heading decreases when turning right (clockwise seen from above).
    m = _move(lambda t: (-15.0 * min(t / 0.8, 1.0), 0.0))
    assert m["aim_deg"]["x"] == pytest.approx(15.0, abs=1.0)
    assert m["pointer"]["x"] == pytest.approx(15.0 / 25.0, abs=0.05)
    assert abs(m["aim_deg"]["y"]) < 1.0


def test_tilting_up_moves_cursor_up():
    m = _move(lambda t: (0.0, 10.0 * min(t / 0.8, 1.0)))
    assert m["aim_deg"]["y"] == pytest.approx(10.0, abs=1.0)
    assert m["pointer"]["y"] == pytest.approx(10.0 / 15.0, abs=0.07)
    assert abs(m["aim_deg"]["x"]) < 1.0


def test_pointer_clamps_to_unit_square():
    m = _move(lambda t: (60.0 * min(t / 0.8, 1.0), -40.0 * min(t / 0.8, 1.0)))
    assert m["pointer"]["x"] == -1.0 and m["pointer"]["y"] == -1.0


def test_figure8_simulation_traces_the_shape():
    sim = MotionSimulator(seed=1)  # still 3 s, then figure-8
    tr = MotionTracker()
    msgs = run(tr, sim, 20.0)
    pts = [(m["pointer"]["x"], m["pointer"]["y"]) for m in msgs[int(6 * 104):]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert max(xs) > 0.6 and min(xs) < -0.6  # +-18 deg of a 25 deg range
    assert max(ys) > 0.55 and min(ys) < -0.55  # +-10 deg of a 15 deg range
    # Figure-8: y is twice the frequency of x, so sign(x) doesn't determine sign(y).
    assert any(x > 0.3 and y > 0.3 for x, y in pts) and any(x > 0.3 and y < -0.3 for x, y in pts)


def test_forward_axis_from_pointing_up():
    tr = MotionTracker()
    for i in range(200):  # board's +y axis pointing at the ceiling, held still
        tr.update(ImuSample(i / 104.0, (0.0, 1.0, 0.0), (0.0, 0.0, 0.0), 0.0))
    res = tr.forward_from_gravity()
    assert res["ok"]
    assert tr.forward == pytest.approx((0.0, 1.0, 0.0), abs=1e-6)
    assert not tr.status()["centered"]  # recentres once the finger is aimed at the screen


def test_forward_from_gravity_requires_stillness():
    tr = MotionTracker()
    for i in range(60):
        tr.update(ImuSample(i / 104.0, (0.0, 0.0, 1.0), (30.0 * math.sin(i / 5), 0.0, 0.0), 0.0))
    assert not tr.forward_from_gravity()["ok"]
