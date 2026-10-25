# Lantern: 3-minute judge walkthrough

A live demo of **stresskit + Lantern** for a hackathon judge: a ring on the finger, two finger straps
reading skin conductance, and a calming game for patients waiting before surgery that adapts to the
wearer's arousal without ever showing a number.

**Line references.** `file:line` points at commit `0d53c73` for `game.html`, `roots.js`, `sight.js`,
`nurse.html`, `index.html`, `server.py`, `sim.py`, `README.md` and `HANDOFF.md`. For `engine.py` and
`glow.js` it points at the working tree of 2026-10-25, which includes their in-flight edits. `game.html`
is being edited right now (Kind words, Cartesia voice), so if a line has moved, search for the quoted
name.

**Landing soon** (other sessions; this script doesn't depend on them):
- **Glow waits for the breath.** Glow's breath step now waits until the skin registers the breath.
  If it doesn't, the game re-prompts gently about every 18 s, and "Skip this breath" appears after
  two tries. This is already in the working tree and is timed below.
- **Cartesia voice.** A soothing Cartesia text-to-speech voice for the lantern, plus spoken
  affirmations that the patient says out loud (Cartesia speech-to-text). Expect a "Kind words" offer
  on the boat after the first round.

---

## Before the judge arrives (setup checklist)

**T-30 min**
- [ ] Close the Arduino serial monitor and `stresskit plot`. Only one program can own COM4
      (README:223).
- [ ] Start the real server with `.\.venv\Scripts\python.exe -m stresskit serve`. It auto-detects the
      XIAO, and the console prints the phase every 5 s.
- [ ] Put on the kit. The XIAO ring goes on the index finger. The straps go on the middle segments of
      two fingers of the **other** hand, and that hand rests flat (README:36-39). Dry electrodes take
      2-5 min to "wet in", and conductance can double meanwhile (HANDOFF:45). A slightly moist
      fingertip helps.
- [ ] Wait for the baseline. It starts automatically on contact and takes 10 s of settling plus 60 s
      of clean signal. While the level still drifts by more than 5 %/min, it extends to as much as
      120 s of clean signal (`engine.py:58-63`, `_baseline_step` 525-546). In the simulator, `ready`
      came **112 s and 125 s** after contact.
- [ ] Personalize. On the dashboard, run **Personalize: stress test**, a 90 s serial-13 subtraction
      (`index.html:763`). Right now `data/profile.json` has `tonic_full`/`rate_full` = null, so the
      index uses population defaults (HANDOFF:28).
- [ ] Set the pointing axis. Use the game's Setup screen (point at the ceiling, OK; point at the star,
      OK) or the dashboard's "Set pointing axis…". It's saved in `data/profile.json`.
- [ ] **Pre-play 4 rounds** with `?pace=4`: 2× Glow, 1× Roots, 1× Sight. This gives the care view a
      history. "Calms them most" needs at least 2 measured rounds of one activity (`nurse.html:200-202`),
      and "since the start" needs more than 7 min of reliable data (`nurse.html:183-184`).

**T-5 min**
- [ ] Open three tabs in one full-screen window (F11). Switch between them with Ctrl+1 / Ctrl+2 / Ctrl+3.
  1. `http://localhost:8765/game?dev=1&pace=4` is the game. `dev=1` opens the sensor overlay
     (`game.html:252`) and `pace=4` multiplies XP by 4 (`game.html:130`). Leave it on the **boat**
     (Harbor) screen.
  2. `http://localhost:8765/nurse` is the care view.
  3. `http://localhost:8765/` is the dashboard, for Q&A and fallbacks only.
- [ ] Turn sound on (⚙ → Sound) and tap the canvas once. Browsers need a gesture before audio plays
      (`game.html:559`). That click also gives the page keyboard focus for **D** and **A**.
- [ ] Keep both hands still between beats. A skin response that starts within 1 s of ring-hand motion
      is tagged `motion` and ignored (`engine.py:105`, `server.py:39-40`).
- [ ] **Warm backup:** start a simulator on a second port now (see Fallbacks). It needs about 2 min of
      its own baseline.

