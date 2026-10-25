# Lantern demo video: production plan

**Length: 5:00 maximum. Lock the edit at 4:58.** The user set five minutes. That is long enough for the
most convincing thing we have: **one uncut, real-sensor take** where a skin response shows up on the trace and
the game reacts, followed by the helping hand, the finger sleeve and the care view, each with room to land. The
two spare seconds absorb platform rounding, since some uploaders count 5:00.4 as over. If the submission form
turns out to cap videos at 3:00, Appendix A has a 2:50 cut built from the same footage.

| | |
|---|---|
| Deliverable | 1920×1080, 60 fps, H.264 MP4, stereo 48 kHz, −14 LUFS integrated, uploaded to YouTube (public or unlisted) and linked on Devpost |
| Voice | Calm and warm, about 140 wpm. Core VO script is 606 words; with the optional lines it is 680 (§8) |
| Look | The game's own night palette: navy `#0b1026`, lantern gold `#ffd27a`, rose `#ffb0c4`, sea blue `#9cc7ff` (`game.html` `:root`) |
| On camera | "Patient": the teammate with the **strongest skin responses** (test everyone first, §5). "Nurse": a second teammate. Off camera: a stimulus operator and an OBS operator |
| Ground rule | Nothing in the film is simulated, sped up or cut inside the live take. Where we trigger something by hand, the caption says so (§11) |

Code references below were checked against the working tree on 2026-10-25 at about 02:15. `game.html`,
`glow.js`, `server.py` and `nurse.html` are being edited in other sessions right now, so for those files this
plan cites names (scenes, objects, strings) rather than line numbers.

---

## 0. What we film, and its status

| Feature | Where it lives | Status | Fallback if it isn't ready on shoot day |
|---|---|---|---|
| Welcome breath: "Now one big, quick breath in" → "It felt that!" | `game.html` `Welcome.breath()` | committed | none needed |
| Glow: cued breath → "The lighthouse heard you" + reveal (whale first) | `glow.js` `Glow.scoreBreath()`, `GLOW_REVEALS` | committed | none needed |
| Glow waits for the skin to answer and re-prompts gently ("The lighthouse is listening for your breath…", "Let's try that once more", then "Skip this breath") | `glow.js` `GLOW_RETRY`, `Glow.retry()`, `listen` phase | **in flight** (uncommitted) | Committed Glow moves on after 12 s with a partial charge ("The lighthouse felt that"). Use that as the contrast in S6 instead of the re-prompt |
| Comfort fireflies on an unprompted, counted skin response | `game.html` `comfort` + `drawComfort()`; only in scenes with `allowComfort` (Harbor, Rest, Results, Voyage, Collection, Kind) | committed | none needed |
| Helping hand: on at stress ≥ 45 held 4 s, off at ≤ 32 held 10 s, gold "✨ Your lantern is helping" badge | `game.html` `assist` (`ON_ABOVE: 45, OFF_BELOW: 32, ON_HOLD: 4, OFF_HOLD: 10`) | committed | **A** key in dev mode forces it. The dev overlay then prints "(forced, A)", and the caption must say so |
| Gentle mood + world calm (aurora, stars, glowing sea) | `game.html` `updateMood()`, `updateWorld()`, `drawAurora()`, `drawSeaGlow()` | committed | none needed |
| Rest scene measures pre/post; "In bloom" card; invite to another activity | `game.html` `Rest`, `pickBloom()`, `Harbor.invite()` | committed | none needed |
| Care view at `/nurse` | `nurse.html` | committed, plus an in-flight "★ Kind words" row | none needed |
| Finger sleeve: Setup ("Point your sleeve finger at the ceiling", "Now point at the little star"), Sight dwell (1.3 s) and finger tap, Roots steering | `game.html` `Setup`, `input.onImu()`; `sight.js` dwell block | committed | Touch or mouse plays every activity |
| **Kind words** (Harbor → "🌟 Kind words"): the lantern says an affirmation, the patient says it back, a star appears; the game sends `expect_response` while listening so speaking isn't counted as stress | `game.html` `Kind`, `KIND_BUILTIN`, `ear`, `speech` | **in flight** | Bubble text plus the browser's own voice, with "I said it" tap mode. If it isn't stable, cut S4.6 and keep the VO line about the lantern talking |
| Lantern's spoken voice = **Cartesia** TTS; patient's affirmation heard by **Cartesia** STT | server `/api/voice/*`, `game.html` `speech` / `ear` | **in flight** (code is mid-migration) | Browser speech voice and the tap mode above |
| Enclosure Concept B "Rest & Trace" | `enclosure/ENCLOSURE.md`, `enclosure/img/*.png` | designed, **not printed** (`ENCLOSURE.md:22`) | renders only, captioned "not yet printed" |

**Code freeze:** decide the evening before which in-flight features are in. Film what is merged and tested,
nothing else.

---

## 1. Story arc (4:58)

| # | Beat | Time | Job |
|---|---|---|---|
| S1 | Cold open | 0:00–0:20 | Hook: a real breath, and a few seconds later the lantern feels it |
| S2 | Problem | 0:20–0:50 | Pre-surgery waiting and anxiety. Who it helps: the patient in the bed and the nurse who can't be at every bedside |
| S3 | Insight | 0:50–1:15 | Skin conductance shows sympathetic arousal live, 1–3 s after it happens. It measures arousal, not "stress" itself |
| S4 | Solution | 1:15–1:57 | Lantern: two hands (one rests on the sensor, one points), three activities, kind words in the lantern's voice, no numbers for the patient |
| S5 | How it works: pipeline | 1:57–2:13 | Sensor → XIAO → engine (SCRs, personal baseline, index) → WebSocket → game and care view |
| S6 | How it works: **live, uncut** | 2:13–3:21 | One continuous take: an unprompted response gets counted and a firefly comes; then Glow ignores a normal breath, re-prompts, and lights on a real big breath |
| S7 | How it works: helping hand | 3:21–3:43 | Arousal stays up during a round, so the game gets easier instead of harder |
| S8 | How it works: finger sleeve | 3:43–4:02 | The XIAO's IMU becomes a laser pointer; aim and hold, or tap |
| S9 | How it works: care view | 4:02–4:24 | The nurse sees the arc, every adaptation, and what calms this patient |
| S10 | Impact | 4:24–4:40 | What this makes possible today, with one honest number from the shoot |
| S11 | What's next | 4:40–4:50 | Print the wearable, go wireless, run a supervised pilot |
| S12 | Close | 4:50–4:58 | Dawn over the sea. "Lantern. A small light for the wait." |

How it works takes 2:11 of the 4:58, which is where the extra time went.

---

## 2. Shot list

Legend. **Type**: `CAM-A` = camera on face/bed (wide or medium), `CAM-B` = camera on hands (macro or over the
shoulder), `SCREEN` = OBS window capture of the browser, `COMP` = live split-screen composite (§4), `GFX` = motion
graphic or stills.
**Source**: the URL tag (below), then the scene the game must be in, then any key to press.

