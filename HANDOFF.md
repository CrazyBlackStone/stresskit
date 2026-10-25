# Handoff: live stress sensing (Cal Hacks)

A Seeed **XIAO nRF52840 Sense** with a **Grove GSR v1.2** reads skin conductance. A Python
service turns it into a live **stress index (0–100)** and a **stressed / not-stressed**
decision, and publishes both on a WebSocket for the calming game. README.md has the full
reference; this file covers where things stand and how to work with it.

## TL;DR

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m stresskit serve          # sensor plugged in (auto-detects the XIAO)
.\.venv\Scripts\python.exe -m stresskit serve --sim    # no sensor: realistic simulator + stress slider
```

* Dashboard: <http://localhost:8765/>
* Game feed: `ws://localhost:8765/ws` (JSON). Read `stress`, `stressed`, `level`, `reliable` from
  `state` messages (4 Hz), and `scr` events for individual skin responses.

## Status (2026-10-24)

| Piece | State |
|---|---|
| Firmware (`firmware/gsr_stream`) | Flashed and verified on the board: steady 10 Hz on COM4, 14-bit, cancels 50/60 Hz hum |
| Stress engine (`stresskit/engine.py`) | Tuned on about 50 min of real recordings; 23 simulator tests pass |
| Dashboard + WebSocket/REST server | Running against the real sensor; the game connects and runs |
| Personalization (90 s stress test) | **Not run yet.** Thresholds are population defaults. Do this before demoing. |
| Labeled validation on a person | Not done. Detections look physiological, but no session yet has "I was stressed at minute X" labels to check against. |
| Absolute µS accuracy | Approximate. The pot offset is assumed from the fingers-off level; see "Calibration". Relative changes (what the index uses) are unaffected. |

## Hardware

| Grove wire | XIAO pin | Notes |
|---|---|---|
| **yellow** (SIG) | **A5** / P0.05 | White is Grove "NC". On A5 it floats and reads a meaningless ~0.90. |
| red (VCC) | **3V3** | Keep 3.3 V: the reading is ratiometric to the ADC reference, and the pins aren't 5 V tolerant. |
| black (GND) | GND | |

* Straps go on the middle segments of the index and middle finger, **non-dominant hand**, metal pads on the skin.
  That hand stays still; play with the other one.
* Dry nickel electrodes "wet in": conductance can double in the first 2–5 minutes. The engine handles
  this, but moist fingertips help.
* Measured on this sensor: fingers-off reading u = 0.6445 (2.13 V); skin conductance 0.6–1.6 µS;
  noise about 0.002 µS per sample; mains hum about 80 counts inside each 100 ms window (cancelled by the averaging).
* Board not showing up as a COM port? Use a data USB-C cable, or double-tap the reset button. Re-flash with
  `python firmware/flash.py` (needs arduino-cli plus the `Seeeduino:nrf52` core; see README).
* **Only one program can own the serial port.** Close the live plot / Arduino serial monitor before `serve`.

## Working with the stress sensing

### Session lifecycle (what a frontend should show)

`state.phase` drives the UX:

1. `waiting_contact`: ask the player to put the straps on.
2. `baseline`: "sit still and relax". Show `calibration.progress` (0–1) and `calibration.remaining_s`.
   It takes 60 s of clean signal and extends up to 120 s while the electrodes settle (`calibration.settling`).
   Calibration starts automatically on first contact.
3. `ready`: `stress` / `level` / `stressed` are live. If the straps come off, `contact` goes false,
   `signal` becomes `no_contact`, the last value is held for 15 s, and then `level` becomes `unknown`.
   Re-attaching resumes; if the level shifted by roughly 30 % or more (electrodes moved), it recalibrates automatically.

Only drive gameplay from the index while **`reliable` is true**. That means calibrated, good signal,
and at least 60 % clean samples in the last 30 s.

### `state` message (4 Hz), the useful fields

| field | meaning |
|---|---|
| `stress` | 0–100 (null until calibrated); smoothed with a ~4 s time constant |
| `level` | `calm` (< 25) · `elevated` · `stressed` (≥ 55 held 4 s, released at ≤ 42 held 8 s) · `unknown` |
| `stressed` | boolean form of the above, with hysteresis |
| `trend_per_min` | slope of `stress` over the last 30 s. Negative means calming down, good for rewards. |
| `scr_rate_per_min` / `baseline_scr_rate_per_min` | skin responses per minute, now vs at rest |
| `scl_us` / `baseline_scl_us` / `scl_change_pct` | conductance level vs the adaptive resting reference |
| `evidence.phasic` / `evidence.tonic` | 0–1 inputs to the index (weighted 65 / 35) |
| `contact`, `signal`, `quality`, `reliable` | signal health |
| `calibration`, `reference`, `sensor`, `device` | calibration progress, stress-test status, raw sensor and connection diagnostics |

