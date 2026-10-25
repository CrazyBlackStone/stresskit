import csv

from stresskit.device import Sample
from stresskit.engine import StressEngine
from stresskit.server import Hub
from stresskit.sim import EDASimulator, Segment


def _feed(hub, sim, seconds, t0=1_000_000.0):
    end = sim.t + seconds
    while sim.t < end - 1e-9:
        t, c, sd = sim.step()
        hub.on_sample(Sample(t, c, sd, sim.full_scale, t0 + t))


def test_each_game_run_gets_its_own_recording(tmp_path):
    sim = EDASimulator(seed=2, loop=False, scenario=[Segment(300, 0.05, True, "rest")])
    hub = Hub(StressEngine(), None, "serial", runs_dir=tmp_path)
    _feed(hub, sim, 5)
    hub.command({"cmd": "mark", "label": "lantern round glow start"})
    _feed(hub, sim, 3)
    hub.command({"cmd": "expect_response", "seconds": 14})
    _feed(hub, sim, 3)
    hub.command({"cmd": "mark", "label": "lantern round glow end score=12"})
    _feed(hub, sim, 2)
    hub.command({"cmd": "mark", "label": "lantern rest glow pre=10.0 post=8.0 score=12"})
    _feed(hub, sim, 2)  # after the run: not recorded
    hub.command({"cmd": "mark", "label": "lantern affirm start"})
    _feed(hub, sim, 1)
    hub.end_run()  # server shutdown mid-run

    files = sorted(tmp_path.glob("run-*.csv"))
    assert [f.name.rsplit("-", 1)[1] for f in files] == ["affirm.csv", "glow.csv"]
    rows = list(csv.DictReader(files[1].open()))
    assert len(rows) == 81  # 3 + 3 + 2 s at 10 Hz, plus the sample that carries the rest mark
    assert float(rows[0]["t_s"]) == 0.0 and abs(float(rows[-1]["t_s"]) - 8.0) < 0.01
    assert rows[0]["event"] == "lantern round glow start"
    events = [r["event"] for r in rows if r["event"]]
    assert "breath cue" in events and events[-1].startswith("lantern rest glow")
    assert all(r["eda_us"] and r["clock"].count(":") == 2 for r in rows)


def test_no_run_files_without_recording(tmp_path):
    sim = EDASimulator(seed=2, loop=False, scenario=[Segment(30, 0.05, True, "rest")])
    hub = Hub(StressEngine(), None, "serial")
    hub.command({"cmd": "mark", "label": "lantern round roots start"})
    _feed(hub, sim, 2)
    assert hub.run is None and not list(tmp_path.iterdir())


def test_a_board_restart_does_not_stall_the_engine():
    # The XIAO's clock restarts at 0 when it resets (e.g. a reseated cable); the host clock keeps going.
    sim = EDASimulator(seed=4, loop=False, scenario=[Segment(400, 0.05, True, "rest")])
    hub = Hub(StressEngine(), None, "serial")
    ts = []
    for i in range(1400):  # 140 s at 10 Hz; the board restarts 30 s in
        _, c, sd = sim.step()
        device_t = 3600.0 + i * 0.1 if i < 300 else (i - 300) * 0.1
        hub.on_sample(Sample(device_t, c, sd, sim.full_scale, 1_000_000.0 + i * 0.1))
        ts.append(hub.engine.t)
    assert all(b > a for a, b in zip(ts, ts[1:]))  # engine time only moves forward
    assert hub.engine.phase == "ready"  # the baseline still finishes
