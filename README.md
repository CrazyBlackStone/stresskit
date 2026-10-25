# stresskit: live stress from a Grove GSR + XIAO nRF52840

Reads skin conductance (EDA/GSR) from a Seeed XIAO nRF52840 (Sense) and turns it into a live
**stress index (0–100)** plus a **stressed / not-stressed** decision. A dashboard and a
WebSocket/REST API let any frontend (web game, Unity, Godot, Pygame…) react to it.

```
Grove GSR ──A5──► XIAO firmware (10 Hz, 14-bit, hum-cancelling) ──USB serial──►
  stresskit engine (µS conversion → artifact gating → tonic + SCR features → personal baseline → index)
  ──► http://localhost:8765  dashboard
  ──► ws://localhost:8765/ws  JSON stream for your game
```

## Quick start

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # once
.\.venv\Scripts\python.exe -m stresskit serve                    # real sensor
```

Open <http://localhost:8765/>, put the straps on, and sit still for about a minute while it learns
your resting level. Then optionally click **Personalize: stress test**.

No sensor handy? `python -m stresskit serve --sim` runs a realistic simulator, with a slider for
the simulated stress level in the dashboard. It's ideal for building the game.

## Hardware

| Grove wire | XIAO pin |
|---|---|
| **yellow** (SIG) | **A5** (P0.05) |
| red (VCC) | **3V3**. Not 5 V: the nRF52840's pins are 3.3 V only, and on 3V3 the reading is ratiometric. |
| black (GND) | GND |
| white | unconnected (Grove "NC"). Putting this on A5 gives a floating, meaningless reading. |

The XIAO is worn on the **index finger** for finger tracing (see below). Straps go on the middle
segments of two fingers, metal pads against the skin. Ideally put them on the other hand and keep
it still; otherwise use the middle and ring fingers with snug straps. Moving electrodes cause
artifacts (most are rejected automatically, but not all).

Dry nickel electrodes need a few minutes to "wet in": conductance can double in the first minutes.
The engine copes with that, but slightly moist fingertips speed it up.

### Firmware

`firmware/gsr_stream/gsr_stream.ino` samples A5 at 500 Hz and averages 50 readings into each
10 Hz sample. A 100 ms window cancels both 50 Hz and 60 Hz mains hum. It prints
`millis,mean_counts,std_counts` lines. On the Sense board it also streams the IMU as
`I,micros,ax,ay,az,gx,gy,gz` raw int16 lines at 104 Hz. `#` lines are metadata, including the
IMU scale factors; send `i` to reprint them. To re-flash:

```powershell
.\.venv\Scripts\python.exe firmware\flash.py        # compile + upload, auto-detects the board
```

This needs [arduino-cli](https://arduino.github.io/arduino-cli/) with the Seeed core:
`arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json`
then `arduino-cli core install Seeeduino:nrf52`. If the board doesn't show up as a COM port, use a
data (not charge-only) USB-C cable, or double-tap its reset button.

## How the stress inference works (and why it's reliable)

1. **Correct physics.** Seeed's wiki formula is off by 10× (it assumes 20 kΩ; the v1.2 schematic
   uses 200 kΩ). `stresskit/conversion.py` models the actual circuit:
   `G = 5 µS · (1 − u − b)/(u + b)`, where `u` = reading/VDD and `b` = the pot offset, estimated
   from the fingers-off level.
2. **Signal gating.** Each sample is checked for finger contact, ADC saturation and
   non-physiological jumps (> +10 % / −4 % of G in 100 ms). The few seconds after re-contact are
   also excluded. Bad stretches are excluded rather than guessed.
3. **Skin responses (SCRs)**, the classic marker of sympathetic arousal, come from an online
   trough-to-peak detector. It works on a climbing baseline too, which is exactly when stress
   starts. It rejects step-shaped events (electrode pressure/contact) by shape: a real SCR takes
   1–3 s to rise.
4. **Personal baseline.** About 60 s of rest, extended up to 2 min while the electrodes are still
   settling, gives your resting conductance and resting SCR rate. Everything else is relative to
   *you*. Absolute µS differ hugely between people and days.
5. **Index = 65 % phasic + 35 % tonic evidence.**
   * Phasic is your SCR rate above your resting rate (0 at +1/min, max at +6/min).
   * Tonic is the conductance level above an adaptive resting reference (0 at +3 %, max at
     +28 %). The reference follows drops within about a minute. It follows rises only while
     there are no SCRs, so electrode drift gets absorbed but real arousal doesn't.
   * Drift alone can therefore reach "elevated" at most, never "stressed".
6. **Decision with hysteresis.** You enter `stressed` at ≥ 55 for 4 s and leave it at ≤ 42 for
   8 s. `calm` is < 25.
7. **Personalization (recommended).** The 90 s mental-arithmetic task (count down by 13, with a
   time limit and a buzzer on errors) measures how strongly *your* skin reacts. Your response to
   it is mapped to about 80/100. The result is saved in `data/profile.json`.