Other messages: `hello` (on connect: config, last 3 min of `history`, current `state`), `sample` (10 Hz:
`eda` µS or null, `u`, `contact`, `valid`), `scr` (`amplitude_us`, `rise_s`), `level`, `phase`, `contact`,
`artifact`, `notice`, `reference`, `mark`, `status`.

### Commands (send JSON on the WebSocket, or `POST /api/command`)

| command | effect |
|---|---|
| `{"cmd":"calibrate"}` | re-measure the resting baseline (player should sit still ~1 min) |
| `{"cmd":"reference_start"}` … `{"cmd":"reference_stop"}` | wrap **any stressor** (the dashboard's mental-math test, or your own minigame, ≥ 30 s, ideally 60–90 s) to personalize thresholds; the reply says whether it took. `reference_cancel` aborts |
| `{"cmd":"reset_personalization"}` | back to default thresholds |
| `{"cmd":"mark","label":"boss fight"}` | marker saved in the session recording |
| `{"cmd":"open_circuit"}` | re-zero the sensor; fingers must be OFF for 2 s (do this after turning the GSR pot) |
| `{"cmd":"resistor","ohms":200000}` | exact µS calibration with a known resistor across the electrodes |
| `{"cmd":"sim","stress":0.8}` / `{"cmd":"sim","contact":false}` / `{"cmd":"sim","auto":true}` | control the simulator (`--sim` only) |

Each command gets back `{"type":"ack","cmd":...,"ok":true|false,...}`, echoing the `id` you sent.
`GET /api/state` returns the latest state for poll-style engines. CORS is open, and `--host 0.0.0.0`
exposes it on the LAN.

```js
const ws = new WebSocket("ws://localhost:8765/ws");
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "state" && m.reliable) setCalm(1 - m.stress / 100);
  if (m.type === "scr") ripple(m.amplitude_us);
};
// personalize with your own stressor level:
ws.send(JSON.stringify({ cmd: "reference_start" }));  /* ...60-90 s later... */
ws.send(JSON.stringify({ cmd: "reference_stop" }));
```

## How the inference works (short version)

* **Conversion** (`conversion.py`): from the v1.2 schematic, `G = 5 µS · (1 − u − b)/(u + b)`. Seeed's
  wiki formula is 10× off (it uses 20 kΩ; the board has 200 kΩ).
* **Gating**: no contact, saturation, non-physiological jumps (> +10 % / −4 % of G in 100 ms) and the first
  5 s after touching are all excluded, never interpolated.
* **SCR detector** (`dsp.py`): online trough-to-peak, measured above the background slope so it still works
  while the level is climbing at stress onset. Step-shaped events (pressure/contact artifacts) are rejected
  by rise shape.
* **Index** (`engine.py`) = 65 % phasic (SCR rate above rest, full at +6/min) + 35 % tonic (level above an
  adaptive resting reference, full at about +28 %). The reference follows drops within ~1 min, and follows
  rises only while there are no SCRs. That absorbs electrode drift: on the first real session, the
  tonic-heavy version flagged "stressed" from drift alone, and now drift can reach "elevated" at most.
* All thresholds live in `EngineConfig`. Personal values are saved in `data/profile.json`.

**Caveat:** GSR measures sympathetic *arousal*. Excitement, startle, talking, deep breaths, heat and
moving the strapped hand look like stress too. About 10–20 % of people respond weakly; the
personalization step reports that.

## Repo map

| path | what |
|---|---|
| `firmware/gsr_stream/gsr_stream.ino` | acquisition firmware (non-mbed Seeed nRF52 core) |
| `firmware/flash.py` | compile + upload; works around the core's bug with spaces in paths |
| `stresskit/engine.py` | stress inference (state machine, features, index, calibration) |
| `stresskit/dsp.py`, `conversion.py` | filters, SCR detector, circuit model |
| `stresskit/server.py`, `web/index.html` | aiohttp server, WebSocket/REST API, dashboard |
| `stresskit/device.py`, `replay.py`, `sim.py` | serial reader, CSV replay, physiological simulator |
| `stresskit/liveplot.py` | raw matplotlib plot for wiring checks (`python -m stresskit plot`) |
| `tests/test_engine.py` | `python -m pytest -q` |
| `data/` (git-ignored) | session recordings `session-*.csv` and `profile.json`, local only |

## Next steps

1. Run the dashboard's **Personalize: stress test** with whoever will demo (90 s), and re-run it if
   the electrodes or wearer change.
2. Record a labeled session (rest → stress test → calming game) using markers, then check it with
   `python -m stresskit analyze data\session-….csv` and tune `EngineConfig` if needed.
3. Optional: BLE streaming (Bluefruit NUS) to go wireless; IMU motion gating using the Sense's LSM6DS3;
   known-resistor calibration for absolute µS.