| Tag | URL | Use |
|---|---|---|
| `G` | `http://localhost:8765/game?pace=4` | patient view, clean. `pace=4` only multiplies XP so level-ups show up on camera (`game.html` `CFG.pace`) |
| `G+dev` | the same page with **D** pressed (or launched as `/game?dev=1&pace=4`) | dev overlay on. **D** toggles it without a reload; **A** forces the helping hand, only while the overlay is on and a round is running (`game.html` keydown handler, `assist.force()`) |
| `DASH` | `http://localhost:8765/` | dashboard: EDA chart, "Personalize: stress test" (90 s mental arithmetic), "Recalibrate" |
| `CARE` | `http://localhost:8765/nurse` | care view |
| `DAWN` | `http://localhost:8765/game?pace=25` in a **separate** browser profile | B-roll of voyages and dawn only (§10, step 13) |

Server for the whole shoot: `.\.venv\Scripts\python.exe -m stresskit serve` (real sensor). It records
`data/session-*.csv` with every game marker, which we need for the honest numbers in S10. **Never restart the
server and never reload the game page during the hero session**, because both reset what the care view shows
(the care view starts its window at the latest "lantern session start" marker, which every reload sends).

### S1 · Cold open · 0:00–0:20

**1.1 · 0:00–0:05 · CAM-A wide**
- Picture: dim, warm room dressed as a pre-op bay: a bed or recliner, blanket, curtain, blank wristband. The patient lies still; a laptop on an overbed table lights their face blue.
- VO: "Waiting for surgery is mostly waiting."
- Caption: none.
- Sound/B-roll: the game's ocean bed, plus a distant monitor beep (library SFX, ambience only).

**1.2 · 0:05–0:09 · CAM-B macro**
- Picture: the resting hand on the blanket, two velcro finger straps on the middle segments of two fingers, the thin lead running off frame.
- VO: "Your mind runs ahead, and your body quietly reacts."

**1.3 · 0:09–0:17 · SCREEN (`G`, Welcome "breath" step) with a CAM-A circle inset**
- Picture: "Now one big, quick breath in / …then let it all out slowly. Watch the lantern." The patient breathes in audibly (inset). A few seconds later the lantern flares and the prompt becomes **"It felt that!"**
- VO: "Watch. One big breath in…" [pause; let the breath and the flare play] "…and a few seconds later, the lantern feels it."
- Caption (small, bottom right): "Real sensor · real time".
- Note: this step only runs if the sensor is already `ready` when the lantern finishes lighting (`Welcome.done()` calls `breath()` only when `sensorReady()`). Wait until `DASH` shows the resting level is learned, *then* open the game (§10). The game allows 13 s for the response.

**1.4 · 0:17–0:20 · SCREEN (`G`, Welcome intro)**
- Picture: the game's own title card: "Lantern / A small light is about to cross the night sea." (re-use the frame from 4.1).
- Caption: "a calming game for the wait before surgery".

### S2 · Problem · 0:20–0:50

**2.1 · 0:20–0:30 · CAM-A medium**
- Picture: the patient picks at the blanket and glances at the wall clock; hands tighten.
- VO: "Before an operation, patients wait in a pre-op bay, in a gown, with nothing to do but think."

**2.2 · 0:30–0:38 · GFX stat card over the night sea**
- Picture: "About half of surgical patients report pre-operative anxiety." Below it, in small type: "Linked with more pain after surgery." Each carries its citation in small type.
- VO: "Studies put pre-operative anxiety at around half of surgical patients, and it has been linked with more pain afterwards."
- **Verify before use:** the "around half" figure is commonly cited from Abate et al., *International Journal of Surgery Open*, 2020 (global pooled prevalence of about 48 %). Confirm it, and find a source for the pain link. If either can't be verified in time, drop the number and say "Many patients feel real anxiety before surgery."

**2.3 · 0:38–0:46 · CAM-A wide**
- Picture: the "nurse" pulls the curtain, asks something, the patient nods "I'm fine", the nurse moves on. Natural sound low under the VO.
- VO: "Nurses know this. But they can't sit at every bedside, and a patient who says 'I'm fine' isn't always fine."

**2.4 · 0:46–0:50 · CAM-B**
- Picture: the patient picks up the laptop/tablet; the screen glow comes up on their face.
- VO: "We wanted to give that wait something kind to do."

### S3 · Insight · 0:50–1:15

**3.1 · 0:50–1:00 · GFX**
- Picture: a simple fingertip cross-section: a sweat gland and its nerve labelled "sympathetic (fight-or-flight)". The gland fills slightly, and a conductance meter ticks up a beat later.
- VO: "Here's the insight. The sweat glands in your fingertips are driven by your sympathetic nervous system, the fight-or-flight side."
- Caption: "Electrodermal activity (EDA) = skin conductance".

**3.2 · 1:00–1:09 · SCREEN (`DASH`, during the 90 s "Personalize: stress test")**
- Picture: the dashboard's "Skin conductance (µS)" chart climbing, with skin-response markers, recorded during the real stress test (§10 step 4).
- VO: "When arousal jumps, your skin conducts a little better, one to three seconds later. That's a skin conductance response, and a cheap sensor can see it live."
- Caption: "Real recording · 90 s mental-arithmetic task".

**3.3 · 1:09–1:15 · CAM-B macro on the straps, with a caption card**
- VO: "It isn't a mind reader. It measures arousal, compared with your own resting level."
- Caption (stays 4 s): "Arousal, not stress itself: excitement, startle, talking, heat and movement raise it too." (`README.md:94-97`)

### S4 · Solution · 1:15–1:57

**4.1 · 1:15–1:21 · SCREEN (`G`, Welcome intro)**
- Picture: "Choose its flame" (amber, sea-glass, rose), a tap, "Light the lantern", and the lantern starts to glow.
- VO: "So we built Lantern, a calming game for the wait. A small lantern has to cross a night sea."

**4.2 · 1:21–1:29 · CAM-B top-down**
- Picture: both hands on the blanket: left in the finger straps, still; right with the XIAO on the index finger, cable between them.
- VO: "One hand rests in two soft finger straps: that's the skin sensor. The other wears a finger sleeve that turns pointing into a cursor."
- Captions (call-outs): "skin sensor · Grove GSR" on the left hand; "finger sleeve · XIAO nRF52840 Sense" on the right.

**4.3 · 1:29–1:34 · SCREEN (`G`, Roots)**
- Picture: the seed running along the glowing vine through the moonlit meadow into the mushroom grove, flowers blooming behind it.
- VO: "Roots: steer a glowing seed along a vine."
- Caption: "Roots · trace".

**4.4 · 1:34–1:40 · SCREEN (`G`, Sight, harbour scene)**
- Picture: "Five fireflies" in the voice bubble; found fireflies flying into the jar.
- VO: "Sight: five-four-three-two-one grounding, finding what's hidden."
- Caption: "Sight · 5-4-3-2-1 grounding".

**4.5 · 1:40–1:45 · SCREEN (`G`, Glow)**
- Picture: the lighthouse beam sweeping; the whale surfacing.
- VO: "Glow: one big breath lights a lighthouse."
- Caption: "Glow · one big breath".