Validated in `tests/` against a physiological simulator: stress segments are detected, rest
segments never produce false alarms (8 random sessions), and pure electrode drift, motion
artifacts or a wrong pot calibration don't cause false alarms. Run the tests with
`python -m pytest -q`.

**Honest limits:** GSR measures sympathetic *arousal*, not stress specifically. Excitement,
startle, talking, deep breaths, heat and movement raise it too. The index means "more aroused than
your resting self". About 10–20 % of people are weak electrodermal responders; for them the
personalization step reports it, and the phasic evidence carries less signal.

## Using it from a game

### WebSocket `ws://localhost:8765/ws`

On connect you get `{"type": "hello", "history": [...], "state": {...}}`, then a stream of:

| `type` | rate | key fields |
|---|---|---|
| `state` | 4 Hz | `stress` (0–100 or null), `level` (`calm`/`elevated`/`stressed`/`unknown`), `stressed` (bool), `reliable` (bool), `phase` (`waiting_contact`/`baseline`/`ready`), `contact`, `signal` (`ok`/`no_contact`/`settling`/`artifact`/`saturated_low`), `scl_us`, `scl_change_pct`, `scr_rate_per_min`, `trend_per_min`, `evidence.{tonic,phasic}`, `calibration.{progress,remaining_s}` |
| `sample` | 10 Hz | `eda` (smoothed µS or null), `raw`, `u`, `contact`, `valid` |
| `scr` | per event | `amplitude_us`, `rise_s`. One skin response, nice for a ripple/flash effect. |
| `level` | on change | `level`, `stressed`, `stress` |
| `phase`, `contact`, `artifact`, `notice`, `reference`, `mark`, `status` | on change | |

Send commands as JSON: `{"cmd": "calibrate"}`, `{"cmd": "reference_start"}` /
`{"cmd": "reference_stop"}` (wrap your own stressor minigame in these to personalize),
`{"cmd": "mark", "label": "level 2 start"}`, plus `{"cmd": "sim", "stress": 0.8}` in sim mode.
Each command is answered with an `{"type": "ack", "ok": ...}` message.

```js
const ws = new WebSocket("ws://localhost:8765/ws");
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "state" && m.reliable) setCalmness(1 - m.stress / 100);  // drive your game
  if (m.type === "scr") spawnRipple(m.amplitude_us);
};
```

```python
import asyncio, json, websockets  # pip install websockets
async def main():
    async with websockets.connect("ws://localhost:8765/ws") as ws:
        async for raw in ws:
            m = json.loads(raw)
            if m["type"] == "state":
                print(m["stress"], m["level"])
asyncio.run(main())
```

### Finger tracing (IMU)

The XIAO Sense's 6-axis IMU streams at about 100 Hz as `imu` messages. The tracker
(`stresskit/motion.py`) fuses gyro and accelerometer into the finger's pointing direction and
exposes a laser-pointer-style cursor: `pointer.x` / `pointer.y` in −1…1, with x to the right and
y up. Double-integrating acceleration into position would drift within seconds.

Set-up:
1. Point the finger at the ceiling and send `{"cmd":"imu_forward","axis":"point_up"}`, or use the
   dashboard's "Set pointing axis…".
2. Aim at the screen centre and hold still: it auto-centres. Or send `imu_recenter`.

Messages also carry the raw `accel` (g) and bias-free `gyro` (°/s), `lin_accel`, `quat` and
`still`. `GET /api/imu` returns the latest one. Send `{"cmd":"subscribe","imu":false}` to stop the
stream on a connection. HANDOFF.md has the full field list.

### Lantern, the calming game

`http://localhost:8765/game` is a calming game for patients waiting before surgery; it runs in any
browser (tablet, phone, laptop). `http://localhost:8765/nurse` is the caregiver view: the stress
timeline, which activity calms this patient most, and the change since the start. The patient
never sees a stress number.

* **Roots**: trace a glowing vine with the finger sleeve (IMU pointer), or touch / mouse.
* **Sight**: 5-4-3-2-1 grounding. Find hidden things; select by aiming and tapping the finger
  (a jolt in `lin_accel`), holding still on a target, or tapping the screen.
* **Glow**: one big, quick breath in, then a slow breath out. The game sends
  `{"cmd":"expect_response"}` first; the SCR that follows is tagged `cued` and doesn't count as
  stress. SCRs that start while the sensor hand moves are tagged `motion` and don't count either.
  The game waits for that response: a cued SCR has to start after the cue (2 s slack, since people
  often breathe in during the countdown) and peak 1–14 s after it. If none comes, the lantern
  gently asks for the breath again instead of moving on. With no sensor reading, the patient taps
  "I took my breath"; after two unanswered tries a quiet "Skip this breath" appears.