**T-1 min.** Read the dev overlay. It should show `ready · ok`, `stress reading on`, and stress under
about 40. If stress is higher because you're nervous, that's fine: the helping hand may turn on by
itself during Glow, and you narrate it as the real thing.

**Never press during judging:**
- ⚙ → **New patient**. It wipes progress and sends `calibrate`, which restarts the 70-130 s baseline
  (`game.html:1233-1238`).
- Dashboard **Recalibrate** or **Fingers off: zero sensor**.
- A page reload. Welcome and the first breath replay, which costs about 17 s.

**Keys**
- **D** toggles the dev overlay (`game.html:358`).
- **A** toggles the helping hand. It works only while the overlay is open **and** a round is running
  (`game.html:359`, `assist.force` 492). The care view logs it as "Forced (dev)".

---

## The script (3:00)

The presenter wears the kit. The judge watches the game tab, which has the dev overlay open at the
top right.

| Time | Say | Do | Judge sees |
|---|---|---|---|
| **0:00-0:20** | "Waiting for surgery is anxious, idle time. Lantern is a calming game for it. This ring is a pointer. These two straps read skin conductance, my sweat glands' response, which is driven by the sympathetic nervous system. The patient never sees a number. The world changes instead." | Hold up the hand with the ring. Gesture at the overlay. | The night-sea boat. Three cards (Roots / Sight / Glow), one marked "In bloom". The live EDA trace at top right. |
| **0:20-0:29** | "Glow trains one big breath. The sensor can't see slow breathing, but it can see one big, quick inhale: a skin response 2-8 s later. The game tells the server a breath is coming, so that response is tagged 'cued' and never counts as stress." | Click **Glow**. | "Light the lighthouse" for 6 s, then "Get ready… Breath 1 of 6" for 3 s (`glow.js:443-444`). |
| **0:29-0:38** | (quiet) "Watch the trace." | When "Breathe in, big and quick!" appears, inhale hard through the nose (1.6 s), then exhale slowly for 7 s (`glow.js:445-450`). Keep both hands still. | Motes rush into the lantern, then mist rolls out. A **yellow line** (cued response) appears on the EDA trace. The sim measured this 2.8-4.3 s after the cue. |
| **0:38** ★ | "There, that was my body." | (nothing) | **WOW 1:** "The lighthouse heard you", a flare and a chime, and a whale surfaces (`scoreBreath`, reveal 3.6 s, `glow.js:512`). |
| **0:42-0:50** | "The ring's IMU fuses gyro and accelerometer into a pointing direction, like a laser pointer. Position from acceleration would drift within seconds." | Aim the ring finger at the boat and hold until its ring fills (0.6 s). Then sweep to the next one. | **WOW 2:** the beam follows the finger, boats sail home, the chain climbs ×2, ×3. Charge lasts 12 s (`glow.js:320`). |
| **~0:48** ★ | "When stress stays above 45 for 4 s during a round, the lantern steps in. It turns off after 10 s under 32 (`game.html:466`). I'll force it so we don't wait for me to panic. The log will say 'forced'." | Press **A**. | **WOW 3:** the gold "✨ Your lantern is helping" badge, the voice line "Let's slow down together…", a warm wash. The sea slows (`challengeFactor` drops toward 0.45, `game.html:502`), the light pool grows, and the charge drains 30 % slower (`glow.js:586`). |
| **0:54-1:05** | "Help makes it easier, never richer. Points are scaled down while it's on, so nobody learns to get stressed for points." | (watch) | The rest between breaths stretches to 3 s plus 6 s × help (`glow.js:464`). A breathing circle reads "breathe in…" for 4 s and "…and slowly out" for 6 s. |
| **1:05** | | Click **Finish**. | A 1.6 s fade (`game.html:1038`), then the quiet Rest scene. |
| **1:07-1:22** | "This quiet scene is the measurement. We take the median stress over the 20 s before the round and over the Rest scene from 12 s on, only while the hand is still (`game.html:132-133`, 214, 1057). The difference decides which activity 'blooms' for this patient. It's a small Thompson-sampling bandit (`game.html:949-960`)." | Point at the overlay's `rest pre … · post starts at 12 s` line. | The boat on calm water and a slow progress ring. |
| **1:22-1:55** | "The care view is the only place with numbers. Shaded spans are rounds and dashed lines are adaptations. Every adaptation is logged with its reason, including the one I just forced." | **Ctrl+2** (nurse). | Tiles: Stress now / First 5 min / Last 5 min / Calms them most. A timeline with rounds and "help on" markers. "How the game adapted", with **"Forced (dev) during Glow: helping hand on (slower pacing, breathing circle)"** on top and the real pre-play rows below. "What helps" shows the average change per activity. |
| (heads-up) | If asked about the "▼ Calmer (round over): Glow back to normal" row directly above: "That only means the round ended with help still on. Nothing was measured there." (`game.html:468`, `nurse.html:157`) | | |
| **1:55** | | **Ctrl+1** (game). | Rest has auto-ended at 35 s (`game.html:1053`). The Results card shows the light gained, maybe a find. |
| **1:58-2:30** ★ | "Your turn. Try to startle me: clap or say my name loudly, whenever you like." | Both hands flat and still, eyes on the judge. | **WOW 4:** 1-3 s later the trace jumps and a **pink** (counted) line appears. Three **fireflies** drift in to keep the lantern company (`game.html:741-746`). An unprompted response is treated as a moment of worry, and the patient is never told. |
| (if nothing by ~6 s) | "Startles fade fast with repetition. Let me take a deep breath without being asked." | One big breath, uncued. | Pink line and fireflies. "It's the same breath as before. This time the game didn't ask, so it counts. That's the cued vs counted split." |
| **2:30-3:00** | "Honest limits: GSR measures arousal, not stress. Talking, startle, heat and movement raise it too. The index means 'more aroused than your resting self', and 10-20 % of people respond weakly. So far it's validated on a physiological simulator and about 50 min of our own recordings. A labeled pilot with caregivers comes next." Then the ask. | | |