**4.6 · 1:45–1:53 · SCREEN (`G`, Kind) with a CAM-A inset** *(in flight; see §0)*
- Picture: "Say it with me", the affirmation in quotes (e.g. "I am safe right now."), "Listening… say it out loud". The patient says it and the heard text appears. The lantern's **Cartesia** voice replies, and a new star appears in the sky.
- VO, *before* the lantern speaks: "The lantern talks, and asks for a few kind words back." Then let the lantern's voice and the patient's line play clean, with no VO over them.
- Caption: "Voice: Cartesia text-to-speech · speech-to-text".

**4.7 · 1:53–1:57 · SCREEN (`G`, Harbor)**
- Picture: the boat with its little garden on deck, the lantern bobbing, the aurora out because the patient is calm.
- VO: "And the patient never sees a number."

### S5 · How it works: the pipeline · 1:57–2:13

**5.1 · 1:57–2:13 · GFX** (an animated block diagram drawn over a dimmed Harbor frame; intercut 1 s of the XIAO macro, H1)
- Picture: `Grove GSR v1.2` → `XIAO nRF52840 Sense` (A5, 500 Hz averaged to 10 Hz, cancels 50/60 Hz hum) → `USB serial` → `stresskit engine`: µS conversion · artifact gating · skin-response detector · personal baseline · index = 65 % phasic + 35 % tonic · hysteresis → `WebSocket` → `Lantern game` and `Care view`. A second, thinner arrow: `IMU 104 Hz` → `pointer`. (Numbers from `README.md:46-48` and `README.md:61-87`.)
- VO: "Under the hood, a Seeed XIAO reads the Grove skin sensor ten times a second. Our engine picks out each skin response, learns your resting baseline, and streams a live arousal index to the game and to the care team."

### S6 · How it works: live, uncut · 2:13–3:21 (one continuous take; full run-of-show in §3)

**6.1 · 2:13–2:24 · COMP (`G+dev`, Harbor)**
- Picture: the §4 split layout. Burned-in running timecode; bug top left: "ONE TAKE · REAL SENSOR · NO EDITS".
- VO: "This next part is one take, no cuts. On the left, [name] is wearing the sensor. On the right is the game, with our developer readout open. The blue line is skin conductance."
- Captions: a tiny legend under the EDA strip: blue = skin conductance, pink = counted response, yellow = expected (cued breath), grey = sleeve hand moving (colours from `dev.chart()` in `game.html`).

**6.2 · 2:24–2:38 · COMP (`G+dev`, Harbor)**
- Picture: quiet Harbor. At ~2:26 an off-camera clipboard or metal tray hits the floor. The patient's face reacts. **Hold.** 2–5 s later the blue line rises and a **pink** line drops through the EDA strip; the readout lists "+0.0xx µS rise x.x s COUNTED". Within 2 s, three fireflies fade in and drift to the lantern. In post, push in slowly on the strip, then on the lantern so the fireflies read.
- VO (after the pink line, not before): "That pink mark is a skin response nobody asked for. The game counts it, and sends a firefly to keep the lantern company."
- Branch, grey instead of pink: "Grey means the hand moved, so it doesn't count. We'd rather miss one than invent one."

**6.3 · 2:38–2:48 · COMP (`G+dev`, Harbor → Glow intro)**
- Picture: the patient taps the Glow card. "Light the lighthouse" appears, then "Get ready… Breath 1 of 6."
- VO: "Now Glow. Before it asks for a breath, the game tells the engine to expect one, so it won't count as stress."

**6.4 · 2:48–3:06 · COMP (`G+dev`, Glow: breath 1, ordinary)**
- Picture: "Breathe in, big and quick!" The patient deliberately takes an *ordinary* breath. "…and let it all out, slowly." Then "The lighthouse is listening for your breath…" and nothing on the trace. Then "Let's try that once more", with the lantern speaking its line.
- VO: "First, an ordinary breath." … "No response, so the lighthouse waits, and gently asks again. Now a big one."
- Fallback (re-prompt not merged): the committed Glow says "The lighthouse felt that" and gives a partial charge. VO: "No response, so it only half-lights. Now a big one."

**6.5 · 3:06–3:21 · COMP (`G+dev`, Glow: the big breath → reveal)**
- Picture: "Big breath in!" An audible, deep, quick inhale. 2–6 s later a **yellow** line appears ("cued" in the readout) and the lighthouse flares. At the end of the exhale: **"The lighthouse heard you"**, the beam sweeps out, and "A whale is surfacing to say hello."
- VO (only after the heading appears): "Yellow means expected. The lighthouse heard it."

### S7 · How it works: the helping hand · 3:21–3:43

**7.1 · 3:21–3:27 · CAM-A medium**
- Picture: the patient plays Sight by touch (or mouse) with the free hand. **The sleeve is off and lying still on the table** (§5, the motion rule). Off camera, a teammate fires mental arithmetic: "1000 minus 13… again… faster."
- VO: "When arousal stays up during a round, the game doesn't push harder. It helps."

**7.2 · 3:27–3:39 · SCREEN (`G+dev`, Sight) with a CAM-A inset**
- Picture: the gold stress line in the dev strip climbs past the dashed lines. Then the gold **"✨ Your lantern is helping"** badge (bottom left), the bubble "A little firefly will show you the way.", a sparkle, a guide firefly circling the next target, and the decoys fading.
- VO: "Here [name] plays Sight while a friend fires mental math at them. Once the index holds above forty-five for four seconds, a guide firefly appears, decoys fade, and mistakes stop counting."
- Caption: "Helping hand: on at ≥ 45 for 4 s · off at ≤ 32 for 10 s".
- If forced with **A** (§10 step 9), add a caption: "Triggered by hand for this shot (A key). In a session it switches on by itself." Also switch to the alt VO in §8.

**7.3 · 3:39–3:43 · SCREEN (`G`, Roots, helping hand on)**
- Picture: the vine widens and turns gold, and the bubble says "Your lantern is helping: the vine grows wider and it guards your leaves." A real trigger is best; if this clip was forced with A, keep the same caption.
- VO: "When things settle, it eases back."

### S8 · How it works: the finger sleeve · 3:43–4:02

**8.1 · 3:43–3:49 · CAM-B macro → SCREEN (`G`, Setup)**
- Picture: "Point your sleeve finger at the ceiling" while the finger points up, OK; then "Now point at the little star" while the finger aims at the screen, OK; the toast "All set. Your finger guides the light now."
- VO: "The sleeve is the XIAO's own motion sensor."

**8.2 · 3:49–3:58 · CAM-B over the shoulder (finger and screen in one frame)**
- Picture: Sight with the sleeve. The cursor follows the finger; the gold ring fills while the finger holds on a target (1.3 s dwell) and it's found; then a small finger tap selects the next one. **The mouse is visibly parked away from the hands** and the OS cursor is hidden (§7).
- VO: "We fuse its gyro and accelerometer into a pointing direction, like a laser pointer, because tracking position would drift within seconds. Aim and hold to pick, or give a small tap."

