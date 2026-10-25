"""Read recorded GSR sessions (CSV) back as samples, for offline tuning and tests."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterator

from .device import Sample


def read_csv(path: str | Path, full_scale: int = 16384) -> Iterator[tuple[Sample, str]]:
    """Yield (sample, marker) from a liveplot / server / raw capture CSV."""
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                t_ms = float(row["t_ms"])
                counts = float(row["counts"])
                sd = float(row.get("counts_sd") or 0.0)
            except (KeyError, ValueError):
                continue
            fs = int(float(row.get("full_scale") or full_scale))
            host = float(row.get("host_time") or t_ms / 1000.0)
            yield Sample(t_ms / 1000.0, counts, sd, fs, host), (row.get("marker") or "")