**Timing slack.** The only fixed waits on this path are Glow's 9 s lead-in, the 3.6 s reveal and the
35 s Rest, and you talk through all of them. If the first breath isn't seen by the end of the
exhale, the game says "The lighthouse is listening…" until 11.5 s after the cue, then "Let's try that
once more" (`glow.js:450-458`, `retry` 485). That costs about 18 s, so drop the 0:54 beat.

### Swap-in: the judge wears it (if they're curious and you have +60 s)
1. Take off the ring and straps. The judge puts them on (about 20 s): ring on the index finger,
   straps on two fingers of the other hand, and that hand flat on the table.
2. The signal is valid 5 s after contact (`engine.py:47`). Skin responses are detected straight away,
   on any valid signal, even before the baseline is ready (`engine.py:385-403`).
3. On the boat or Results screen, the judge takes one big breath. 2-6 s later they get a pink line
   and fireflies.
4. **Say it honestly:** "It's re-learning your resting level now." If the new wearer's level differs
   by 30 % or more, the engine starts a new 70-130 s baseline (`engine.py:95`, `_check_reattach`
   493-500). The overlay shows `calib xx%`, and the stress index pauses until it's done.
5. After the judge leaves, put the kit back on. Expect another automatic re-baseline of about 2 min.
   Use the warm simulator tabs if the next judge is already waiting.

---

## What makes each wow moment real

