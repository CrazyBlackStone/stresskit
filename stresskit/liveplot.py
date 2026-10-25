"""Live scrolling plot of the GSR stream, for checking wiring and watching responses.

    python -m stresskit.liveplot [--port COM4] [--window 60]

Click the plot window, then:
    o   fingers are OFF the electrodes right now: capture the open-circuit level
        (this calibrates the uS conversion; it is also done automatically at start)
    m   drop a numbered marker (e.g. "took a deep breath"), saved in the CSV
    q   quit

Every sample is saved to data/live-<timestamp>.csv.
"""

from __future__ import annotations

import argparse
import csv
import math
import threading
import time
from collections import deque
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

from .conversion import conductance_us
from .device import Sample, SerialReader

SURFACE, INK, INK_2, GRID, SERIES = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e0", "#2a78d6"
CONTACT_MARGIN = 0.012


class LiveState:
    def __init__(self, window_s: float, csv_path: Path):
        self.window_s = window_s
        self.lock = threading.Lock()
        self.t: deque[float] = deque()
        self.u: deque[float] = deque()
        self.sd: deque[float] = deque()
        self.markers: list[tuple[float, int]] = []
        self.t0: float | None = None
        self.status = "starting"
        self.u_open: float | None = None
        self.open_source = ""
        self.rate = 0.0
        self._csv_file = csv_path.open("w", newline="")
        self._csv = csv.writer(self._csv_file)
        self._csv.writerow(["host_time", "t_ms", "counts", "counts_sd", "u", "marker"])
        self._pending_marker = ""
        self.csv_path = csv_path

    def add(self, s: Sample) -> None:
        with self.lock:
            if self.t0 is None:
                self.t0 = s.host_time
            t = s.host_time - self.t0
            if self.t:
                dt = t - self.t[-1]
                if dt > 0:
                    self.rate += ((1.0 / dt) - self.rate) * 0.05 if self.rate else 1.0 / dt
            self.t.append(t)
            self.u.append(s.u)
            self.sd.append(s.counts_sd)
            while self.t and t - self.t[0] > self.window_s:
                self.t.popleft()
                self.u.popleft()
                self.sd.popleft()
            self._csv.writerow([f"{s.host_time:.3f}", int(round(s.t * 1000)), f"{s.counts:.2f}",
                                f"{s.counts_sd:.2f}", f"{s.u:.5f}", self._pending_marker])
            self._pending_marker = ""
            if len(self.t) % 10 == 0:
                self._csv_file.flush()
            if self.u_open is None:
                self._maybe_auto_open()

    def _recent(self, seconds: float) -> list[float]:
        if not self.t:
            return []
        end = self.t[-1]
        return [u for t, u in zip(self.t, self.u) if end - t <= seconds]

    def _maybe_auto_open(self) -> None:
        r = self._recent(2.0)
        if len(r) >= 18 and max(r) - min(r) <= 0.003 and sorted(r)[len(r) // 2] >= 0.45:
            self.u_open = sorted(r)[len(r) // 2]
            self.open_source = "auto"

    def capture_open(self) -> str:
        with self.lock:
            r = self._recent(2.0)
            if len(r) < 10:
                return "not enough data yet"
            self.u_open = sorted(r)[len(r) // 2]
            self.open_source = "manual"
            return f"open circuit set to {self.u_open:.4f}"

    def mark(self) -> int:
        with self.lock:
            n = len(self.markers) + 1
            if self.t:
                self.markers.append((self.t[-1], n))
            self._pending_marker = f"m{n}"
            return n

    @property
    def b(self) -> float | None:
        return None if self.u_open is None else min(0.5, max(0.0, 1.0 - self.u_open))

    def close(self) -> None:
        with self.lock:
            self._csv_file.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port (default: auto-detect the XIAO)")
    ap.add_argument("--window", type=float, default=60.0, help="seconds shown (default 60)")
    args = ap.parse_args()

    data_dir = Path(__file__).resolve().parent.parent / "data"
    data_dir.mkdir(exist_ok=True)
    state = LiveState(args.window, data_dir / time.strftime("live-%Y%m%d-%H%M%S.csv"))

    def on_status(msg: str) -> None:
        state.status = msg
        print(msg, flush=True)

    reader = SerialReader(state.add, on_status, port=args.port)
    reader.start()

    plt.rcParams.update({
        "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "axes.edgecolor": GRID,
        "axes.labelcolor": INK_2, "xtick.color": INK_2, "ytick.color": INK_2, "text.color": INK,
        "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "font.size": 10,
        "axes.spines.top": False, "axes.spines.right": False,
    })
    fig, (ax_u, ax_g, ax_sd) = plt.subplots(3, 1, sharex=True, figsize=(11, 8.5),
                                           gridspec_kw={"height_ratios": [3, 3, 1.6]})
    fig.canvas.manager.set_window_title("GSR live")
    ax_u.set_title("Sensor output (fraction of the 3.3 V supply)", loc="left", fontsize=11)
    ax_g.set_title("Skin conductance (µS)", loc="left", fontsize=11)
    ax_sd.set_title("Hum/noise inside each 100 ms window (ADC counts, std)", loc="left", fontsize=11)
    ax_sd.set_xlabel("time (s)")
    (ln_u,) = ax_u.plot([], [], color=SERIES, lw=2)
    (ln_g,) = ax_g.plot([], [], color=SERIES, lw=2)
    (ln_sd,) = ax_sd.plot([], [], color=SERIES, lw=1.5)
    ln_open = ax_u.axhline(math.nan, color=INK_2, lw=1, ls="--")
    open_lbl = ax_u.text(0.0, 0.0, "", color=INK_2, fontsize=9, va="bottom", transform=ax_u.get_yaxis_transform())
    g_hint = ax_g.text(0.5, 0.5, "", ha="center", va="center", color=INK_2, transform=ax_g.transAxes)
    status = fig.text(0.01, 0.985, "", va="top", fontsize=10, family="monospace")
    fig.text(0.99, 0.985, "keys: o = fingers off (calibrate)   m = marker   q = quit",
             va="top", ha="right", fontsize=9, color=INK_2)
    fig.subplots_adjust(top=0.9, hspace=0.35, left=0.08, right=0.98, bottom=0.07)
    marker_artists: list = []
    toast = {"text": "", "until": 0.0}

    def on_key(ev) -> None:
        if ev.key == "o":
            toast.update(text=state.capture_open(), until=time.time() + 3)
        elif ev.key == "m":
            toast.update(text=f"marker {state.mark()}", until=time.time() + 2)

    fig.canvas.mpl_connect("key_press_event", on_key)

    def autoscale(ax, ys, min_span):
        ys = [y for y in ys if not math.isnan(y)]
        if not ys:
            return
        lo, hi = min(ys), max(ys)
        mid, span = (lo + hi) / 2, max(hi - lo, min_span)
        ax.set_ylim(mid - 0.6 * span, mid + 0.6 * span)

    def update(_frame):
        with state.lock:
            ts, us, sds = list(state.t), list(state.u), list(state.sd)
            markers = list(state.markers)
            u_open, b, src, rate = state.u_open, state.b, state.open_source, state.rate
        if ts:
            gs = [conductance_us(u, b) if (b is not None and u < u_open - CONTACT_MARGIN) else math.nan for u in us]
            ln_u.set_data(ts, us)
            ln_g.set_data(ts, gs)
            ln_sd.set_data(ts, sds)
            right = max(ts[-1], args.window)
            ax_sd.set_xlim(right - args.window, right)
            autoscale(ax_u, us + ([u_open] if u_open is not None and min(us) > u_open - 0.05 else []), 0.01)
            autoscale(ax_g, gs, 0.2)
            autoscale(ax_sd, sds, 20)
            if u_open is not None:
                ln_open.set_ydata([u_open, u_open])
                open_lbl.set_position((ts[-1] - args.window + 0.5, u_open))
                open_lbl.set_text(f"open circuit (fingers off) {u_open:.4f}")
            contact = u_open is not None and us[-1] < u_open - CONTACT_MARGIN
            g_now = gs[-1]
            if u_open is None:
                g_hint.set_text("take fingers off and press O to calibrate µS")
            elif all(math.isnan(g) for g in gs):
                g_hint.set_text("no skin contact detected")
            else:
                g_hint.set_text("")
            line = (f"{state.status} | {rate:4.1f} Hz | reading {us[-1]:.4f} ({us[-1] * 3.3:.3f} V) | "
                    f"{'%.3f µS' % g_now if not math.isnan(g_now) else '--- µS'} | noise {sds[-1]:5.1f} | "
                    f"contact {'YES' if contact else 'no '} | b={'%.3f' % b if b is not None else '?'} ({src or 'unset'})")
        else:
            line = state.status
        if toast["text"] and time.time() < toast["until"]:
            line += f"   >> {toast['text']}"
        status.set_text(line)
        for a in marker_artists:
            a.remove()
        marker_artists.clear()
        for t_m, n in markers:
            for ax in (ax_u, ax_g, ax_sd):
                marker_artists.append(ax.axvline(t_m, color=INK_2, lw=1, ls=":"))
            marker_artists.append(ax_u.text(t_m, 1.0, f" m{n}", color=INK_2, fontsize=9, va="top",
                                            transform=ax_u.get_xaxis_transform()))
        return []

    anim = FuncAnimation(fig, update, interval=100, cache_frame_data=False)  # noqa: F841 (keep a reference)
    print(f"recording to {state.csv_path}", flush=True)
    try:
        plt.show()
    finally:
        reader.stop()
        state.close()


if __name__ == "__main__":
    main()
