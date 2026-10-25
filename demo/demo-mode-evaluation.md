# Demo mode: where Lantern waits, and whether to cut it

## Verdict

**A broad demo mode isn't worth building.** The long waits exist for physiological reasons:

| Wait | Length |
|---|---|
| Baseline per wearer | 70-130 s |
| Rest measurement after each round | 35 s |
| Skin-response latency after a breath | 2-8 s |

Shortening any of them weakens the very claims a judge is asked to believe. The 3-minute judge path
(`demo/judge-walkthrough.md`) already avoids the big ones. The baseline is done before the judge
arrives, Glow is ended early with Finish, and the presenter talks over Rest. What's left is about 15 s
of dead time, and it's narrated.

**What is worth doing:**
- **Operational:** a pre-calibrated wearer, a warm simulator backup with motion set to "still", and
  4 pre-played rounds.
- **Optional:** a ~30-line `?demo=1` that trims presentation-only waits (design below). Build it only
  after the in-flight Glow and Cartesia work lands, because it touches the same files.

**Top 3 downtime sources**

| # | Source | Duration | Ref |
|---|---|---|---|
| 1 | Baseline calibration | 70-130 s per wearer; **112 s and 125 s measured** in the simulator. Plus 2-5 min of electrode wet-in. | `engine.py:58-63` |
| 2 | Rest scene after every round | **35 s** (35.3 s measured); Continue appears at 20 s | `game.html:132`, 1049-1053 |
| 3 | Glow's non-interactive transitions | **91 s of a 246 s round** (37 %) measured; about 60 s in a calm round. Plus about 18 s per unseen breath. | `glow.js:443-464` |

## How this was measured

**Code.** I read `game.html`, `glow.js`, `roots.js`, `sight.js`, `nurse.html`, `engine.py`,
`server.py` and `sim.py`. Line refs are to commit `0d53c73`, except `engine.py` and `glow.js`, which
are the working tree of 2026-10-25 with their in-flight edits.

**Simulator runs.** Two runs of `serve --sim --http-port 8767 --no-record --profile <scratch file>`.
- Note that `--port` is the serial port. `--sim --port 8767` fails with "argument --port: not allowed
  with argument --sim".
- The server ran from a scratch snapshot of `0d53c73` plus the in-flight `glow.js` and `engine.py`.
- I used the committed `game.html`. At 02:13 the working-tree copy threw
  `ReferenceError: Kind is not defined` (in `drawKindStars`) and froze the render loop. That was
  probably mid-edit, so recheck it before demoing.

**Browser.** A private headless Chrome, driven over CDP, logged the scene, phase, sensor phase and
every skin response every 250 ms.
- I first opened the game in a new tab of the shared browser pane. Other sessions' tabs were in front,
  and a background tab pauses `requestAnimationFrame`, so the game wouldn't advance there.
- `data/profile.json` was not touched (its mtime is unchanged, 01:57).

## Every wait

The "Demo could" column says how much `?demo=1` could shorten the wait. The last column is the cost
to scientific validity.

### Once per wearer / page load

| Wait | Where | Duration | Measured (sim) | Why it exists | Demo could | Validity cost |
|---|---|---|---|---|---|---|
| Electrode wet-in | physical (HANDOFF:45) | 2-5 min | n/a | Dry nickel pads: conductance can double. | No (do it before the judge) | n/a |
| Contact settle | `engine.py:47` | 5 s | n/a | The first seconds after touching are artifacts. | No | High: artifacts would become responses |
| **Baseline** | `engine.py:58-63`, `_baseline_step` 525-546 | 10 s settle + 60 s clean, extended to ≤120 s clean while drift is >5 %/min. **70-130 s** of wall time, more with artifacts. | **112 s, 125 s** after contact | Personal resting level and response rate, plus noise-adaptive response thresholds (`_finish_baseline` 553-565) | 30-45 s is possible (see the last section) | **High**: a noisy resting rate, thresholds from half the data, and leftover wet-in drift |
| Welcome "light" | `game.html:837-855` | Follows calibration; ~6-9 s once ready. Continue appears after 15 s. | 9.3 s (ready) / 5.5 s (still settling, see finding 2) | Narrative cover for the baseline | Skip for a returning wearer | None |
| Welcome breath | `game.html:862-879` | 7-16.5 s (11 s cue window, then 3.5 s) | 7.7 s (response 4.3 s after) | A first "it felt that!" | Keep: it's a wow moment | None |
| Setup (sleeve) | `game.html:880`, 891-935 | 2 OK clicks, ~10 s, on **every** load while a sleeve is connected | n/a | Teach the pointing axis | **Skip when the axis is saved.** `axisSaved()` exists at `game.html:936` but is never called. | None |

### Each round