| Moment | Mechanism | Fails when | Recovery |
|---|---|---|---|
| Breath lights the lighthouse | The game sends `expect_response` (11 s window). The engine tags a response that peaks 2 s or more after the cue, inside the window, as `cued`, and it doesn't count as stress (`engine.py:102-105`, `_on_scr` 505-510). | Weak responder, dry electrodes, ring-hand motion. | Gentle re-prompt about every 18 s. "Skip this breath" after 2 tries (`glow.js:470`, 485-492). |
| Finger pointer | The IMU fusion gives a pointing direction, and the game smooths it (`game.html:375-392`). | Slow yaw drift (no magnetometer). | Hold still, aimed at the screen (it auto-centres), or touch the screen: touch overrides the ring for 4 s (`game.html:373`). |
| Helping hand | Stress at 45 or above for 4 s turns it on; 32 or below for 10 s turns it off. It's logged as a `lantern adapt` marker (`game.html:466-491`). | The wearer is calm (good!). | **A** in dev mode. It's logged as "forced (dev)", so it's never presented as real. |
| World reacts to calm | `world.calm = 1 - stress/60`, smoothed over 5 s. That drives the aurora, stars and sea glow (`game.html:458-462`, 588-622). | The index lags 10-60 s (README:200-202). | Point it out on the care-view timeline instead. |
| Fireflies after a startle | A `counted` response (not cued, not motion) in a calm scene (`game.html:742-746`). | The startle comes with a flinch, which tags it as motion. Startles also habituate. | An uncued deep breath works reliably. |
| Care-view log | Marker strings from the game, parsed in `nurse.html:127-164`. | No pre-play history. | Pre-play 4 rounds (checklist). |

---

## Fallbacks

| Problem | Do this (≤ 30 s) |
|---|---|
| **Board not streaming** (overlay says `server offline`, or "no sensor" in the top pill) | Check the data USB-C cable. Double-tap reset. Check that nothing else holds COM4. Still dead? Switch to the **warm simulator** tabs. |
| **Warm simulator** (start it at T-5) | `.\.venv\Scripts\python.exe -m stresskit serve --sim --http-port 8770 --no-record --profile data\sim-profile.json`. Note that `--port` is the **serial** port and `--http-port` is the web port. Pointing `--profile` at a throwaway file keeps `data/profile.json` safe. Open `http://localhost:8770/game?dev=1&pace=4` and `/nurse`. Say **"this is the simulated wearer"** out loud. The overlay header reads `simulator` (`game.html:320`). |
| In the simulator | Open the sim dashboard (`http://localhost:8770/`) and set the **Simulator → motion** select to **still** (`index.html:293`). The default `auto` pattern keeps the simulated finger moving 36 s of every 42 s (`sim.py` `MOTION_SCHEDULE`), so the game's "hand still" rule rejects most readings and the Rest pre/post often comes back empty. Aim with touch or mouse instead. Glow breaths are answered 85 % of the time (`server.py:275-277`). The scripted scenario has a 90 s stressor at 158-248 s of each 578 s loop (`sim.py:40-47`). In a test run the helping hand switched on **by itself** about 25 s into it. For on-demand stress, use the dashboard's Simulator slider at about 80 % (`index.html:284-295`). Allow 10-30 s. |
| **Pointer drifts or jitters** | Touch or mouse works at any time. In auto mode a touch takes over (`game.html:373`). Or use ⚙ → Controls → "Touch / mouse only". Roots re-centres itself at each start (`roots.js:472-484`). |
| **Breath not seen twice** | Click "Skip this breath". Say: "It never pretends to have seen a breath. About 1 in 5 people respond weakly." Show the live trace to prove the signal is there. |
| **Strap slipped** ("skin: not on") | Re-seat it. The last value is held for 15 s (`engine.py:86`). If the level shifted 30 % or more, it recalibrates by itself. Carry on with the parts that don't need the index. |
| **Tab froze / page error** | Reload the game tab. Progress is in localStorage, and the server keeps the marks and the stress history, so the care view rebuilds (`server.py:221-235`). Reloading costs about 17 s of Welcome and breath. |
| **No sound** | Tap the canvas once. Then check ⚙ → Sound. |

---

## Likely judge questions

**Is GSR really stress?**
No, it measures sympathetic arousal. Sweat glands get sympathetic input only, so GSR is a clean
arousal channel, but excitement, startle, talking, deep breaths, heat and movement raise it too. Four
things make it usable:
1. It's always relative to *your* resting baseline.
2. The index weights phasic responses (rate above rest) at 65 % and the tonic level at 35 %. Tonic
   alone caps at 35, so electrode drift can only ever reach "elevated" (`engine.py:15-24`).