**8.3 · 3:58–4:02 · CAM-B + SCREEN split (50/50)**
- Picture: Roots steered by tilting the finger up and down.
- VO: "It all works from bed."

### S9 · How it works: the care view · 4:02–4:24

**9.1 · 4:02–4:08 · SCREEN (`CARE`, light theme)**
- Picture: slow push-in on "Lantern · Care view" and the tiles: "Stress now", "First 5 min of play", "Last 5 min", "Calms them most".
- VO: "Meanwhile, the care team sees the other side."

**9.2 · 4:08–4:15 · SCREEN (`CARE`)**
- Picture: "Stress index over the session" with shaded round bands and dashed "help on" / "help off" lines. The cursor hovers one point to show the tooltip.
- VO: "The care view charts the session, shades each round, and marks every moment the game stepped in."
- Caption: "Index = arousal relative to this patient's resting level".

**9.3 · 4:15–4:21 · SCREEN (`CARE`)**
- Picture: "What helps" (change from before each round to the quiet scene after it), then "How the game adapted", with rows like "▲ … during Sight: helping hand on (guide firefly, bigger targets, no decoys)" and "★ Kind words: said aloud …".
- VO: "It also learns what helps this patient. Here, the index fell most after [activity],"

**9.4 · 4:21–4:24 · SCREEN (`G`, Harbor)**
- Picture: the "In bloom" badge on that activity's card, bouncing if the invite fired.
- VO: "…so the lantern gently invites them back to it."
- Fill in [activity] from what the care view actually shows that day. Don't script it in advance.

### S10 · Impact · 4:24–4:40

**10.1 · 4:24–4:32 · SCREEN (`G`, Glow Results)**
- Picture: the Glow results card, "[N] of [M] breaths seen · [K] rescued" (`glow.js`, the `breaths seen` summary).
- VO: "Lantern runs in any browser, on two small boards. In today's session, the sensor confirmed [N] of [M] cued breaths."
- Caption: "One wearer, one session. Not a study."

**10.2 · 4:32–4:40 · CAM-A wide**
- Picture: the patient relaxed, playing; the nurse at a "station" glancing at the care view on a second screen.
- VO: "For a patient, that's something calm to do. For a nurse, it's a quiet hint about who might need a visit."

### S11 · What's next · 4:40–4:50

**11.1 · 4:40–4:45 · GFX (stills with a slow push)**
- Picture: `enclosure/img/all_parts.png`, then `ring_assembled.png` and `pod_assembled.png`.
- Caption: "Concept B 'Rest & Trace' · designed in Fusion · not yet printed".

**11.2 · 4:45–4:50 · GFX list**
- Picture: "Print and fit the wearable · Bluetooth, no cable · labelled validation sessions · supervised pilot with a pre-op team".
- VO across both: "Next: printing the two-hand wearable we've designed, going wireless, and a supervised pilot with a pre-op team, to learn whether it truly helps."

### S12 · Close · 4:50–4:58

**12.1 · SCREEN (`DAWN`, Voyage to Dawn Island)**
- Picture: the sun rising over the sea; the game's own line: "Dawn. You made it across. Whenever you wake up, your lantern will be right here."
- VO (after the line has been on screen 2 s): "Lantern. A small light for the wait."
- End card overlay: Lantern · team names · Cal Hacks · repo URL. Fade to black at 4:58.

---

## 3. The live uncut segment: run of show

**Goal:** show that the game reacts to *the body*, in real time, without editing. Ninety seconds of real footage
beats any amount of narration.

**Before rolling:**
- Patient settled for at least 3 minutes since the last stimulus.
- Dev readout says `skin ready · ok · contact`, and `stress` is a number, not "–".
- The `sleeve` line reads `still` or `steady`, not `MOVING`.
- Both hands rest on a pillow, palm down, and the electrode lead is taped down.
- Game is in Harbor and OBS is on the LIVE SPLIT scene.
- The stimulus operator stands out of frame with the tray, and nobody speaks.

| Real time | What happens | Who does it | What appears |
|---|---|---|---|
| 0:00 | Roll. Hold 10 s on the calm Harbor | — | flat blue line |
| ~0:12 | Tray or clipboard dropped, unannounced (the patient knows "something will happen", not when) | stimulus op | face reacts |
| 0:13–0:18 | **Nobody moves.** Skin-response onset 1–3 s, rise 1–3 s, then the detector confirms the peak | — | blue line rises; **pink** line and "COUNTED"; fireflies fade in over ~2 s |
| ~0:28 | Patient taps the Glow card with the sleeve hand. That hand is "moving" for ~1.5 s, which is fine because the breath cue comes ≥ 9 s later | patient | "Light the lighthouse", 6 s intro, "Get ready…", 3 s |
| ~0:37 | "Breathe in, big and quick!" → patient takes an **ordinary** breath | patient | nothing on the trace |
| ~0:48 | (re-prompt build) "The lighthouse is listening…", then at ~11.5 s after the cue, "Let's try that once more" | — | the lantern speaks the retry line |
| ~0:55 | "Big breath in!" → patient takes a **big, quick** inhale through the nose, then a slow exhale | patient | 2–6 s later: **yellow** line ("cued") and the lighthouse flares |
| ~1:04 | End of the exhale | — | "The lighthouse heard you", then the whale |
| ~1:08 | Hold 3 s, then cut | — | — |