| Wait | Where | Duration | Measured (sim) | Why it exists | Demo could | Validity cost |
|---|---|---|---|---|---|---|
| Pre-round reading | `game.html:133`, 1026 | 0 s (uses the last 20 s of history) | n/a | The "before" value | n/a | n/a |
| Glow intro | `glow.js:443` | 6 s ÷ timeScale | 5.8 s | Explains the rules | 3 s | None |
| Glow "Get ready" | `glow.js:444` | 3 s per breath (2 s on retries) | 3.0-4.2 s | Lead-in to the cue | 2 s | None |
| Glow inhale + exhale | `glow.js:445-450` | 1.6 s + (6 s + 2 s × help) + 1 s | 8.6 s calm, up to 14.4 s with help | **This is the exercise.** The slow exhale is the calming part. | No | It's the intervention |
| Glow "listen" | `glow.js:63`, 455-457 | Until the response, at most cue + 11.5 s | Response 2.8-4.3 s after the cue (8/8 seen across both runs), so usually 0 s extra | A skin response peaks 2-8 s after a big breath | No | **High**: a shorter window misses real breaths |
| Glow retry | `glow.js:458`, 485-492, 470 | "again" 4.5 s + ready 2 s, so a new cue every ~18 s. Skip after 2 tries. | n/a (all seen) | Never pretend a breath was seen | Offer Skip after 1 try | None (skips are recorded as unseen) |
| Glow reveal | `glow.js:512` | 3.6 s × 5 + 1.4 s | 3.5-4.7 s | The beam sweeps to the new find | 2 s | None |
| Glow beam | `glow.js:320`, 586 | 12 s charge (10 s partial), draining 30 % slower with help | 12.1-19.7 s | **Play**, not downtime | n/a | n/a |
| Glow rest between breaths | `glow.js:464`; timeScale `game.html:444` | (3 s + 6 s × help) ÷ timeScale | 3.0-3.8 s calm, **9.6-12.1 s** with help | Recovery. With help, the breathing circle. | No: it *is* the adaptation | Would hide the adaptation |
| **Whole Glow round** | 6 breaths | ≥182 s calm | **246 s** (help was on for 104 s during the sim's scripted stressor) | | | |
| Roots start | `roots.js:465-486`, 330, 337 | A touch on the seed, or the sleeve steady for 1 s; then a gentle first ~20 s | n/a | Re-centres the pointer; warm-up | No | None |
| Sight wave change | `sight.js:587`, 662 | 4.6 s + 1.4 s after wave 1 (the grounding line); 2.6 s + 1.4 s after that | n/a | Time to read the 5-4-3-2-1 prompt | 2 s | None |
| End-of-round fade | `game.html:1038` | 1.6 s | 1.8 s | Transition | No | None |
| **Rest** | `game.html:132`, 1049-1057 | **35 s**, Continue at 20 s, measured from 12 s on | 35.3 s; Continue shown at 20.0 s | The response-rate memory is ~30 s (`engine.py:67`) and the index is smoothed ~4 s (`engine.py:80`). The first 12 s still carry the round's arousal. Readings need the hand still (`game.html:214`) and at least 4 samples (`game.html:239-242`). | Continue at any time, but **record "not measured"** if the window is under 8 s | **High** if the window is shortened for rounds that count: "What helps" and the bloom bandit would learn from the round's own tail |
| Results | `game.html:1095-1132` | User-driven | n/a | n/a | n/a | n/a |
| Voyage | `game.html:1143` | 22 s | n/a | The crossing animation | 10 s | None |

**Where a measured Glow round goes (sim run 1, 246 s):**

| Part | Seconds | Share |
|---|---|---|
| Aiming the beam (play) | 91 | 37 % |
| Guided inhale + exhale (the exercise) | 64 | 26 % |
| Transitions | 91 | 37 % |

The transitions break down as intro 6 s + ready 22 s + reveal 21 s + rest between breaths 41 s +
fade 1.6 s. A breath cycle took ~30 s while calm and ~47-52 s with the helping hand on.

### Progress and adaptation

| Wait | Where | Duration | Why it exists | Demo could | Validity cost |
|---|---|---|---|---|---|
| XP to Dawn | `game.html:131`, 180, 1093-1099; stages 143-149 | Roots 371 / Sight 371 / Glow 239 XP. Par is 200 / 190 / 120 points per round. That's **≥6 par rounds (~30-45 min with Rest and Results)** at `pace=1`, and about 3-4 rounds (roots ≥93, sight ≥93, glow ≥60 points) at **`?pace=4`**. A hands-off Glow round with 6 breaths seen and no catches scored ~20. | Skill-based progression | Already exists: `?pace=4` | None |
| Helping hand on / off | `game.html:466`; `engine.py:67`, 80 | ≥45 held 4 s / ≤32 held 10 s, on an index with a 4 s smoothing and a 30 s rate memory. **Sim: on about 25 s after the scripted stressor began.** | Hysteresis against flicker | Already exists: **A** (dev, logged "forced (dev)") | None, as long as it stays labeled |
| Care view "Calms them most" / "since the start" | `nurse.html:200-202`, 183-184 | ≥2 measured rounds per activity / >7 min of reliable data | Not enough data | Pre-play | None |

## Minimal `?demo=1` design (do not implement yet)

Presentation-only, about 30 lines in `game.html` and `glow.js`. No server or engine changes.

```js
const DEMO = PARAMS.has("demo") && PARAMS.get("demo") !== "0";
// CFG.pace: default 4 in demo mode unless ?pace= is given
// Welcome.next(): if (DEMO && axisSaved()) go(Harbor) instead of Setup   (axisSaved already exists)
// Glow: intro 6 -> 3 s; reveal 3.6 -> 2 s; show "Skip this breath" after 1 unseen try instead of 2
// Rest: show Continue at once; in done(), if (clock() - this.start < CFG.restMeasureFrom + 8) post = null
//       -> the existing code already drops a null post from effects (game.html:1059-1063): "not measured"
// Voyage: dur 22 -> 10 s
// link.mark("lantern demo mode") on start; the dev overlay header shows "DEMO"
```

Expected saving is about 3 s per Glow intro, about 8 s of reveals per round, any number of seconds on
Rest (at the price of an unmeasured round), 12 s per Voyage and about 10 s of Setup per page load.
On the 3-minute judge script that's roughly 5-10 s. That's why this is optional.

**It must never:**
- Inject, replay, scale or smooth over sensor data, or synthesize a skin response or a `cued` flag.
  "The lighthouse heard you" needs a real cued response.
- Change the engine baseline, thresholds, hysteresis, cue window or motion gating.
- Turn the helping hand on by timer or script. Forced help stays on the manual **A** key and stays
  logged as "forced (dev)".
- Count a Rest measurement shorter than today's minimum (8 s of window), or extrapolate one.
- Run on the simulator without saying so. The overlay already shows `simulator`.

## Better than a demo mode (operational, zero code)

1. **One baseline per wearer.** Calibrate and personalize before judging. Never reload, use New
   patient or Recalibrate in front of a judge.
2. **Warm simulator backup:**
   `serve --sim --http-port 8770 --no-record --profile <throwaway file>`, started at least 3 min
   early. Set its motion to **still** (finding 4).
3. **Pre-play 4 rounds** so the care view has history.
4. **End rounds with Finish and talk over Rest.** That turns the 35 s wait into the "this is the
   measurement" beat.

## If a short baseline is ever wanted (not recommended)

This is for a judge who wears the kit. Make it a CLI flag such as `--quick-baseline`:
`baseline_s` 60 → 30 s and `max_baseline_s` 120 → 45 s.

**Cost:**
- The resting response rate comes from about half as many events. The shrinkage
  `(n + 2) / (w/60 + 1)` (`engine.py:553-554`) pulls it toward the 2/min prior.
- The noise thresholds are estimated from 300 steps instead of 600.
- Electrodes that are still wetting in hand more drift to the tonic reference.

**If built:**
- Tag the phase event `short baseline`.
- Show it in the overlay.
- Exclude those sessions from tuning.

The judge swap-in in the walkthrough avoids the need: skin responses (breath, startle, fireflies)
don't need a baseline at all.

## Findings along the way (not fixed; other sessions own these files)

1. **`--port` vs `--http-port`.** Any run instructions that say `serve --sim --port N` are wrong.
   `--port` is the serial port and conflicts with `--sim`.
2. **Welcome finishes too early when the baseline is extended.**
   - `Welcome.update` treats `calibration.progress == 1` as done (`game.html:844`, 854). Progress
     reaches 1 after 60 s of clean signal, while the engine keeps extending the baseline as long as
     `settling` is true.
   - Measured: Welcome ended 5.5 s after the click with `phase=baseline settling=true`. It skipped the
     first-breath moment (`sensorReady()` was false) and the first Glow round started before the
     sensor was ready (it became ready 5 s into the intro).
   - Idea: hold progress below 1 while `calibration.settling` is true.
3. **`axisSaved()` is unused.** Setup runs on every page load while a sleeve is connected
   (`game.html:880`, 936).
4. **Simulator motion breaks the Rest measurement.**
   - The simulator's default motion (`auto`: 6 s still out of every 42 s) makes the game's "hand
     still" rule (`game.html:214`) reject most stress readings. Run 2's Rest produced `delta: null`.
   - Set the Simulator → motion select to "still" before demoing on the simulator.
   - Server-side motion gating is already off in the simulator (`server.py:129-130`). The game's own
     rule isn't.
5. **Misleading care-view wording.** When a round ends with help on, the care view logs it as "▼
   Calmer (round over): … back to normal" (`game.html:468`, `nurse.html:157`), but nothing was
   measured. Consider a neutral wording.
