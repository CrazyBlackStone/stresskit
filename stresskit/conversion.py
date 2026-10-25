"""Grove GSR v1.2 transfer function: ADC reading -> skin conductance (microsiemens).

Circuit, from Seeed's v1.2 schematic:

* A VCC/2 reference (R2/R7, 4.7 kOhm each) feeds two 200 kOhm resistors.
* R6 (200 kOhm) and the skin resistance Rs between the finger electrodes form a divider,
  buffered by one LM324 section:          Vc = VCC/2 * Rs / (R6 + Rs)
* R5 (200 kOhm) and the trim pot Rp (0-200 kOhm) form an offset, buffered by another:
                                           Vb = VCC/2 * Rp / (R5 + Rp)
* A x2 difference amplifier gives Vout = 2 * (Vc - Vb), followed by a 1 MOhm / 100 nF
  low-pass (fc ~ 1.6 Hz) on the SIG pin.

Writing u = Vout / VCC and b = 2 * Vb / VCC (0..0.5, set by the pot):

    u = Rs / (R6 + Rs) - b      =>      G = 1/Rs = (1 - u - b) / (R6 * (u + b))

The firmware references the ADC to VDD, which is the same 3.3 V rail that powers the sensor,
so u is simply counts / full_scale and supply drift cancels out.

Seeed's wiki formula, R = (1024 + 2x) * 10000 / (512 - x), is this expression with b = 0.5 but
with R6 taken as 20 kOhm instead of 200 kOhm, so it under-reports resistance by 10x.

With fingers off (Rs -> infinity) the output sits at u = 1 - b, unless the LM324 clips first
(it cannot drive within ~1.3 V of its supply, i.e. u ~ 0.55-0.6 on 3.3 V). Turning the pot so
that the open-circuit reading is as low as possible (Seeed's calibration step) gives b = 0.5.
"""

from __future__ import annotations

import math

R6_OHMS = 200_000.0
G_SCALE_US = 1e6 / R6_OHMS  # 5 uS: conductance at which Rs == R6

# Reading at or below this is the op-amp pinned at 0 V: conductance is above the measurable
# range for the current pot setting.
U_SATURATED_LOW = 0.004


def conductance_us(u: float, b: float) -> float:
    """Skin conductance in uS for a normalized reading ``u`` and pot offset ``b``."""
    s = u + b
    if s <= 1e-6:
        return G_SCALE_US * (1.0 - 1e-6) / 1e-6
    if s >= 1.0:
        return 0.0
    return G_SCALE_US * (1.0 - s) / s


def reading_for_conductance(g_us: float, b: float) -> float:
    """Inverse of :func:`conductance_us` (unclipped)."""
    s = 1.0 / (1.0 + max(g_us, 0.0) / G_SCALE_US)
    return s - b


def offset_from_resistor(u: float, r_ohms: float) -> float:
    """Pot offset ``b`` from a reading taken with a known resistor across the electrodes."""
    return r_ohms / (R6_OHMS + r_ohms) - u


def offset_from_open_circuit(u_open: float) -> float | None:
    """Pot offset ``b`` from the fingers-off reading, or None if that reading is clipped.

    The open-circuit level is 1 - b with b <= 0.5, so it is always >= 0.5. Above ~0.53 we can't
    tell a true open-circuit level from the LM324's output ceiling.
    """
    if 0.48 <= u_open <= 0.53:
        return min(0.5, 1.0 - u_open)
    return None


def measurable_range_us(b: float, u_ceiling: float = 0.55) -> tuple[float, float]:
    """(min, max) conductance the sensor can resolve with pot offset ``b``."""
    lo = conductance_us(min(u_ceiling, 1.0 - b), b)
    hi = conductance_us(U_SATURATED_LOW, b)
    return lo, hi


def log_ratio(a: float, b: float) -> float:
    return math.log(max(a, 1e-6) / max(b, 1e-6))