**Branches (keep rolling in every case; the whole point is that it's live):**
- **Grey instead of pink.** The hand flinched. Keep it and use the grey VO line in 6.2. That is honest and still a good demo of the motion rule.
- **No response to the tray.** Wait 40 s, then the stimulus operator touches an ice cube to the back of the patient's neck (warn the patient beforehand that a cold touch may come). If there's still nothing, stop and retake later. Never fake it.
- **The big breath isn't seen.** In-flight Glow re-prompts again ("Take your time"), and the second try is usually stronger. If the take runs long, trim it in the *edit plan* by starting the take later, never by cutting inside it.
- Max **3 takes**, each ≥ 5 minutes apart, each with a *different* surprise (tray, phone alarm at full volume, ice cube). The same surprise twice gives a smaller response each time (habituation).

The take runs about 65–75 s. If the best take runs long, shorten S4 by up to 6 s (drop 4.7) and S2 by up to 4 s,
and keep the take whole.

---

## 4. The split-screen

Layout for the LIVE SPLIT composite at 1920×1080:

```
┌─────────────────┬──────────────────────────────────────────────┐
│  CAM-A  640×540 │                                              │
│  face, chest    │   GAME window capture, scaled to 1280×720     │
│  (see the       │   (G+dev: the readout sits top right)        │
│   breath)       │                                              │
├─────────────────┤                                              │
│  CAM-B  640×540 ├──────────────────────────────────────────────┤
│  both hands on  │  EDA STRIP 1280×360: the SAME window capture, │
│  the pillow:    │  cropped to the dev panel's chart + top rows, │
│  straps + sleeve│  scaled ~2× (blue trace, coloured SCR lines)  │
└─────────────────┴──────────────────────────────────────────────┘
  bug top-left: ONE TAKE · REAL SENSOR · NO EDITS     timecode bottom-right (added in post)
```

Why the strip: the dev panel is 420 CSS px wide with 11 px text (`#devpanel` in `game.html`). Scaled into a
1280-wide box, the text becomes unreadable. Cropping the panel's chart and its first readout lines and scaling
them up makes the trace the hero of the frame. The overlay's chart shows only the **last 60 s** (`dev.WINDOW`)
and auto-scales, so a big response flattens smaller ones in the same minute; that's another reason to space
stimuli ≥ 30–60 s apart.

**Build it in OBS** (one scene, five sources):
1. `CAM-A`: Video Capture Device (USB webcam, or the laptop webcam if it frames the face well).
2. `CAM-B`: Video Capture Device, a phone used as a webcam (Windows Phone Link "connected camera", Camo or DroidCam).
3. `GAME`: Window Capture of the Chrome app window, method "Windows 10 (1903 and up)", **Capture Cursor off**. Transform: fit to 1280×720 at x=640, y=0.
4. `GAME (strip)`: Add **Existing** source → `GAME`, then Edit Transform → Crop to the dev panel's chart and top readout lines; place it at x=640, y=720, 1280×360. Crop is per scene item, so this doesn't affect source 3.
5. `BUG`: Text (GDI+) "ONE TAKE · REAL SENSOR · NO EDITS", 22 px, `#ffd27a` on 60 % navy.

Also use the split for 1.3 (circle inset only), 4.6 and 7.2 (CAM-A inset). Phone-as-webcam lag is 100–300 ms,
which is negligible next to the 2–6 s physiology. If a camera can't go into OBS, record it on the device and sync
in post on the game's chimes, which both mics hear (Resolve: *Auto Sync Audio → Based on Waveform*). **Don't clap
to sync:** a clap is a startle, and it will put a skin response on the trace.

---

## 5. Capturing a genuine skin response on camera

**Timing to design around:**

| Step | Typical delay | Source |
|---|---|---|
| Stimulus → skin-response onset | 1–3 s | `README.md:73`, `README.md:201` |
| Onset → peak (rise) | 1–3 s; step-shaped faster rises are rejected as electrode artifacts | `README.md:70-73` |
| Peak → `scr` event, so the line and the game's reaction appear | shortly after the peak, once the detector confirms it | `dsp.py` (online trough-to-peak) |
| **Stimulus → visible reaction** | **about 3–8 s.** Glow waits up to 11 s (`GLOW_CUE_S`), Welcome 13 s | `glow.js`, `game.html` `Welcome.breath()` |
| Stress *index* (level, helping hand) | 10–60 s | `README.md:201-202` |
| Cue window for a cued breath | its peak must land 2–11 s after the cue, and its onset can't start more than 1.5 s before it | `engine.py:97-104`, `engine.py:505-510` |

**Shot rule:** never cut within 10 s after a stimulus. Hold on the face *and* the trace. Never speed-ramp.

**Preconditions (do all of them):**
- Warm room (22–24 °C) and warm hands. Cold hands give low, sluggish responses. No cold-water hand washing in the last 10 minutes.
- Electrodes on the middle segments of two fingers, contacts palm side, on the **resting** hand (`README.md:36-39`, `ENCLOSURE.md:3-9`). Snug, but not tight.
- **Wet-in for 5–10 minutes.** Dry nickel electrodes can double in conductance in the first minutes (`README.md:41-42`).
- Then **Recalibrate** on `DASH`: sit still for about 60 s; it can extend to 120 s while the electrodes settle.
- Run **Personalize: stress test** once with this wearer (HANDOFF lists it as not yet done: `HANDOFF.md:28`). If it reports a weak responder (10–20 % of people, `README.md:96-97`), **change the patient** to someone else.
- Pick the patient by test: each teammate wears the straps for a few minutes and takes three big breaths while watching `DASH`. Cast the one with the clearest bumps.

**The motion rule (important):** with the real sensor, the server marks every skin response that starts while
the **sleeve's IMU** is moving (or within 1 s of it) as `motion` (grey) and does not count it (`server.py`
`_moving()` / `engine.note_motion()`, active only for the serial source; `engine.py:507`). The sleeve is on the
*pointing* hand, so:
- During startle and breath moments, the sleeve hand must rest too.
- For the helping-hand shot (S7), **take the sleeve off and lay it still on the table**, and play Sight by touch or mouse. Otherwise most of the responses raised by the mental math are greyed out and the index never reaches 45.
- `serve --sim` doesn't gate motion, so nothing about this shows up in rehearsals with the simulator.

**Stimuli, best first:**
1. **Cued big breath**: a quick, deep inhale through the nose, then a slow exhale. Very reliable. Tagged **yellow** (expected, not counted). It's the hero of Glow and of the cold open.
2. **Unannounced sound**: a tray or clipboard dropped, a phone alarm. Reliable the first time, weaker on repeats. Should come out **pink** (counted) if the hands stay still.
3. **Cold touch**: an ice cube on the back of the neck, from the stimulus operator. Strong, but it can make the patient flinch. Only use it as the backup in S6.
4. **Mental arithmetic under time pressure**: count down from 1000 by 13, out loud, with a buzzer for mistakes. That's the dashboard's own stressor, and the one that raises the *index* over tens of seconds. Use it for S7.

**Recovery and habituation:** wait at least 30–60 s between stimuli (a response takes several seconds to decay,
and the overlay window is 60 s). Wait at least 5 minutes, and change the surprise, between retakes of the uncut
segment. Do the cold open and the live take **before** the mental math. Arousal stays up for minutes after a
stressor.

**Don't:** let the patient act a reaction; press on the electrodes; move the strapped hand; talk during the take
(talking raises skin conductance too); or let a teammate laugh off camera.

---

## 6. Hardware close-ups

All `CAM-B`, phone at 4K30 or 1080p60, with focus and exposure locked and a small LED panel at 45°.

| ID | Shot | Used in | Notes |
|---|---|---|---|
| H1 | The XIAO nRF52840 Sense on the index finger (current sleeve), slow 90° orbit, USB-C lead visible | 4.2, 5.1, 8.1 | Wipe the board; it's tiny (21 × 17.8 mm), so get close |
| H2 | Strapping the electrodes on: velcro rip, the two straps on the resting hand's middle segments, contacts palm side | 1.2, 3.3, 4.2 | The velcro sound is good B-roll audio |
| H3 | Wiring macro: yellow → A5, red → **3V3**, black → GND; the white wire unconnected | 5.1 | Matches `README.md:29-34`. Don't show it on 5 V |
| H4 | Pointing at the ceiling (Setup), then at the screen star | 8.1 | Shoot from the side, with the ceiling light flared |
| H5 | Over the shoulder: the finger aims, the cursor follows, the dwell ring fills; then a small tap | 8.2 | Finger and screen in one frame; mouse visibly away |
| H6 | "One hand rests, one hand plays": top-down of both hands on a pillow, thin cable between | 4.2, 6.x | The two-hand story is from `ENCLOSURE.md:51` |
| H7 | Grove GSR board alone on the table, with the trim pot visible | 5.1 | Product shot |
| H8 | Enclosure renders (`enclosure/img/*.png`) | 11.1 | Stills only; never imply they're printed |