3. Breaths the game asked for (`cued`) and responses during hand motion (`motion`) don't count.
4. "Stressed" needs 55 or more held for 4 s, and it releases at 42 or less held for 8 s
   (`engine.py:82-85`).

**How accurate is it? Is it validated?**
Not clinically, and we say so.
- A simulator test suite checks that stress segments are detected, that rest never false-alarms
  across random sessions, and that electrode drift, motion artifacts or a mis-set pot don't trigger
  alarms (README:89-92).
- The thresholds were tuned on about 50 min of real recordings (HANDOFF:26).
- A labeled session on a person is still to do (HANDOFF:29).
- Next: labeled sessions (rest, the 90 s stressor, then the game, with markers), then a pilot that
  compares the care view with patient-reported anxiety.

**Why not a heart-rate wearable?**
- Heart rate is pushed by both nervous-system branches, by breathing and by posture. Pre-op
  medication can blunt it.
- Skin conductance is sympathetic only, and each response arrives 1-3 s after the event. That's
  what lets the game react to a single breath or startle. HRV needs minute-long windows.
- Consumer watches rarely expose raw EDA in real time.
- Fusing heart rate in later would help, especially for weak electrodermal responders.

**Clinical use?**
It's a comfort and engagement tool, not a diagnostic or a medical device.
- The care view helps a nurse see who's struggling and what calms them, but it doesn't replace
  assessment.
- Hygiene: the enclosure is PETG that wipes clean with isopropyl alcohol (`enclosure/ENCLOSURE.md`).
  Electrode hygiene between patients is still an open item.
- A hospital pilot would need ethics approval and nurse workflow input.

**Privacy?**
- Sensor data never leaves the laptop. USB goes to a local Python server, and the game and care
  view are served on localhost. There are no accounts, names or cloud.
- Recordings are local CSVs in `data/`, which is git-ignored. Use `--no-record` to turn them off.
- Progress is per device in the browser. ⚙ → New patient clears it.
- **Landing soon:** the Cartesia voice sends the lantern's lines to Cartesia for speech, and the
  spoken affirmations send audio to Cartesia for transcription. That should be opt-in, with an
  on-screen fallback.

**How fast does it react?**
- Single responses: 1-3 s of physiology plus detection. The simulator measured 2.8-4.3 s from cue to
  game.
- The stress level: it's smoothed with a ~4 s time constant on top of a ~30 s response-rate memory
  (`engine.py:67`, 80), so 10-60 s (README:200-202). That's why the helping hand needs 4 s above 45,
  and why the after-round measurement skips the first 12 s.

**What if the patient is bad at the game?**
- Scores have no harsh fail states, and every activity has a gentle end.
- The helping hand eases difficulty when stress rises.
- XP has a per-round ceiling, so skill helps but can't skip the journey (`game.html:1091-1094`).

---

## Timing cheat sheet (from code; measured in the simulator where noted)

| Step | Duration | Ref |
|---|---|---|
| Electrode wet-in | 2-5 min (physical) | HANDOFF:45 |
| Baseline after contact | 70-130 s (sim: 112 s, 125 s) | `engine.py:58-63` |
| Welcome, sensor ready, until the breath step | ~6-9 s (sim: 9.3 s) | `game.html:837-855` |
| Welcome breath step | 7-16.5 s (sim: 7.7 s) | `game.html:862-879` |
| Glow lead-in before breath 1 | 6 s + 3 s | `glow.js:443-444` |
| One Glow breath cycle, calm / helping | ~30 s / ~47-52 s (sim) | `glow.js:443-464` |
| Full Glow round, 6 breaths | ≥182 s. Sim: 246 s, with 104 s of natural help | |
| Unseen-breath re-prompt | ~18 s per try; Skip after 2 | `glow.js:457-458`, 470 |
| Rest after a round | 35 s, Continue at 20 s, measured from 12 s (sim: 35.3 s) | `game.html:132`, 1049-1057 |
| Voyage to the next island | 22 s | `game.html:1143` |
| Helping hand on / off | ≥45 for 4 s / ≤32 for 10 s | `game.html:466` |
