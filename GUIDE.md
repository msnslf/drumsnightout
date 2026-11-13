# Codebase Guide

A map of how and where everything is implemented, written for someone about to change most of it.
For the short version (how to run, key bindings) see `README.md`.

**Contents**
1. [The big picture](#1-the-big-picture)
2. [How the code is loaded](#2-how-the-code-is-loaded)
3. [Timing: the one rule that matters](#3-timing-the-one-rule-that-matters)
4. [File-by-file reference](#4-file-by-file-reference)
5. [How a frame runs](#5-how-a-frame-runs)
6. [How a key press flows](#6-how-a-key-press-flows)
7. [Recipes: common changes](#7-recipes-common-changes)
8. [Music from your DAW](#8-music-from-your-daw)
9. [Gotchas](#9-gotchas)

---

## 1. The big picture

```
              ┌──────────────── Tone.js Transport (the music) ─────────────────┐
              │  ticks → beats; tempo changes; scheduled callbacks             │
              └───────────────▲───────────────────────────┬────────────────────┘
                              │ beatAtTime()              │ scheduleRepeat / atBeat
                       ┌──────┴──────┐             ┌──────▼──────┐
  key press ──────────►│   Clock     │             │ MidiMusic   │  your MIDI clips, bar by bar
  (event.timeStamp)    │ beat now /  │             │ + Music     │  (SFX + metronome)
                       │ beat of key │             │             │
                       └──────┬──────┘             └──────▲──────┘
                              │ beat                      │ phase
                       ┌──────▼──────┐   phase     ┌──────┴──────┐
                       │  Scene      │◄────────────│   Song      │  which part of the game
                       │ (game.js)   │             │  phaseAt()  │  a beat falls in
                       └──────┬──────┘             └─────────────┘
               ┌──────────────┼───────────────┬───────────────┐
         ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐
         │  Layout   │  │ DanceMode │  │BowlingMode │  │  Drum ×4   │
         │ state()   │  │ letters,  │  │ aim, balls,│  │ pose, bounce│
         │ geometry  │  │ judging   │  │ pins       │  │ squish,stick│
         └───────────┘  └───────────┘  └────────────┘  └────────────┘
```

- **Clock** turns audio time into a song position in beats.
- **Song** turns a beat into a game phase (countoff / dance / toBowl / bowl / toDance).
- **Layout** turns a phase into stage geometry (where lines, drums and the clef are).
- **Everything visible is drawn from `(beat, phase, layout state)`** each frame. Nothing animates on its own timer.

Scenes: `title` → PLAY → `comic` → `game` (game over happens inside it, REPLAY restarts it) …. The title's SETTINGS (difficulty, audio mix) is a panel inside the title scene, also opened from the pause menu (the same `PauseMenu` in the comic and the game). `calibrate` is reached from settings → difficulty (on the title or the pause menu; from the pause menu it ends the game) and returns to the title's difficulty page. QUIT (pause menu) or Esc in the game goes back to `title`.

---

## 2. How the code is loaded

- **No build step, no modules.** `index.html` loads plain `<script>` tags in order. Every file's top-level `const`/`class`/`function` is a global that later files can use.
- **Order matters** (top to bottom in `index.html`):
  `lib/pixi.min.js` → `lib/Tone.js` → `lib/Midi.min.js` → `config` → `clock` → `song` → `mixer` → `music` → `instruments` → `midi-music` → `drum` → `game/layout` → `game/dance` → `game/bowling` → `scenes/*` → `input` → `main`.
  A file may only *use at load time* things defined above it. Things used inside functions called later (after `main()` runs) can live anywhere.
- **Adding a file:** add a `<script>` tag in the right place.
- **Libraries** are vendored in `lib/`: PixiJS 8.22.0 → global `PIXI`; Tone.js 15.1.22 → global `Tone`; @tonejs/midi 2.0.28 → global `Midi` (bundled into one file, since that package doesn't ship a browser build). To upgrade, replace those files.
- **Opening the page:** run `start-server.command` (a local web server). Double-clicking `index.html` runs the game, but browsers block loading files (MIDI, images, JSON) from `file://`, so there's no music and the title screen says so.
- **Virtual resolution:** everything is laid out at 1280×720 (`CONFIG.WIDTH/HEIGHT`) inside `Scenes.stage`, which `main.js` scales and letterboxes to the window.

---

## 3. Timing: the one rule that matters

> **Never animate anything musical with frame time. Compute it from `Clock.beat()`.**

### Where time comes from — `src/clock.js`

| Function | What it gives you |
|---|---|
| `Clock.beat()` | Song position in beats **as currently heard from the speakers**. Monotonic; frozen while paused. Call once per frame. |
| `Clock.beatOfEvent(e)` | The beat a key/pointer event happened on, from `e.timeStamp`, with the calibration offset applied. Use for judging input. |
| `Clock.rawBeatOfEvent(e)` | Same, without the offset (calibration uses this). |
| `Clock.beatAtTime(ctxTime)` | Beat at an audio-context time. Inside Tone callbacks, `beatAtTime(time)` gives the beat being scheduled. |
| `Clock.atBeat(beat, cb)` | Run `cb(audioTime)` on the audio scheduler at an exact beat. Use `audioTime` to trigger sounds sample-accurately. |
| `Clock.timeAfter(time, beats)` | Audio time `beats` after audio time `time`, following tempo changes already on the tempo curve. |
| `Clock.bpm()`, `Clock.beatsToMs(b)` | Current tempo; convert beat distances to ms (for judging windows). |
| `Clock.reset(bpm)`, `Clock.start(time?)` | Stop/rewind the Transport and clear everything scheduled on it; start it again (at audio `time`, default in 0.1 s). |
| `Clock.running` | True between `start()` and the next `reset()` (music of some kind is playing). |
| `Clock.nextBar()` | Audio time of the next bar line not yet scheduled (0 if stopped). |
| `Clock.nextHalfBar()` | Same for the next half-bar line (beat 1 or 3). |
| `Clock.pause()`, `Clock.resume()` | Suspend/resume the AudioContext. Music, scheduled sounds and every beat-driven animation freeze together. |
| `Clock.setInputOffset(ms)` | Set and save (in `localStorage`) the calibration offset. |

**How "as heard" works:** `audibleTimeAt()` uses `AudioContext.getOutputTimestamp()` to find which audio time is leaving the speakers right now, so output latency is built in. Safari lacks that API and falls back to an estimate from `outputLatency`/`baseLatency`. Then `beatAtTime()` asks the Transport how many ticks had elapsed at that audio time. Ticks follow tempo changes, so **a note at beat 37 stays at beat 37 even if the BPM changes on the way.**

### The practical rules

1. Positions: from `noteBeat − beat` (see `placeLetter`), not `y += speed * dt`.
2. One-shot animations: store the *beat* they started on, compute `t = (beat − startBeat) / durationBeats`.
3. Sounds tied to the music: schedule with `Clock.atBeat(...)` or inside a Transport callback using its `time` argument. Never `Tone.now()` (that's ~0.1 s late due to look-ahead).
4. Sounds triggered by the player: `Tone.immediate()`.
5. Tempo changes: `Clock.transport.bpm.setValueAtTime(bpm, time)` inside an `atBeat` callback.
6. Sprite animation frames: pick the frame index from the beat (see `Drum.update`), not `AnimatedSprite`'s timer.

---

## 4. File-by-file reference

### `src/config.js` — every tunable number

`CONFIG` holds the numbers; `COMIC_PAGES` holds the comic text (one string per panel). Highlights:

| Key | Used by | Meaning |
|---|---|---|
| `BPM`, `BEATS_PER_BAR`, `COUNTOFF_BARS` | Song, game, settings | Default starting tempo (the player's is `Settings.bpm`), bar length, count-off length |
| `START_BPM_MIN`, `START_BPM_MAX` | settings | Range of the starting tempo slider |
| `END_BPM`, `END_BPM_PER_SEC` | game | At game over the music slows to this tempo at this many bpm per second, fading out over the slowdown's last bar |
| `PHASES` | Song | The song form for one cycle: `[{name, bars}]`. Names are referenced in code (see Recipes before renaming). |
| `INPUT_OFFSET_MS` | Clock | Default calibration if nothing is saved |
| `DIFFICULTIES` | settings, dance | `{name, windowMs}`: the ± hit window |
| `LANE_KEYS` | settings | Default key per drum/lane (0 = leftmost lane); the live bindings are `Settings.keys` |
| `LANE_DRUMS` | midi-music, dance | MIDI note per lane in the dance drums clip (low tom, kick, snare, high tom) |
| `PATTERN_LOOKAHEAD_BEATS`, `HIT_CUE_SCALE` | dance, calibrate | Beats a letter takes from the top of the lane to the hit line (sets the speed), letter size at the hit line |
| `JUDGE_HOLD_BEATS`, `JUDGE_SHORT_BEATS` | dance | How long judgement text stays up; the short time is used when the lane's next note is 1 beat or less away |
| `JUDGE_WORDS` | dance | Words shown in the hit circle for each judgement (`miss`, `good`, `perfect`), one picked at random |
| `MISSES_PER_SQUISH`, `SQUISHES_TO_PANCAKE` | Drum | Squish rules |
| `SQUISH_TEMPO_LEVEL`, `SQUISH_TEMPO_BPM` | game | A stick hit that takes a drum to this squish level ramps the tempo up this much |
| `AIM_*`, `ROLL_BEATS`, `BALL_*`, `BPM_PER_STANDING_PIN` | bowling, game | Bowling tuning |
| `BOWL_HINT_WORDS` | bowling | Round 1 hint shown one word per lane, one per beat, on the second bowling bar |
| `INK`, `PAPER`, `FONT` | everywhere | The black-and-white look |
| `CONFIG.MUSIC` (`MUSIC`) | midi-music | MIDI clip file(s) per song section (section 8) |

### `src/clock.js` — the music clock
See section 3. `init()` creates our own native `AudioContext` and hands it to Tone (`Tone.setContext`). That's why **all Tone nodes must be created after `Clock.init()`**.

### `src/song.js` — the song form (+ small helpers)
- `Song.phaseAt(beat)` → `{ name, cycle, startBeat, endBeat, progress }`. `cycle` counts dance→bowl rounds from 0; it's −1 in the countoff.
- `Song.phaseStart(cycle, name)`, `Song.phaseBeats(name, cycle)`, `Song.cycleStart(cycle)`.
- **Bowling loop:** `Song.extraBowlBeats[cycle]` counts the beats added to that cycle's bowling phase. `Song.extendBowl(cycle, beats)` adds a bar, or 2 beats for a final 2/4 bar so the transition can start on beat 3 (called by `GameScene._scheduleBowlCheck`). After a 2/4 bar every later downbeat is 2 beats off the absolute multiples of 4, so count bars from a phase's `startBeat`, never from beat 0. `Song.reset()` clears it at game start.
- Helpers used everywhere: `ease(t)` (smoothstep, clamped), `lerp(a, b, t)`.

### `src/mixer.js` — channels, sends, ducking
- `MIX`: every level in dB. Five channels (`drums`, `nodrums`, `all`, `sfx`, `banter`), each with a `reverb` and a `distortion` send, plus the two send returns. The distortion return runs a 100%-wet `Tone.PingPongDelay` into the `Tone.Distortion`; `MIX.distortion.amount` (0..1, not dB) is the distortion amount. `perc`, `bass`, `chords` and `melody` have their own channels (with sends) feeding `nodrums`. `drums` and `nodrums` feed `all`; `all`, `sfx`, `banter` and the returns sum to the master, then a 150 Hz low cut, then `Tone.Limiter(-14)`. `sfx` has its own 300 Hz low cut in front of its channel. Low cuts come from `lowCut(hz)`: a 12 dB/oct high-pass that's -3 dB at `hz`. `MIX[name].pan` (-1 left .. 1 right) pans a channel: `melody` is hard right and `chords` hard left. Every instrument's reverb send is scaled by CC3 in its tracks (see `instruments.js` below).
- `banter` gets the strike voice lines (`vo_strike`, `vo_multistrike` in `music.js`). It's not ducked and ducks nothing.
- Player volumes: `all` passes through `Mixer.user.music`, and `sfx` and `banter` both through `Mixer.user.sfx` (each a `Tone.Volume`) before the master. `Mixer.setVolume(group, 0..1)` (called by the settings sliders via `Settings.setVolume`) sets it as gain² and also offsets the sends of every channel in that group, so reverb/distortion follow the slider. These are separate from `MIX`.
- `all` has a `Tone.Compressor` (before the sfx ducking); `threshold` sets it.
- Ducking: the `drums` channel's envelope ducks `nodrums`, and `sfx` ducks `all`. `duck` is the gain on that envelope (higher = deeper dips).
- `Mixer.init()` (called from `main` right after `Clock.init()`) builds the graph. `Mixer.in[name]` is what sounds connect to. `init` applies the saved `Settings.volume`. `Mixer.lowpass` (a 20 kHz low pass) then `Mixer.fade` (a gain) come after the music volume and the reverb/distortion returns (not sfx/banter): `lowpassSweep(start, end)` sweeps the cutoff exponentially to 20 Hz, `fadeOut(time, seconds)` ramps the gain to 0, `unfade()` puts both back.
- `Mixer.update()` (every frame, from `main`'s ticker) keeps the delay time at ¾ beat of `Clock.bpm()`, ramping over 1 s when it changes.

### `src/music.js` — sound effects and the metronome
- `Music.init()` creates the SFX and metronome synths (called once from `main`). Metronome kick/hat go to the `drums` channel, the click and SFX to `sfx`.
- `Music.startMetronome(countInBeats)` is the calibration screen's beat.
- `Music.countoffClicks(beats)` clicks every beat of the game's count-off (accent on each bar's downbeat).
- `revCymbal(time, end)` plays `assets/music/samples/revcym.wav` (into `nodrums`, -12 dB) so it ends at `end`, starting partway in if it doesn't fit. `MidiMusic._bar` calls it on each `toDance` downbeat with `end` = the dance downbeat.
- SFX: `squish(time, index)` (scheduled; plays `assets/sfx/stickgod-drum<index>.wav` into `sfx`). `_once()` prevents two identical sounds at the exact same time, which Tone doesn't allow (see Gotchas).
- Bowling cues: `cue(name, time, voice)` / `stopCue(name, time, voice)` play placeholder clicks and pops named after their future sample files (`sfx_ballRoll`, `sfx_pinHitSingle`, `sfx_pinCount`, `sfx_bpmUpdate` on `sfx`), built in `_initCues`. `vo_strike` / `vo_multistrike` (on `banter`) play two different random variations from `Music.voices`, panned hard left and right, each on its own `Tone.Player` so overlaps aren't cut. `Music.loadSamples()` (awaited in `main` after `Music.init()`) loads `samples` (single files, `assets/sfx/<name>.wav`: `bowling-miss`, played by `sfx_bowlingMiss`) and fills `voices` from `assets/sfx/strike1.wav`, `strike2.wav`… (and `multistrike…`), stopping at the first missing number; add a variation by adding the next number. To add another voice line, add its name to `voices`. `click` and `pop` take `{ randomizeRange: [lo, hi] }` to shift each trigger by a random whole number of semitones (used on `sfx_pinCount`). Their start times are kept strictly increasing per synth (`after`), since Tone throws if a late callback restarts a synth at the same instant. `voice` picks one of a cue's synths when it overlaps itself (`sfx_ballRoll` has one per lane). To use samples, replace an entry of `this.cues` (and `cueStops` for `sfx_ballRoll`, which holds until stopped).

### `src/midi-music.js` — your MIDI clips
- `MidiMusic.load(out)` (awaited in `main`) fetches every file in `CONFIG.MUSIC`, then `_buildLayer()` turns each file into a layer: `{ file, bars, byBar: [[{offset, durBeats, midi, velocity, inst, lane}]], info }` (`lane` is set for drums-track notes listed in `CONFIG.LANE_DRUMS`). `MidiMusic.clips[section]` is the list of that section's versions, each a list of layers. Version v swaps the section prefix for a numbered one (`dance-drums.mid` → `dance2-drums.mid`), probed until a number has no files; version 1 accepts `dance1-drums.mid` or the plain name. Positions come from MIDI ticks ÷ PPQ, i.e. beats; the file's tempo is ignored.
- `_instrumentKey()` decides which instrument plays each track (see section 8); `_instrument()` creates each instrument once.
- `MidiMusic.start()` schedules `_bar(time)` every half bar; `_bar` plays that half of the bar (half-bar lines counted from the current phase's `startBeat`, so a 2/4 bowling bar moves the downbeat), and skips notes past the phase's end (the second half of a 2/4 bar). It finds the section and round for that bar and plays the half's notes from `barNotes(section, cycle, bar)`. Rounds cycle through the versions (wrapping after the last); each layer plays bar `n % layer.bars`, where `n` counts that version's bars played in earlier rounds (a 2/4 bar counts as one) plus the bar in this phase. So each layer loops at its own length, and long layers continue across rounds of the same version. Note times come from `Clock.timeAfter`, so they follow tempo changes already on the curve (the bowling tempo ramp) within the bar. In `dance`, lane notes are skipped: the player plays them.
- `MidiMusic.autoLanes` (set at game over, cleared by `start()`) makes `dance` play its lane notes too, since nobody's playing them.
- `playLane(lane, time, velocity)` plays a lane's drum (the player's hit) on `playerKit`, a second drums kit made in `load()`. It's separate because the music books each bar's notes ahead, and Tone can't start a sample earlier than one already booked, so sharing voices would push the player's hits onto the music's.
- `MidiMusic.start("intro")` loops a single section instead of following the game. `MidiMusic.playIntro()` does that once audio is allowed, if the section has files and nothing is `Clock.running`; `TitleScene.update` and `ComicScene.update` call it every frame. So the intro starts with the first key/click on the title, carries on through settings and the comic, and restarts whenever you return to the title. `GameScene.enter` (or `CalibrateScene.enter`) stops it with `Clock.reset`.
- `hasClip(section)` is used by `playIntro`. `needsServer` and `missing` report load problems.

### `src/instruments.js` — what your tracks sound like
- `INSTRUMENTS`: the five instruments (`drums`, `perc`, `bass`, `melody`, `chords`), each a function that builds it. Change sounds here. `DEFAULT_INSTRUMENT` (melody) is used when nothing matches.
- `instrumentForName()`: a track named exactly after an instrument, or a file ending in `-instrument.mid`, picks it (section 8).
- Each instrument plays into its own mixer channel; `perc`, `bass`, `chords` and `melody` feed `nodrums`.
- `melodic(synth, out, volumeDb, {mono})` wraps any Tone synth or `Tone.Sampler` with the `play(midi, durationSec, time, velocity)` interface.
- An instrument may also have `cc: { number: (value0to1, time) => … }`; `MidiMusic` plays those CC events from the track. `cutoffCC(out)` gives `bass`, `melody` and `chords` a lowpass whose cutoff follows CC1 (mod wheel), 50 Hz–20 kHz on an exponential scale. Tracks missing CC1, CC2 or CC3 get a default event at beat 0 (`CC_DEFAULTS`: CC1 = 95, CC2 = 0, CC3 = 0). `sendCC(name, key)` scales a channel's send (`Mixer.setSendCC`): 0 = off, 127 = the channel's `MIX` level. `melody` and `chords` get CC2 on their delay+distortion send; `MidiMusic._instrument` gives every instrument CC3 on its reverb send.
- `Kit` → `DrumKit` (`DRUM_MAP`: kick, rim, snare, clap, toms) and `PercKit` (`PERC_MAP`: hats, cymbals, tambourine, cowbell, shaker). Each has its own voices in `this.voices` and plays them in `hit()`. A note belonging to the other kit is forwarded there.

### `src/drum.js` — the drum characters and the drumstick
- `class Drum(index)`
  - `view` (positioned by the scene at the drum's bottom-centre) → `spinner` → `body` (squash/stretch + bounce) → `sprite` (none until `useSpritesheet`).
  - State: `squishLevel` (persists all game), `misses` (reset each dance segment), `currentPose`.
  - `dance()` is called on a successful hit and advances to the next pose. `miss(beat)` counts a miss and summons the stick at `MISSES_PER_SQUISH`, then calls `onStick(level, landBeat)` if set (the squish level it will land at). `spin(beat)` turns the drum a full 360° over one beat (inside `spinner`, which rotates around the drum's centre); called for every drum on a bowling throw.
  - `update(beat, animRate)` computes squash from `squishLevel`, bounce from the beat, and picks a sprite frame.
  - `useSpritesheet(sheet)` adds the sprite. It expects `sheet.animations.pose1 / pose2 / pose3` (names in `POSES`), 4 frames each. Default timing: the current pose loops once per beat (`animRate` 1; the game passes 0.5 during `bowl`, so once per 2 beats) and each hit advances to the next pose.
- `class DrumStick`, one per drum, drawn inside the drum's `view`.
  - `strike(beat, onLand)` lands on the next whole beat at least half a beat away and schedules its drum's stick god sound (`Music.squish`) there.
  - Timeline: falls for 0.5 beat, holds 0.5, lifts for 1. `onLand` increments `squishLevel`.

### `src/game/layout.js` — geometry and transition choreography
- **Layout constants:** HUD row height `HUD_H`; `Layout.drums` (`floorY`, `scale`; drums never move), `Layout.danceTop` (centre of the dance lanes' top edge, just below the clef; the lanes are `Layout.danceTopWidth` (1/8) as wide there as at the hit line), `Layout.danceClip()` (mask that hides letters above the lanes), `Layout.clefHomeY`, `Layout.lanes` (bowling lanes' top/bottom; they end just above the drums), `Layout.hitY` (hit line, placed so its circles' bottoms sit just above the drums), `Layout.hitRadius` (the circle on the hit line in each lane; scales with `HIT_CUE_SCALE`), `Layout.countY` (count-in text).
- **`Layout.state(phase)` is the choreography.** It returns 0..1 values:

  | value | meaning | toBowl (beats) | toDance (beats) |
  |---|---|---|---|
  | `spread` | converging lanes straighten into vertical bowling lanes | 0–1.5 | 1.25–2.5 (back) |
  | `clef` | position along the clef's route: from the middle to every pin spot (depositing pins) and back / stays home | 1.5–3 | — |
  | `bowlUI` | aim arrows fade (and, in toDance, standing pins) | 3–4 | 1–1.75 |
  | `title` | title fades out, swaps text, fades back in (in toDance it swaps instantly at half `spread`) | 3–4 | |

  Timings are in beats of the transition, mapped onto 4 beats whatever its length (the 6-beat toBowl runs at 2/3 speed, the 2-bar toDance at half speed). Edit the numbers in `state()` to retime anything.
- **Geometry functions:** `lineX(i)` (line i's x at the hit line / in bowling), `lineTop(i, spread)`, `lineBottom(i, spread)`, `lanePoint(i, s, spread)` (centre of lane i, `s` from bottom 0 to top 1), `lane(i)` (lane rect in bowling layout), `drumX(i)`, `beatS(ahead)` (how far up a lane a letter's centre is, `ahead` beats early), `pins(i)` (pin spots of lane i in visiting order), `clefPath`, `clefPos(st)`, `pinDrop(order, st)` (0..1, how far a pin has been deposited).
- `class StaffView` draws the 5 lines, the hit line (broken in each lane by an empty circle), faint lines 1 and 2 beats before it (dashed at 0.5 and 1.5), and the percussion clef (which doubles as the pin machine) from a layout state. It's drawn above the bowling layer so the clef shows over the pins.

### `src/game/dance.js` — the dancing gameplay
- `generateChart(cycle)` builds one dance segment's notes `{beat, lane, velocity, state, view}` from the lane notes of that round's dance drums clip (`MidiMusic.barNotes`).
- `makeLetter(lane)` draws the lane's key letter (`Settings.keys`, uppercased; `DanceMode.relabel()` updates existing letters after a rebind, called on resume) at its full hit-line size (`HIT_CUE_SCALE`), so it's only ever shrunk and stays sharp. `placeLetter(view, lane, ahead, spread)` puts a letter `ahead` beats before its note so its centre is on the hit line, framed by the lane's circle, exactly on the beat, then hides it. Letters move in true perspective (`Layout.beatS`): slow near the top, speeding up toward the hit line, so the beat guides get further apart closer to the hit. They reach the top `PATTERN_LOOKAHEAD_BEATS` before the hit and grow with the lane width. They slide in under the top edge (masked by `Layout.danceClip()`). Shared with calibration.
- `class DanceMode`
  - `chart(cycle)` lazily generates the chart and creates its letter sprites.
  - `startSegment(cycle)` resets per-segment miss counters and frees old charts.
  - `update(beat, phase, t)` places letters (`t` = spread, used to follow/fade with the lanes) and **detects misses** (a pending note whose window has passed).
  - `press(lane, beat, phase)` finds the nearest pending note in that lane within the window, marks it hit, makes the drum dance, and shows PERFECT/GOOD inside that lane's hit circle (`judges`, one text per lane, sized from `hitRadius`; `_judge(note, kind, beat)` shows a random word from `CONFIG.JUDGE_WORDS[kind]` for `JUDGE_HOLD_BEATS`, or `JUDGE_SHORT_BEATS` when the lane's next note is 1 beat or less away; `_fitText` wraps a word that doesn't fit onto two lines (split at the space nearest the middle) and/or shrinks it so it stays inside the circle even at its pop size (`JUDGE_POP`)). Letters hide on a hit or when they reach the hit line. Every press plays the lane's drum (`MidiMusic.playLane`): an early hit inside the window sounds exactly on the note, a late or stray press sounds immediately. Stray presses are currently free.
  - **Holds:** a press that hits sets `held[lane]`; while it stays down, `update` hits each later note in that lane as it enters the window ahead (`_hit`: sound scheduled exactly on the note, PERFECT). A press that hits nothing still starts a hold if it lands after a run's first note with more of the run to come (`_insideRun`), so missing a run's first note doesn't lose the rest. `release(lane)` (from `GameScene.onKeyUp`) or any other stray press of that key ends it; holds are cleared outside `dance`/`countoff`. This is how bursts of notes are played. `markHoldStarts` (called by `generateChart`) flags the first note of each run of same-lane notes ≤ ½ beat apart (`holdStart`; every note in a run has `run` = that first note); `chart()` gives it a `(hold)` label (`makeHoldLabel`, `holdView`) that `_placeHold` keeps just left of the letter and fades out between the 2- and 1.5-beats-ahead marker lines.
  - `_activeCycles(phase)` decides which charts are in play. The next cycle's chart is only created during `toDance`, once the bowling loop has ended and its start beat is final.

### `src/game/bowling.js` — the bowling gameplay
- `class BowlingMode`
  - `prepare(round)` (at the start of toBowl) sets ball size for the round and the pin triangle per lane (one sprite per pin).
  - Pins: `frames.standing` (1) and `frames.fallen` (4). Placeholders come from `_placeholderFrames()`; `useSpritesheet(sheet)` swaps in a sheet with animations `standing` and `fallen` (loaded in `main.js`). A knocked pin falls and takes the hitter's speed (ball or pin), pushed away from the hitter's centre (`vx`, `vy` in px/beat). Its speed decays exponentially, shifted to reach 0 at `PIN_STOP_BEATS` (`PIN_DECAY` sets the curve; `pinSlow`, `pinPos`, `pinSpeed`), then it fades out over `PIN_FADE_BEATS`. It gets a random `fallAngle` and `spin` (radians per pixel, up to `PIN_MAX_SPIN`); its rotation and fallen frame (one per `PIN_FRAME_PX` travelled) follow the distance it has moved, so they only change while it moves.
  - `aimAngle(i, beat)` is a sine of the beat. Lanes start in sync and diverge by `AIM_DIVERGENCE_PER_ROUND` each round.
  - `ballPos(L, beat)` is the ball position as a function of the beat, from that lane's `throwBeat`. It always takes `ROLL_BEATS`, and the x is "folded" between the lane walls (that's the bumper ricochet). Lanes are vertical: the ball rolls up from behind its drum to the pins at the top. Aim angle 0 = straight up.
  - `throw(beat, bpm, onResult)` freezes all four aims, then gives each lane a `throwBeat`: the next half note (beat 1 or 3), then every half note after (balls overlap). It **pre-computes the whole outcome** and schedules every sound:
    - `_roll(L)` steps through the roll every 1/128 beat for which pins fall and when: hit by the ball, or by a moving pin (pins only knock pins in their own lane); `sfx_ballRoll` (that lane's voice) from throw to exit; `sfx_pinHitSingle` on each pin's hit; a ball that knocks nothing plays `sfx_bowlingMiss` as it passes the front pin.
    - A strike adds a banner (`banners`) and `vo_strike` on the beat the ball exits (rounded up); the 2nd strike onward is MULTISTRIKE + `vo_multistrike`.
    - No pins standing: `danceBeat` is the next bar line after the last ball exits. Otherwise `_countAndRamp`: from the next half note, each standing pin is replaced by its number (`countBeat`) every `COUNT_STEP` (1/6) beat with `sfx_pinCount`; then from the next half note the highest slides for `COUNT_MOVE_BEATS` (2) under the tempo readout (`tempoAnchor`, set by the scene) and becomes `+ n x BPM_PER_STANDING_PIN`. That landing beat is `danceBeat`: toDance starts there (on beat 3 it ends bowling with a 2/4 bar, and becomes the new beat 1) while the tempo rises by `BPM_STEP` (0.1) `BPM_STEPS_PER_BEAT` (16) times a beat with `sfx_bpmUpdate`; the equation stays until the ramp ends (`rampEnd`). The whole ramp is put on the tempo curve a quarter beat before the bar it starts in.
    - The tempo ramp itself is `tempoRamp(rampStart, bpm, newBpm, lead)` (top of `bowling.js`, also used by `GameScene`): it puts the steps on the tempo curve `lead` beats early, schedules `sfx_bpmUpdate` per step and returns the ramp; `rampBpm(ramp, beat)` is the tempo to show. `cancelTempoRamps()` makes every ramp whose steps haven't been put on the curve or cued yet do nothing (it bumps `tempoRampEpoch`); used by `GameScene._setTempo` and at game over.
    - Reports `{ bpm }` (the new tempo) to `onResult`.
  - `danceBeat` is when bowling ends (Infinity until thrown); `GameScene._scheduleBowlCheck` repeats the bowling bar until then. `displayBpm(beat)` is the tempo to show while counting/ramping.
  - `update(beat, phase, st)` draws pins (deposited as the clef visits each spot, faded out with `bowlUI` in toDance), balls (while rolling), aim arrows (frozen after the throw, gone once that lane's ball rolls), the banner and the count (`countView`, during `bowl` and `toDance`; the other numbers fade out while the total slides). Lanes are masked to below `Layout.lanes.top`, so balls and pins vanish into the top of the lane.
  - `_updateHints(beat)`: round 1 only, if nobody has thrown by the second bowling bar, shows `BOWL_HINT_WORDS` one per beat in lanes 1–4 (2 beats up, then a 1-beat fade). A throw hides them at once.

### `src/scenes/*.js` — screens
Every scene has `view` (a PIXI container) and `enter(data)`, `exit()`, `update()`, `onKey(e, beat)`, and optionally `onKeyUp(e)`. `Scenes.go(name, data)` in `main.js` switches between them.

- **`menu.js`**: `Menu(items, {x, y, gap, size})` (rows centred on `x`, default the screen centre), the vertical option list every menu uses. Items are `{label, onSelect}` or sliders `{label, get, set, step?}` (0..1; `step` is the ← → step, default `SLIDER_STEP`); `label` may be a function (re-read every frame). ↑ ↓ / hover choose, Enter / Space / click pick, ← → (steps of `SLIDER_STEP`) or drag move a slider. The host calls `menu.update()` and `menu.onKey(e)`.
- **`settings.js`**: `Settings` holds the player's difficulty (index into `CONFIG.DIFFICULTIES`), starting tempo `bpm` (TEMPO slider on the difficulty page, 5 bpm per ← →; changed from the pause menu, it also replaces the current tempo on resume), `volume.music/sfx` (sfx also sets banter) and the dance `keys` (one per lane, lowercase), saved in `localStorage` (`pizzajam.settings`). `Settings.setKey(lane, key)` swaps with whichever lane had that key; `Settings.bindable(key)` allows single printable keys except space, P, `[`, `]`. `SettingsPanel({onBack})` is the SETTINGS → DIFFICULTY / AUDIO MIX / CONTROLS pages; on CONTROLS, picking a lane sets `binding` and the next allowed key binds it (Esc cancels) (`show(page)`, Esc or BACK goes up a page, then `onBack`). On the AUDIO MIX page, `AudioPreview.play(group)` loops a preview while the MUSIC or SFX slider is selected (hover or arrow keys): dance1 (`MidiMusic.start("dance")`, including the player's drum notes) for music, and a 2-bar loop of a multistrike voice pair then pin count clicks on 8ths for sfx. Leaving the row resets the clock, so the title screen restarts its intro. Previews don't play while paused, since the audio clock is frozen. CALIBRATE on the difficulty page goes to the calibration scene; from the pause menu that ends the game or comic (its `exit` resets the clock).
- **`pause.js`**: `PauseMenu({onToggle, canPause})`, the pause overlay used by the comic and the game: `view` (PAUSED + RESUME / SETTINGS / QUIT, or its `SettingsPanel`) and its PAUSE `button` (P underlined; it reads PAUSE paused or not), which each scene positions (top right in the comic and the game). `toggle()` suspends/resumes the clock (refused while `canPause()` is false), then calls `onToggle(paused)`. `show(on)` only shows/hides (scenes call `show(false)` on enter/exit). The scene calls `update()` every frame and `onKey(e)` for keys while paused; Esc on the pause menu quits to the title. The overlay swallows clicks so they don't turn comic pages.
- **`title.js`**: `TitleScene`: PLAY → comic, SETTINGS → its `SettingsPanel`. `enter({page})` opens a settings page directly (calibration returns with `page: "difficulty"`). Starts the intro music. Shows the "needs a local server" note.
- **`comic.js`**: `ComicScene` builds each page from `COMIC_PAGES` in `_buildPage(index)`; panels sit side by side. `next()` turns the page: the old page stays on top and folds around the left edge in `update()` (`PAGE_TURN_MS`). After the last page, SKIP (S is underlined), S or Esc, it goes straight to the game. P or PAUSE opens its `PauseMenu`. Also defines `makeButton(label, onTap, underlineFirst)`, used by SKIP and PAUSE; `underlineFirst` underlines the first letter to show its key.
- **`calibrate.js`**: `CalibrateScene` plays 16 quarter notes after a count-in, records raw tap errors, and sets the offset to −median (`_finish`). The constants at the top set count and thresholds. BACK (top right, `makeButton`) or Esc returns to the title's difficulty page, as does finishing.
- **`game.js`**: `GameScene` is the conductor:
  - `enter` reads the difficulty and starting tempo from `Settings`, resets everything and starts the music. If music is still playing (the intro, or any music a scene left running), the game's transport starts on its next downbeat (`Clock.nextBar()`) so the count-off follows seamlessly.
  - `update` is the per-frame pipeline (section 5).
  - `_onPhase` handles phase changes (start of a dance segment, prepare bowling).
  - `_scheduleBowlCheck` runs the bowling loop (repeats the bar until `bowling.danceBeat`).
  - `_throw` starts `BowlingMode.throw`, stores the new tempo and spins each drum on its lane's throw beat.
  - `_squishTempo(landBeat)`: each drum's `onStick` calls it when a stick hit will take that drum to `SQUISH_TEMPO_LEVEL` (once per drum); it `tempoRamp`s up `SQUISH_TEMPO_BPM` from the landing beat (after any squish ramp still running; the bar already playing keeps its old note timing) and adds to `this.bpm`. `ramps` holds them for the BPM readout.
  - `_drawHud` draws the miss bars (full, emptying one step per miss), the title ("club neutral clef" while dancing, "neutral clef lanes" while bowling), the party clock (`partyTime(beat)`, top of `game.js`: 11:03pm plus an hour per round; dance + toBowl tick on 45 minutes a beat at a time, rounded to the minute, then it holds at :48 through bowl and toDance) with the BPM, and the count-off (READY for every bar but the last, then 1 2 3 4).
  - `pause` (`PauseMenu`): its PAUSE button sits top right, above everything (including the game over fade), for the whole game; P too. Game over blocks pausing (`canPause`); resuming relabels the letters in case keys changed, and if the TEMPO setting changed while paused, `_setTempo(Settings.bpm)` replaces the game tempo from the next half-bar not yet scheduled (cancelling any ramp still to come, which also drops the increases they'd have made). `onKey` routes input.
  - Game over (`_startEnding`, 2 beats after a drum becomes a pancake): everything freezes at that beat; the music carries on following the song (with `MidiMusic.autoLanes`), and from the next beat 1 or 3 the tempo ramps down to `END_BPM` at `END_BPM_PER_SEC` (`cancelTempoRamps` and `cancelAndHoldAtTime` drop any game tempo ramp still to come) while `Mixer.lowpassSweep` sweeps the whole slowdown and `Mixer.fadeOut` fades out its last bar; `_updateEnding` stops the clock once it reaches `END_BPM`; over `GAME_OVER_ZOOM_MS` the pancake zooms to fill the right half (the `0.45`/`0.8`/`0.73` numbers in `_startEnding` set its size and centre) while everything else (`_fading`) fades out and the `GameOverPanel` fades in. `_updateEnding` replaces the normal frame while `ending` is set; keys go to the panel (Esc → title). `enter` undoes it all (`exit` and `enter` call `Mixer.unfade()`).
- **`gameover.js`**: `GameOverPanel`, the left half of the game over: PANCAKES!, "Partied until" the party clock at game over, final tempo and REPLAY (Enter/Space or click, ignored until the zoom finishes), which restarts the game scene. Also `GAME_OVER_ZOOM_MS`.

### `src/input.js` — keyboard
- `Input.init()` adds one `keydown` listener for the whole game. It unlocks audio, handles `[` / `]` (nudge the calibration offset by 5 ms), then calls `Scenes.current.onKey(e, Clock.beatOfEvent(e))`. A `keyup` listener calls `Scenes.current.onKeyUp?.(e)`. Mouse/touch on buttons and menu rows is handled by Pixi events on them.

### `src/main.js` — boot
Order: `Clock.init()` → `Mixer.init()` → `Music.init()` → `await Music.loadSamples()` → `await MidiMusic.load()` → create the Pixi app → letterboxed `Scenes.stage` → create all scenes → `Input.init` → `Scenes.go("title")` → ticker calls `Scenes.current.update()` and `Mixer.update()` every frame. **Drum spritesheets are loaded here** (after the scenes are created): game drums 1–3 use `assets/drums/drum1.json` / `drum2.json` / `drum3.json`, drum 0 uses `drum0.json`. To give another drum its own sheet, add it to `sheets`. The pin sheet `assets/pins/pin.json` is loaded there too if it exists (otherwise placeholder pins).

---

## 5. How a frame runs

`GameScene.update()`:

```js
const beat  = Clock.beat();             // 1. where the music is (as heard)
const phase = Song.phaseAt(beat);        // 2. which part of the game
if (phase changed) this._onPhase(phase); // 3. one-time setup per phase
const st    = Layout.state(phase);       // 4. choreography values
this.staff.update(st);                   // 5. draw everything from beat/phase/st
this.dance.update(beat, phase, st.spread);
this.bowling.update(beat, phase, st);
for (drum) { position at Layout.drumX(i), Layout.drums.floorY; drum.update(beat); }
this._drawHud(...);
// game over: 2 beats after any drum becomes a pancake, _startEnding (then _updateEnding replaces this frame)
```

Because steps 1–4 are pure functions of the music, a dropped frame just means the next frame shows the right thing; nothing falls behind.

---

## 6. How a key press flows

```
keydown (browser) ──► Input.init listener
   ├─ Clock.unlock()               (first gesture starts audio)
   ├─ [ / ] handled here
   └─ Scenes.current.onKey(e, Clock.beatOfEvent(e))
         GameScene.onKey:
           P → pause.toggle   Esc → title
           paused → pause.onKey (RESUME / SETTINGS / QUIT, or its SettingsPanel; Esc on the pause menu → title)
           phase "bowl"  → _throw(beat) → BowlingMode.throw
           lane key (not in toBowl/toDance) → DanceMode.press(lane, beat, phase)
                              ├─ MidiMusic.playLane  (on the note if early, else immediate)
                              └─ nearest note within window? → state "hit", Drum.dance
```

Releasing a lane key (`keyup` → `GameScene.onKeyUp` → `DanceMode.release`) ends a hold. Misses are not caused by key presses. `DanceMode.update` finds them when a note's window has fully passed.

---

## 7. Recipes: common changes

**Retune difficulty, speed, ball size, squish rules:** `src/config.js`.

**Change the comic text or panel count:** `COMIC_PAGES` in `config.js`. To use drawn pages instead, replace the body of `ComicScene._buildPage` with sprites. Keep `page.content` and `page.shadow` (or remove their uses in `update`/`_finishTurn`).

**Add drum art (spritesheets):**
1. Export a TexturePacker-style JSON + PNG per drum with animations `idle`, `dance`, `squish` into `assets/drums/`.
2. In `main.js`, before `Scenes.go("title")`:
   ```js
   for (let i = 0; i < 4; i++) {
     const sheet = await PIXI.Assets.load(`assets/drums/drum${i}.json`);
     Scenes.list.game.drums[i].useSpritesheet(sheet);
   }
   ```
3. Run via a local server.
4. Adjust anchors/scale in `Drum.useSpritesheet` and `Layout.drums.scale`.

**Change the music:** compose in your DAW and export MIDI (section 8). Change how it sounds in `src/instruments.js`.

**Use recorded audio instead of MIDI:** a fixed recording can't follow the bowling loop or the tempo increases, so if you go this way, cut it into one-bar loops per section and start them from `MidiMusic._bar` (one `Tone.Player` per section, `player.start(time)`), with `playbackRate` = current BPM ÷ recorded BPM. Expect pitch to shift with tempo unless you also use `Tone.GrainPlayer`.

**Change the song form** (e.g. 8 bars of dancing, 2 bars of bowling): edit `CONFIG.PHASES` bar counts. The phase *names* `dance`, `toBowl`, `bowl`, `toDance` are referenced in `Layout.state`, `GameScene._onPhase/onKey`, `DanceMode._activeCycles`, `BowlingMode.update` and as the section names in `CONFIG.MUSIC`. Search for them if you rename or add a phase. Transitions longer than one bar still work: `Layout.state` maps their progress onto the 0–4 beat timeline. Bar counts may be multiples of 0.5 (e.g. `toBowl: 1.5` = a 4/4 bar then a 2/4 bar, and the next phase starts a new downbeat); the music checks for downbeats every half bar, so finer fractions won't work.

**Change the note charts:** edit the dance drums clip (`danceN-drums.mid` for round N); lanes come from `CONFIG.LANE_DRUMS`. To chart some other way, replace `generateChart(cycle)` in `dance.js`. It just needs to return `[{ beat, lane, state: "pending", view: null }]` with absolute beats starting at `Song.phaseStart(cycle, "dance")`.

**Change the transition choreography:** the numbers in `Layout.state()`; the line endpoints in `Layout.lineTop/lineBottom`; what the clef looks like in `StaffView.update`; how pins drop/fade in `BowlingMode.update`.

**Bowling physics:** `ballPos` (path), `_roll` (ball/pin and pin/pin collisions, precomputed so hits stay on their scheduled sounds), `pinSlow` (pin slowdown), `prepare` (pin layout).

**Scoring / penalties:** stray presses → the `if (!best) return;` line in `DanceMode.press`. Strike/standing results → the `onResult` callback in `GameScene._throw`.

**Add a scene:** make a class with `view`, `enter`, `exit`, `update`, `onKey`; add its `<script>` before `input.js`; register it in `Scenes.list` in `main.js`; go there with `Scenes.go("name", data)`.

**Change controls:** default dance keys in `CONFIG.LANE_KEYS` (players rebind them in SETTINGS → CONTROLS; which keys are allowed is `Settings.bindable`); game keys in `GameScene.onKey`; global keys (`[` / `]`) in `Input.init`.

**Change the look:** `CONFIG.INK/PAPER/FONT`; geometry constants at the top of `Layout`; letters in `makeLetter`.

---

## 8. Music from your DAW

### The idea
The music is cut into sections that match the game: **intro** (the title screen, settings and comic book pages), **countoff** (the bars before the first dance), **dance**, **toBowl**, **bowl** and **toDance**. You compose MIDI for each section, as one file or one file per instrument. On every bar line the game checks which section it's in and plays the next bar of that section's files, at the game's current tempo. So the music always matches the gameplay, even though the bowling bar repeats for as long as the player waits, and the tempo rises with standing pins.

### Exporting
1. Compose in **4/4** at roughly the game tempo (`CONFIG.BPM`). The tempo in the file is ignored; only the note positions matter.
2. Make each section's clip a whole number of bars, **starting exactly on bar 1** of the export (no lead-in):

   | Section | Plays for | Clip length guidance |
   |---|---|---|
   | `intro` | the title, settings and comic pages, looped until the game starts | any length; each file loops at its own length. Starts on the first key press/click (browsers block sound before that). Silent if it has no files. |
   | `countoff` | 2 bars (`COUNTOFF_BARS`) | 1 or 2 bars (READY, then 1-2-3-4; a click plays on every beat on top) |
   | `dance` | 4 bars per round | 4 bars, or a multiple: an 8- or 16-bar clip plays its next 4 bars each round, then starts over |
   | `toBowl` | 1.5 bars (a 4/4 bar, then a 2/4 bar) | 1 or 2 bars; the 2/4 bar plays the first half of the clip's next bar |
   | `bowl` | 1 bar, repeated until the throw and then until all four drums have bowled (one per half note) and any pin count is done | 1 bar (or 2, 4… it continues bar by bar while it loops) |
   | `toDance` | 1 bar | 1 bar |

   Section lengths come from `CONFIG.PHASES`. 
3. Export as a standard MIDI file (.mid, type 0 or 1) into `assets/music/` with the file names in `CONFIG.MUSIC` (`config.js`), and refresh the page.

**One file or several per section:** a multi-track export (Logic, Reaper, FL, Cubase "export region/selection") works as one file. Or export a file per instrument and list them; they play together as layers. Naming them `section-instrument.mid` also picks the instrument (see below):
```js
dance: ["dance-drums.mid", "dance-perc.mid", "dance-bass.mid", "dance-chords.mid", "dance-melody.mid"],
```

**Each file loops at its own length.** A 1-bar hi-hat file repeats every bar, a 2-bar drum file every 2 bars, and a 4-bar chord file steps through its progression, all lined up from the section's first bar. Layers longer than the section carry on where they left off next round (a 16-bar melody unfolds over four rounds of dancing). Keep lengths that divide evenly into each other (1, 2, 4, 8, 16 bars) so the layers realign.

**File length** is taken from the end-of-clip marker your DAW writes, or from the last note if that marker is earlier. Some DAWs put the marker at the last note rather than the clip's end, so a clip that ends in silence can come out short; check the lengths in the console (see "Checking what loaded"). If a file comes out the wrong length, set it explicitly:
```js
dance: ["dance-drums.mid", { file: "dance-chords.mid", bars: 4 }],
```

**Forcing the instrument:** `{ file: "dance-chords.mid", instrument: "chords" }` overrides the name matching (useful when the track name inside the file says something else).

### Which instrument plays each track
There are five instruments: **drums**, **perc**, **bass**, **melody**, **chords**. Name your tracks after them.

In order of priority:
1. `{ file: "x.mid", instrument: "melody" }` in `CONFIG.MUSIC`.
2. The **track name**, if it's exactly an instrument name (case doesn't matter), or ends in `-instrument` (`bowl-bass`).
3. The **file name**, if it ends in `-instrument.mid`: `dance-bass.mid` → bass.
4. MIDI **channel 10** → drums.
5. Otherwise melody.

**drums** and **perc** both use **General MIDI** drum note numbers:

| drums | Note | perc | Note |
|---|---|---|---|
| kick | 35, 36 (C1) | closed hat (pedal) | 42 (44) |
| rim | 37 | open hat, choked by closed | 46 |
| snare | 38, 40 | crash (china, splash, crash 2) | 49 (52, 55, 57) |
| clap | 39 | ride (bell, ride 2) | 51 (53, 59) |
| toms (pitch follows the note) | 41, 43, 45, 47, 48, 50 | tambourine | 54 |
| | | cowbell | 56 |
| | | shaker (cabasa, maracas) | 82 (69, 70) |

Notes in neither map are ignored. You can keep them as two tracks or as one combined drum track: perc notes on a drums track are passed to perc, and drums notes on a perc track to drums.

Note velocity is used. CC1 (mod wheel) on a bass, melody or chords track sweeps its lowpass cutoff. CC2 on a melody or chords track scales its delay+distortion send (127 = the `MIX` level set in `mixer.js`, 0 = off); the last value sticks until the next CC2. CC3 on any track scales its instrument's reverb send the same way (127 = its `MIX` reverb level). A track with no CC1 events starts at CC1 = 95, and one with no CC2 or CC3 events at 0 (`CC_DEFAULTS` in `instruments.js`). Other CCs are ignored. Add or change sounds in `src/instruments.js`; samples work via `Tone.Sampler` (example in the file).

### Checking what loaded
Open the browser console (Safari: Develop → Show JavaScript Console; Chrome: View → Developer → JavaScript Console). It lists each section, its length in bars and the track → instrument mapping, plus any files that failed to load. Sections without a clip are silent.

### Things to know
- **Nothing before the downbeat.** A clip starts exactly when its section starts, so a pickup into the next section must go at the end of the *previous* section's clip. (Remember `bowl` may repeat, so a pickup at the end of `bowl` plays on every repeat, and its last bar may be cut to 2/4, dropping its second half.)
- **Notes can ring past the bar line** (long pad notes are fine). They're played with their full length.
- **Extra auto-played kicks/snares/toms in dance:** put them on the perc track (or a file with `instrument: "perc"`); perc passes them to the drums kit, so they play with the same sounds and aren't charted.
- **Dance drums are the chart:** in the dance clip's drums track, low tom (41), kick (36), snare (38) and high tom (45) become D/F/J/K notes and aren't auto-played; the player's presses play them. Notes together need both keys at once. Other drum notes play as usual.
- **Versions per round:** `section1-….mid` (or the plain `section-….mid`), `section2-….mid`… are that section's files in rounds 1, 2…; after the highest number it wraps to round 1. Missing numbers stop the search.
- **Tempo changes** ramp up 0.1 BPM at a time from the start of `toDance` (standing pins) and from the stick's landing when it squishes a drum to `SQUISH_TEMPO_LEVEL`; your clips simply play faster, even mid-bar.

---

## 9. Gotchas

- **Create Tone nodes only after `Clock.init()`.** Nodes made at file load time would belong to Tone's default context and either be silent or out of sync.
- **Tone throws if one synth starts twice at the same instant** ("Start time must be strictly greater…"). Coinciding scheduled sounds (two squishes on one beat) need separate synths or the `_once` guard in `music.js`. Tone also clamps a start time that's already past to "now", so two late notes can collide; `melodic()` (mono) and `Kit.play` nudge each start past both the voice's last start and the current audio time.
- **`Clock.reset()` cancels everything scheduled on the Transport,** including `MidiMusic.start()`'s loop and any `atBeat` callbacks. Scenes call `MidiMusic.start()` again after resetting.
- **Pixi reuses event objects.** Read `e.global` etc. immediately in a handler, never after an `await`.
- **`Clock.beat()` is frozen while paused** (and returns 0 before audio starts). Key presses while paused are ignored by the game scene.
- **The bowling loop decides 1/8 beat before each bar line** whether to add another bar (or a 2/4 bar) (on the audio scheduler, ~0.1 s ahead). A throw in the last instant of a bar may cost one extra bowling bar.
- **Charts use absolute beats.** Never create a future cycle's chart before its start beat is final (see `_activeCycles`).
- **Browsers block audio until a user gesture.** `Input` calls `Clock.unlock()` on every key/click; that's why the title screen comes first.
- **`file://` blocks loading assets** (MIDI, images, JSON). Use `start-server.command`.
- **Tempo changes must be on the tempo curve before the bar they fall in is scheduled** (`BowlingMode._countAndRamp` sets its whole ramp a quarter beat before that bar line), since `MidiMusic._bar` times each half bar's notes from the curve when that half starts. If you add other tempo changes, do the same.
- **`localStorage` is per browser and per file location.** Moving the folder or uploading to itch.io starts with a fresh calibration.