---

## 7. Recording setup (Windows)

**Display and browser**
- Display 1920×1080 at **150 % scaling**, giving the page a 1280×720 CSS viewport. The game's UI and the dev readout (11 CSS px → 16.5 px on video) stay legible at 1080p, and every take has the same layout. On a 2560×1440 monitor use 200 % scaling (same CSS viewport) and record at 1440p for clean punch-ins.
- Launch a dedicated Chrome profile as an app window in fullscreen. This gives a fresh save with no extensions, bookmarks or tab bar:
  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\lantern-film" --app="http://localhost:8765/game?pace=4" --start-fullscreen
  ```
  Press **D** to bring up the dev readout when needed.
- Use a **second** profile for the dawn B-roll (`--user-data-dir="$env:TEMP\lantern-dawn"`, `?pace=25`). Game progress is stored per browser profile, so the hero session's save stays intact. Don't use Settings → New patient mid-shoot: it also re-baselines the sensor (it sends `calibrate`).
- Put `DASH` and `CARE` in their own windows on a second monitor, or capture them when they're in front. Chrome stops painting fully hidden windows, so a window hidden behind the game records frozen.
- Settings → Controls → "Finger sleeve only" for the sleeve shots, so a stray mouse can't steal the cursor. Switch back to "Sleeve, or touch" for the touch shots.
- Hide the OS cursor: Capture Cursor off in OBS, and park the mouse in a corner.
- Sound: the game's audio starts on the first tap (browser autoplay rules). Tap once before rolling. Keep Settings → Sound on.

**OBS Studio (30.x)**
- Video: base and output 1920×1080, **60 fps**.
- Output (Advanced → Recording): **Hybrid MP4** (crash-safe; or MKV, then remux), NVENC H.264 at CQP 18 (or x264 at CRF 18, preset veryfast), keyframes every 2 s.
- Audio: 48 kHz. Track 1 = mic (lav on the patient: catches the breath), Track 2 = desktop audio (game, Cartesia voice), Track 3 = mix. Enable tracks 1–3 on the recording.
- Scenes: `GAME clean` (window capture only) · `LIVE SPLIT` (§4) · `GAME + CAM inset` · `DASH` · `CARE`.
- Set start/stop recording hotkeys (e.g. Ctrl+Shift+F9) so OBS never appears on screen. Keep the Stats dock open and check for **0 skipped and 0 lagged frames** after the test recording.
- Hygiene: Windows Do Not Disturb on, Discord/Teams/Slack closed, laptop on mains power, best-performance power mode, no terminals with API keys on screen. The Cartesia key stays on the server; never show `.env` or `data/`.

**Cameras and light**
- CAM-A: 1080p60 (or 4K30, downscaled), shutter 1/120 under 60 Hz US mains so the screen and LED lights don't flicker. Lock white balance (~3200 K) for a warm room.
- CAM-B: phone on a gooseneck or overhead arm, macro lens if you have one.
- Light: one soft warm key at 45°, a practical lamp in the background, and the screen as the fill on the face. Keep the scene dark so the game glows.

**Mic**
- Live and acting shots: a lav on the patient, recorded into OBS Track 1 or a phone voice memo as backup.
- VO: record separately in a quiet, soft room (a closet full of clothes works), 6–8 inches from a cardioid USB mic, 48 kHz / 24-bit, peaks around −12 dBFS. Read slowly. Record two clean takes of every paragraph.

---

## 8. VO script

**Budget.** 4:58 of picture minus about 40 s of deliberate non-VO time (the live take's silences ~26 s, the
lantern's voice and the patient's line in 4.6 ~6 s, title and dawn holds ~8 s) leaves ~258 s of speech. At a
calm 140–145 wpm that is 600–625 words.
- **Core script: 606 words.** That's below the 650–750 brief on purpose: the live take's silences are the proof, and a longer script would have to talk over them or rush.
- **Core + optional lines: 680 words**, inside the brief. Use the optional lines only if the live take comes in under 65 s, or if the reader is naturally a little brisker (~150 wpm).

Counts split hyphenated words, the way they're spoken.

| Beat | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Words | 29 | 69 | 62 | 86 | 40 | 103 | 52 | 44 | 48 | 41 | 25 | 7 |
| Seconds of speech available | 13 | 30 | 25 | 36 | 16 | ~42 | 22 | 19 | 22 | 16 | 10 | 4 |
| wpm | 134 | 138 | 149 | 143 | 150 | 147 | 142 | 139 | 131 | 154 | 150 | 105 |

S10 is the fastest beat; if it feels rushed, drop "on two small boards".

**S1 · 0:00–0:20**
> Waiting for surgery is mostly waiting. Your mind runs ahead, and your body quietly reacts. Watch. One big breath in… and a few seconds later, the lantern feels it.

**S2 · 0:20–0:50**
> Before an operation, patients wait in a pre-op bay, in a gown, with nothing to do but think. Studies put pre-operative anxiety at around half of surgical patients, and it has been linked with more pain afterwards. Nurses know this. But they can't sit at every bedside, and a patient who says "I'm fine" isn't always fine. We wanted to give that wait something kind to do.

**S3 · 0:50–1:15**
> Here's the insight. The sweat glands in your fingertips are driven by your sympathetic nervous system, the fight-or-flight side. When arousal jumps, your skin conducts a little better, one to three seconds later. That's a skin conductance response, and a cheap sensor can see it live. It isn't a mind reader. It measures arousal, compared with your own resting level.

**S4 · 1:15–1:57**
> So we built Lantern, a calming game for the wait. A small lantern has to cross a night sea. One hand rests in two soft finger straps: that's the skin sensor. The other wears a finger sleeve that turns pointing into a cursor. Roots: steer a glowing seed along a vine. Sight: five-four-three-two-one grounding, finding what's hidden. Glow: one big breath lights a lighthouse. The lantern talks, and asks for a few kind words back. And the patient never sees a number.

**S5 · 1:57–2:13**
> Under the hood, a Seeed XIAO reads the Grove skin sensor ten times a second. Our engine picks out each skin response, learns your resting baseline, and streams a live arousal index to the game and to the care team.

**S6 · 2:13–3:21** (sparse; each line goes *after* the event it describes)
> This next part is one take, no cuts. On the left, [name] is wearing the sensor. On the right is the game, with our developer readout open. The blue line is skin conductance.
> That pink mark is a skin response nobody asked for. The game counts it, and sends a firefly to keep the lantern company.
> Now Glow. Before it asks for a breath, the game tells the engine to expect one, so it won't count as stress.
> First, an ordinary breath.
> No response, so the lighthouse waits, and gently asks again. Now a big one.
> Yellow means expected. The lighthouse heard it.

**S7 · 3:21–3:43**
> When arousal stays up during a round, the game doesn't push harder. It helps. Here [name] plays Sight while a friend fires mental math at them. Once the index holds above forty-five for four seconds, a guide firefly appears, decoys fade, and mistakes stop counting. When things settle, it eases back.

**S8 · 3:43–4:02**
> The sleeve is the XIAO's own motion sensor. We fuse its gyro and accelerometer into a pointing direction, like a laser pointer, because tracking position would drift within seconds. Aim and hold to pick, or give a small tap. It all works from bed.

**S9 · 4:02–4:24**
> Meanwhile, the care team sees the other side. The care view charts the session, shades each round, and marks every moment the game stepped in. It also learns what helps this patient. Here, the index fell most after [activity], so the lantern gently invites them back to it.

**S10 · 4:24–4:40**
> Lantern runs in any browser, on two small boards. In today's session, the sensor confirmed [N] of [M] cued breaths. For a patient, that's something calm to do. For a nurse, it's a quiet hint about who might need a visit.

**S11 · 4:40–4:50**
> Next: printing the two-hand wearable we've designed, going wireless, and a supervised pilot with a pre-op team, to learn whether it truly helps.

**S12 · 4:50–4:58**
> Lantern. A small light for the wait.

**Alternates (use when the matching thing happens):**
- 6.2 grey instead of pink: "Grey means the hand moved, so it doesn't count. We'd rather miss one than invent one."
- 6.4 without the in-flight re-prompt: "No response, so it only half-lights. Now a big one."
- 7.2 forced with A: "For this shot we switched it on by hand. In a session, it switches on by itself once the index holds above forty-five for four seconds: a guide firefly appears, decoys fade, and mistakes stop counting."

**Optional lines (+~70 words):**
- S2, end: "Lantern is for that wait: for the person in the bed, and for the nurse who can't be everywhere at once."
- S3, after "see it live": "Most of the time, nobody notices it. The sensor does."
- S5, end: "with hysteresis, so the game never flickers between moods. The sensing runs entirely on the laptop."
- S8, after the first sentence: "Pointing at the ceiling once teaches it which way your finger points."
- S9, after "stepped in": "Every round shows the change from just before it to the quiet scene after it."

Pronunciation notes: XIAO = "shao". Seeed = "seed". Cartesia = "car-TEE-zha".

---

## 9. Music and sound

- **The game's own soundscape is the bed.** `sfx` in `game.html` generates it: low-passed noise "ocean" swelling at 0.1 Hz (about 6 breaths a minute, a quiet pacing cue), pentatonic chimes, a sparkle when the helping hand turns on, a swell on each breath cue. Record 3 minutes of clean Harbor ambience (dev off, no taps) as a wild track and lay it under S1–S5 and S9–S12, so the whole film sits on the lantern's sea.
- **One music cue only:** a slow, warm piano or pad, ~60–70 BPM, for S4 (solution) and S12 (dawn). The game's chimes are in C major pentatonic (`sfx.PENTA` starts at C4 = 261.6 Hz), so pick a cue in **C major or A minor** and the chimes won't clash. Use a licence-clear source (YouTube Audio Library, Pixabay Music, or an original) and credit it in the description.
- **The live take (S6) has no music.** Only the game, the room and the patient's breath, so the audience trusts it.
- Never put VO over the lantern's spoken (Cartesia) voice or the patient's affirmation. Leave gaps.
- Mix: VO around −16 LUFS short-term with music ducked 18–20 dB under it; let the "heard you" sparkle and the helping-hand sparkle poke through. Master to −14 LUFS integrated, −1 dBTP.
- Cold-open SFX (distant monitor beep, curtain rail) is ambience. Never sync an SFX to a response on the trace; that would be faking the physiology.

---

## 10. Shooting day: checklist and order

**The night before**
- [ ] Code freeze. Merge or drop each in-flight feature (Glow re-prompt, Kind words, Cartesia voice). Run `python -m pytest -q`. Play a full session once with the real sensor.
- [ ] Cartesia: API key in the server's environment, voice chosen. If the implementation caches lines, pre-render them now so the shoot never waits on the network. Test the fallback with the network off.
- [ ] Verify or cut the S2 statistics.
- [ ] Props: blanket, pillow, blank wristband, curtain or sheet, scrubs for the "nurse", tray or clipboard, ice cubes in a cup, phone alarm.
- [ ] Charge phones and lights; clear phone storage; lock a 4K30 or 1080p60 profile on each camera.
- [ ] Print §3 and the VO script for the stimulus operator and the reader.

**Order on the day** (set up for least re-baselining and least habituation):
1. **Set and tech (no wearer, ~30 min).** Lights, cameras, OBS scenes, a 30 s test recording of every scene; check playback, frame drops, black window capture, and audio on all three tracks.
2. **Hardware macros H1, H3, H7** on the table, before anyone wears anything.
3. **Problem beat (S2) and the wide establishing shots**, no sensor needed.
4. **Sensor on.** Film H2 (strapping on). Start `serve`. Open `DASH`. Wet-in for 5–10 minutes while you film H6 and some calm face B-roll. Then **Recalibrate** (60 s still). Then **Personalize: stress test**, screen-recording `DASH` for **S3.2**. Then **recover for 5 minutes**.
5. **Open the game** in the film profile: Welcome → flame → light → **breath (S1.3 cold open, 4.1)** → Setup (**S8.1**) → Harbor. From here on, never reload the page and never restart the server.
6. **Live uncut take (S6)**, while the patient is calm and the startle response is fresh. Press D, switch OBS to LIVE SPLIT. Up to 3 takes, ≥ 5 minutes apart, with a different surprise each time. Play calm rounds in between: that's footage and care-view data at the same time.
7. **Clean gameplay** with dev off: Roots (4.3), Sight (4.4), Glow (4.5), Rest, Results, Harbor with the aurora (4.7). Then the sleeve shots **H4/H5 → 8.2, 8.3** (Settings → "Finger sleeve only").
8. **Kind words (4.6)**, after a first round, when the Harbor offers it. Talking raises arousal, so do it after the calm shots.
9. **Helping hand (S7):** sleeve off and lying still; Sight by touch; mental-math quiz off camera. Two genuine attempts at most. If it doesn't trigger, press **A** during the round (dev on), capture 7.2/7.3, and use the forced captions and alt VO.
10. **Recovery:** a Glow round and its Rest scene, so the care view shows "help off" and a calming effect.
11. **Care view (S9).** You need ≥ 7 minutes of play since the session start for the "change since the start" note, and ≥ 2 measured rounds of an activity for "Calms them most". Make sure both are met. Force the light theme with DevTools → Rendering → *Emulate CSS prefers-color-scheme: light*. Record a slow scroll, a chart hover, and the adaptation table. Note the [activity] for the S9 VO.
12. **Glow results card (10.1).** Write down [N] of [M]. Also count `cue:breath` marks against cued responses in `python -m stresskit analyze data\session-….csv` afterwards.
13. **Dawn B-roll (S12)** in the `lantern-dawn` profile with `?pace=25`. Do it *after* the care-view capture, because its rounds add markers to the same server.
14. Pickups: the nurse station (10.2), hands, faces.
15. Stop the server. Back up `data/session-*.csv` and all footage to two places.
16. VO: a scratch read to cut against, and the final read after picture lock.

**Before every live or sensor take**
- [ ] Dev readout says `ready · ok · contact`; `sleeve` reads still or steady; `stress` is a number.
- [ ] ≥ 3 minutes since the last stimulus, ≥ 5 minutes since the last retake.
- [ ] Both hands resting, lead taped, nobody talking.
- [ ] OBS on the right scene, recording indicator checked, the game's sound already started by a tap.

---

## 11. Honest-claims guardrails

| Say | Don't say |
|---|---|
| "skin conductance", "electrodermal activity", "arousal" | "detects anxiety", "reads your emotions", "AI knows how you feel" |
| "a stress index relative to *your own* resting level" | "measures stress accurately", or any absolute stress claim |
| "designed to calm", "something calm to do", "we want to learn whether it helps" | "reduces anxiety", "lowers stress by X %", "improves outcomes" |
| "in today's session, one wearer, N of M breaths" | "clinically validated", "proven", "tested with patients", "hospital pilot" (none happened) |
| "the game adapts", "the care team sees…" | "medical device", "diagnoses", "FDA", "HIPAA-compliant" (the voice goes to Cartesia's cloud) |
| "designed, not yet printed" | showing the renders as a finished product |
| "triggered by hand for this shot" whenever the A key was used | presenting a forced helping hand as automatic |

Also:
- **GSR is arousal, not stress specifically** (`README.md:94-97`). Excitement, startle, talking, deep breaths, heat and movement raise it. 10–20 % of people are weak responders. Put the caption in S3.3 on screen, not only in the VO.
- **Validation status, if a judge asks:** the engine is validated against a physiological simulator (`tests/`, 31 tests) and tuned on about 50 minutes of real recordings, with no labelled human validation yet (`HANDOFF.md:26-31`). Absolute µS values are approximate, so don't read numbers off the trace as facts.
- **No simulator footage as real.** `serve --sim` is for rehearsing framing only. If a sim clip ever ends up in the cut, it gets a "simulated sensor" caption.
- **No cuts, speed ramps or reordering inside the live take.** Zooms and pans are fine. The burned-in timecode shows it's continuous.
- **The patient is a teammate**, filmed in a dressed room, not a hospital. No hospital logos, no real patient data, no real names on the wristband. Say "pre-op" as the setting the game is designed for, not where it was filmed.
- **Statistics carry an on-screen citation** or get cut.
- **Kind words:** don't claim affirmations lower arousal. Speaking raises skin conductance, which is why the game sends `expect_response` while it listens (`game.html` `Kind.listen()`).
- **"The patient never sees a number"** is true of the game. The care view does show numbers, and is for staff.

---

## 12. Edit and delivery

- DaVinci Resolve (free), 1080p **60 fps** timeline. Leave screen captures ungraded. Grade the camera footage warm and dark to sit with the game.
- Burn in only the key captions and labels from §2. Add full subtitles as an SRT on YouTube (correct the auto-captions). Many judges watch muted.
- Captions use the game's typeface (Nunito / a rounded sans) and palette; the overlay legend colours match the readout (pink `#ffb0c4`, yellow `#ffd27a`, grey `#7d84b5`, blue `#9cc7ff`).
- Live take: add a timecode burn-in (Workspace → Data Burn-In → source timecode) to that clip only.
- Export: H.264 1080p60, 16–20 Mbps VBR, AAC 320 kbps, −14 LUFS integrated, −1 dBTP. Check the final duration is **≤ 4:58**.
- YouTube: public or unlisted, title "Lantern: a calming game that feels your breath (Cal Hacks)". The description gets music credits, the repo link and a one-line honesty note: "Prototype. Skin conductance measures arousal, not stress; not clinically validated."
- Watch the final once on a phone, muted. Every beat should still make sense from the captions alone.