Stress is read in the quiet scene after each round (only while the hand is still) and compared
with the minute before it. The activity that helps most gets a "bloom" bonus. Progress is
skill-based XP with a ceiling per round, so reaching dawn takes everyone a while; `?pace=4`
speeds it up for demos. Progress is saved per device; Settings → New patient resets it and
restarts the baseline. `scr` messages now carry `cued`, `motion` and `counted`.

Dev mode (`/game?dev=1`, the D key, or Settings → Sensor readout) overlays the live sensor while
you play: the last minute of EDA with each SCR marked (pink counted, yellow cued breath, grey hand
moving), the stress index with its thresholds (faded while the game ignores it), and the readings
behind the game's decisions: phase, signal, SCR rate, sleeve pointer and motion, and each round's
pre/post stress. It is off by default, so patients never see it.

**How stress shows up in the game** (no numbers for the patient, but visible cause and effect):
the sky reacts live (calm brings out an aurora, brighter stars and a glowing sea; rising stress
slows everything and brings the lantern closer). When stress stays above 45 during a round for
4 s, a "helping hand" turns on until it is back under 32 for 10 s: Roots widens the vine and
guides the seed, Sight sends a guide firefly and hides decoys, Glow slows down with a breathing
circle. A gold "Your lantern is helping" badge shows while it's on. After a round that raised
stress, the lantern invites the patient to a different activity. Every adaptation is logged in
the nurse view and marked on its chart. In dev mode, the **A** key toggles the helping hand to
demo it without a stressed wearer; `serve --sim` also cycles through a stressful stretch.

The activities live in `stresskit/web/lantern/{roots,sight,glow}.js`; `game.html` holds the
shared core (scenes, sensor link, input, the reactive world, voice, sound and effects).

#### The lantern's voice and kind words (Cartesia)

The lantern speaks its lines in a soothing [Cartesia](https://docs.cartesia.ai) voice: Sonic 3.6, the
library voice "Isla" (calm, gentle warmth, made for meditation), slowed to 0.85× with the `calm`
emotion. **Kind words** (a button on the boat, offered after the first round) has the patient say three
short affirmations back to the lantern ("I am safe right now."). The game records each one, the server
transcribes it with Cartesia speech-to-text (`ink-whisper`), and a lenient match turns it into a gold
star in the sky. Then one in their own words, which the lantern reflects back. Speaking raises skin
conductance like a big breath, so each listening window opens a cue and that response isn't counted
as stress. The nurse view lists which affirmations were said (never the patient's own words).

The key stays on the server. Set it with either:

```powershell
$env:CARTESIA_API_KEY = "sk_car_..."        # this PowerShell session, then run serve
```

or put it on the first line of `data\cartesia.key` (gitignored). Optional: `CARTESIA_VOICE_ID` (any
voice id from Cartesia's library) and `CARTESIA_MODEL` (default `sonic-3.6`).
`python -m stresskit voice "Hello"` checks the key and voice and saves the line under `data/voice/`,
where every spoken line is cached so it's only paid for once.

Without a key (or if Cartesia fails) the game still works: it speaks with a natural browser voice if
the device has one (Edge's "Online (Natural)" voices, Google's), and otherwise stays silent with its
text bubble and a soft chime. It never uses the robotic Windows voices. Listening falls back to the
browser's speech recognition, then to an "I said it" button. Settings → Lantern speaks aloud turns
the voice off.

### REST (for engines that prefer polling)

`GET /api/state` returns the latest state. `POST /api/command` takes a command body like
`{"cmd":"mark","label":"boss fight"}`. CORS is open, so a game served from another port (e.g.
Vite on :5173) can call it. Use `--host 0.0.0.0` to reach it from another device on your network.

Design tips: use `stress` for continuous feedback (calming visuals, music, pace) and `stressed` for
discrete events. Respect `reliable` (hold or fade feedback while it's false). Use `trend_per_min`
to reward the player for calming down. The physiology lags by about 1–3 s for SCRs and 10–60 s
for the level, so design for gradual changes.

## Other commands

```powershell
python -m stresskit serve --replay data\session-XXXX.csv --speed 4   # re-run a recording through the pipeline
python -m stresskit analyze data\session-XXXX.csv                    # print SCRs / level changes found in a recording
python -m stresskit plot                                             # raw live plot (wiring check)
python -m stresskit ports                                            # list serial ports
```

Every `serve` session is recorded to `data/session-*.csv`, including your markers. That's handy
for tuning thresholds offline: all of them live in `EngineConfig` in `stresskit/engine.py`.

## Troubleshooting

* **"No skin contact" with the straps on:** both pads must touch skin, and the white JST plug
  must be fully seated in the GSR board.
* **Reading pinned at 0 ("out of range")**: your conductance exceeds the range for the current pot
  setting. Turn the GSR board's potentiometer until the reading sits mid-bar in the Sensor panel,
  then click **Fingers off: zero sensor** with the straps off.
* **Port busy**: only one program can own COM4 (close the live plot, Arduino IDE serial monitor, or
  another `serve`).