---

## Appendix A: 2:50 cut (only if the form caps at 3:00)

| Beat | Keep | Length |
|---|---|---|
| S1 | 1.1, 1.3, 1.4 | 0:15 |
| S2 | 2.1, 2.2 | 0:15 |
| S3 | 3.2, 3.3 | 0:15 |
| S4 | 4.2, 4.3–4.5 at 3 s each, 4.7 | 0:25 |
| S6 | live take, starting at 6.3 (breath only; drop the tray and the ordinary breath) | 0:30 |
| S7 | 7.2 | 0:15 |
| S8 | 8.2 | 0:10 |
| S9 | 9.2, 9.3 | 0:15 |
| S10–S12 | 10.1, 11.1, 12.1 | 0:20 |
| | | **2:40–2:50** |

VO: about 350 words. Use the S1, S3, S4, S7 and S12 lines, trimmed.

---

## Appendix B: references

| What | Where |
|---|---|
| Routes `/`, `/game`, `/nurse`, `/ws` | `stresskit/server.py` (`app.router.add_get(...)`) |
| `serve` flags: `--port` (serial) vs `--http-port`, `--sim`, `--no-record`, `--profile` | `stresskit/__main__.py:118-125` |
| Simulator scenario (rest, stressor, recovery…) and its 85 % response to a cued breath | `stresskit/sim.py:40-47`; `server.py` `expect_response` handler |
| Cue window and SCR tagging (`cued` / `motion` / `counted`) | `stresskit/engine.py:97-104`, `324-332`, `505-510` |
| Motion gating (real sensor only) | `server.py` `_moving()`, `Hub.motion_gating` |
| Dev overlay (D), colours, readout, A key | `game.html` `dev` object and keydown handler; `#devpanel` CSS |
| Helping hand thresholds and badge | `game.html` `assist`; `#assist` |
| World calm, aurora, gentle mood, comfort fireflies | `game.html` `updateWorld`, `drawAurora`, `updateMood`, `comfort` |
| Welcome breath ("It felt that!"), Setup texts, Harbor invites, Rest (35 s, measured from 12 s), Voyage dawn line | `game.html` `Welcome`, `Setup`, `INVITES`, `Rest`, `CFG`, `Voyage` |
| Kind words, affirmations, voice and listening | `game.html` `Kind`, `KIND_BUILTIN`, `speech`, `ear` (in flight) |
| Glow re-prompt, cue time, results text | `glow.js` `GLOW_CUE_S`, `GLOW_RETRY`, `Glow.retry()`, the `breaths seen` summary |
| Helping-hand lines | `roots.js` `Roots.assistLine`, `sight.js` `Sight.assistLine`, `glow.js` `Glow.assistLine` |
| Sight dwell (1.3 s) and finger-tap selection | `sight.js` dwell block, `game.html` `input.onImu()` |
| Care view tiles, chart, "What helps", adaptations | `nurse.html` (header, tiles, `rounds()`, `adaptations()`) |
| Honest limits, lag, wet-in | `README.md:94-97`, `README.md:201-202`, `README.md:41-42` |
| Status and validation | `HANDOFF.md:21-32` |
| Enclosure concept, not printed | `enclosure/ENCLOSURE.md:3-11`, `:22`, `:51`; renders in `enclosure/img/` |
