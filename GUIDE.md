# Codebase Guide

A map of where things live. For running the game and the keys, see `README.md`.

1. [Big picture](#1-big-picture)
2. [Loading](#2-loading)
3. [Timing](#3-timing)
4. [Where things live](#4-where-things-live)
5. [Recipes](#5-recipes)
6. [Music from your DAW](#6-music-from-your-daw)
7. [Gotchas](#7-gotchas)

---

## 1. Big picture

- **Clock** (`clock.js`) turns audio time into a song position in beats, as heard.
- **Song** (`song.js`) turns a beat into a phase: `countoff`, then cycles of `dance` → `toBowl` → `bowl` (repeats until bowling is done) → `toDance`.
- **Layout** (`game/layout.js`) turns a phase into 0..1 choreography values and stage geometry.
- **Everything visible is drawn from `(beat, phase, layout state)` every frame.** Nothing musical has its own timer.
- **MidiMusic** plays your MIDI clips half a bar at a time, following the phase; **Music** plays SFX; **Mixer** routes it all.

Scenes: `title` → PLAY → `calibrate` (first PLAY of a visit only: an instructions page with START, straight to the game, or CALIBRATE; `Settings.calibrated`) → `game` (game over and REPLAY happen inside it). SETTINGS is a panel in the title and in the pause menu (`PauseMenu`). `calibrate` is also reached from settings → difficulty (from the pause menu this ends the game) and returns to the title's difficulty page. On the first PLAY it taps along to the intro music (left playing; taps start on its next downbeat, `base`) instead of the metronome, and the intro carries on until the game starts on its next downbeat. It opens with an instructions overlay (OK from settings, START or CALIBRATE on the first PLAY; RECALIBRATE skips it via `ready`) and ends on CONTINUE / RECALIBRATE; `enter({ then })` sets where START, CONTINUE or Esc go. Esc / QUIT go back to the title.

## 2. Loading

- No build step, no modules: `index.html` loads `<script>` tags in order and every top-level name is a global. A file may only use *at load time* what's above it.
- Order: `lib/*` → `config` → `clock` → `song` → `mixer` → `music` → `instruments` → `midi-music` → `drum` → `game/layout`, `dance`, `bowling` → `scenes/*` → `input` → `main`. New file: add a `<script>` tag in the right place.
- Libraries are vendored in `lib/`: PixiJS 8.22.0 (`PIXI`), Tone.js 15.1.22 (`Tone`), @tonejs/midi 2.0.28 (`Midi`).
- Run through `start-server.command`; `file://` blocks loading MIDI, images and JSON.
- Everything is laid out at 1280×720 (`CONFIG.WIDTH/HEIGHT`) in `Scenes.stage`, which `main.js` letterboxes to the window.

## 3. Timing

> **Never animate anything musical with frame time. Compute it from `Clock.beat()`.**

| `Clock.` | Gives you |
|---|---|
| `beat()` | Song position in beats as heard from the speakers (output latency included). Frozen while paused. |
| `beatOfEvent(e, offsetMs?)` | Beat a key event happened on, from `e.timeStamp`, plus the calibration offset (`Settings.inputOffsetMs` unless given; calibration passes 0). |
| `beatAtTime(t)`, `timeAfter(t, beats)` | Beat at an audio time; audio time `beats` later, following tempo changes on the curve. |
| `atBeat(beat, cb)` | Run `cb(audioTime)` on the audio scheduler at an exact beat. |
| `bpm()`, `beatsToMs(b)` | Current tempo; beats → ms. |
| `reset(bpm)`, `start(time?)`, `running` | Stop/rewind the Transport and clear everything on it; start it. |
| `nextBar()`, `nextHalfBar()` | Audio time of the next unscheduled bar / half-bar line. |
| `pause()`, `resume()` | Suspend the AudioContext: music, sounds and animations freeze together. |

Beats come from Transport ticks, so a note at beat 37 stays at beat 37 whatever the tempo does.

Rules:
1. Positions from `noteBeat − beat`; one-shot animations from the beat they started on.
2. Sounds tied to the music: `Clock.atBeat` or a Transport callback's `time`. Never `Tone.now()`.
3. Sounds triggered by the player: `Tone.immediate()`.
4. Tempo changes: `Clock.transport.bpm.setValueAtTime` before the bar they fall in is scheduled (see `tempoRamp` in `bowling.js`).
5. Sprite frames are picked from the beat (see `Drum.update`), not `AnimatedSprite`'s timer.

## 4. Where things live

| File | What's there |
|---|---|
| `config.js` | Every tunable number (`CONFIG`) and the MIDI clip list (`MUSIC`). |
| `clock.js` | The music clock (section 3). Creates its own `AudioContext`, so all Tone nodes come after `Clock.init()`. `nextStart(holder, time)` keeps a synth's start times increasing. |
| `song.js` | `Song.phaseAt(beat)` → `{name, cycle, startBeat, endBeat, progress}`; `phaseStart`, `phaseBeats`; `extendBowl` (the bowling loop); `clamp01`, `ease`, `lerp`. |
| `mixer.js` | `MIX` levels (dB) and the routing: instrument channels → `drums` / `nodrums` → `all` (compressed, ducked by `sfx`) → music volume → lowpass/fade → master → 150 Hz low cut → limiter. Reverb and delay→distortion sends on every channel. `Mixer.in[name]` is what sounds connect to; `setVolume` (player sliders), `setSendCC` (CC send scaling), `setDuck` (the dance sidechain, `nodrums`, deepens by `DUCK_DB_PER_ROUND` each round), `lowpassSweep`/`fadeOut`/`unfade` (game over). |
| `music.js` | SFX and the calibration metronome. Bowling cues (`cue(name, time, voice)`) are placeholder synths named after their future samples; voice lines (`vo_strike`, `vo_multistrike`) load numbered takes from `assets/sfx/`. |
| `midi-music.js` | Loads every `MUSIC` clip at once (`load`), picks instruments, plays them each half bar (`_bar`), `barNotes` (also the dance chart's source), `playLane` (the player's hits, on their own kit), `playIntro`. |
| `instruments.js` | The five instruments (`INSTRUMENTS`), CC handling (`cutoffCC`, `sendCC`, `CC_DEFAULTS`), the drum/perc kits (`DRUM_MAP`, `PERC_MAP`). |
| `drum.js` | `Drum`: sprite poses, squish level, bounce, spin, misses → `DrumStick` strike. |
| `game/layout.js` | `Layout.state(phase)` (transition choreography: `spread`, `clef` (the invisible pin machine's route; pins drop as it passes), `bowlUI`), all geometry (lanes, hit line, pin spots, clef path, `circleAt` for taps), `StaffView` drawing. |
| `game/dance.js` | Charts from the dance drums clip (`generateChart`), letters (`makeLetter`, `placeLetter`), judging, holds (`markHoldStarts`, `_insideRun`), misses. |
| `game/bowling.js` | Aim, throw, ball path with bumpers, precomputed pin physics (`_roll`), strikes, pin count, tempo ramps (`tempoRamp`, `cancelTempoRamps`). `throw` returns the new tempo and its ramp. |
| `scenes/game.js` | `GameScene`, the conductor: phase changes, the bowling loop (`_scheduleBowlCheck`), throws, squish tempo, `ramps` (every tempo ramp, for the BPM readout), HUD (party clock, BPM, miss bars, count-off), game over. |
| `scenes/menu.js`, `settings.js`, `pause.js` | `makeText` (text in the game's font), `makeButton` (PAUSE, BACK), `Menu` (option/slider list), `Settings` (incl. the calibration offset; `touch`, set at load from `(pointer: coarse)`; kept until the page reloads; key binding), `SettingsPanel`, `AudioPreview`, `PauseMenu`. |
| `scenes/title.js`, `calibrate.js`, `gameover.js` | The other screens. |
| `input.js` | One `keydown` listener: unlocks audio, `[` / `]` nudge calibration, then `Scenes.current.onKey(e, Clock.beatOfEvent(e))`. With `Settings.touch`: `onTap(e, stagePoint, beat)` on pointerdown, `onTapUp(e)` on pointerup/cancel, `onHide()` when the tab is hidden. |
| `main.js` | Boot (audio and images load in parallel), `Scenes.go`, spritesheet loading, the ticker. |

Every scene has `view`, `enter(data)`, `exit()`, `update()`, `onKey(e, beat)` and optionally `onKeyUp(e)`, `onTap`, `onTapUp`, `onHide`.

## 5. Recipes

- **Tuning** (difficulty windows, misses per stick hit and `MISSES_FROM_ROUND`, speeds, ball size, squish rules, tempo steps): `config.js`, plus the constants at the top of `bowling.js` and `layout.js`.
- **Drum art:** one atlas, `assets/drums/drum.json` (animations `pose1`, `pose2`, `pose3`, 4 frames each; `meta.scale` sets the resolution), shared by `drum0.png` … `drum3.png`, one per game drum. Loaded in `main.js`. The pose loops once per beat (every 2 beats in `bowl`); each hit moves to the next pose. Anchor and scale: `Drum.useSpritesheet`, `Layout.drums.scale`.
- **Pin art:** `assets/environment/bowlingpin.json` (`bowlingpin.png`, 4 frames of 384×384, `meta.scale` 3) with `standing` (frame 1) and `fallen` (frames 2–4, cycled as a knocked pin rolls); placeholders if it fails to load.
- **Song form:** bar counts in `CONFIG.PHASES` (multiples of 0.5). The names `dance`, `toBowl`, `bowl`, `toDance` are used in `Layout.state`, `GameScene`, `DanceMode._activeCycles`, `BowlingMode.update` and as `MUSIC` sections; search before renaming.
- **Charts:** edit the dance drums clip, or replace `generateChart` (returns `[{beat, lane, state: "pending"}]` on absolute beats).
- **Choreography:** the numbers in `Layout.state`; line ends in `lineTop`/`lineBottom`.
- **Scoring:** stray presses → `if (!best) return;` in `DanceMode.press`; bowling results → what `BowlingMode.throw` returns, in `GameScene._throw`.
- **Controls:** defaults in `CONFIG.LANE_KEYS`; allowed keys in `Settings.bindable`; game keys in `GameScene.onKey`; taps in `GameScene.onTap` (hit circles via `Layout.circleAt`).
- **Touch screens:** `Settings.touch` swaps letters for dots (`makeLetter`), the bowl hint (`BOWL_HINT_WORDS_TOUCH`), the calibration hint, and hides CONTROLS. Buttons and menus stay Pixi's; scene taps ignore the PAUSE button.
- **New scene:** class with the methods above, `<script>` before `input.js`, register in `Scenes.list` (`main.js`).
- **Sounds:** instruments in `instruments.js`; mix in `MIX`; SFX in `music.js`.

## 6. Music from your DAW

The music is cut into sections matching the game: **intro** (title, settings, first calibration), **countoff**, **dance**, **toBowl**, **bowl**, **toDance**. Every half bar the game plays the next half bar of the current section's clips at the game's tempo, so the music follows the bowling loop and every tempo change.

### Exporting
1. Compose in 4/4. The file's tempo is ignored; only note positions (ticks) matter.
2. Each clip is a whole number of bars, starting exactly on bar 1 (no lead-in):

   | Section | Plays for | Clip length |
   |---|---|---|
   | `intro` | until the game starts, looped | any; starts on the first key/click |
   | `countoff` | `COUNTOFF_BARS` (2) | 1 or 2 bars; a click plays on every beat on top |
   | `dance` | 8 bars per round | 8, or a multiple (the next 8 bars play each round) |
   | `toBowl` | 1.5 bars (4/4 + 2/4) | 1 or 2 bars; the 2/4 bar plays the first half of the next bar |
   | `bowl` | 1 bar, repeated until bowling is done | 1 bar (longer clips continue bar by bar) |
   | `toDance` | 2 bars | 2 bars |

   Lengths come from `CONFIG.PHASES`.
3. Save into `assets/music/`, list the files under their section and round in `MUSIC` (`config.js`), and refresh. On a local `http://` server clips are always re-fetched (`?t=`), so re-exports show up at once; online they're cached.

- **Layers:** a round can list several files; they play together and **each loops at its own length** (keep lengths like 1, 2, 4, 8, 16 so they realign). Longer layers carry on next round.
- **Clip length** comes from the DAW's end-of-clip marker, or the last note. Force it with `{ file: "x.mid", bars: 4 }`.
- **Versions per round:** each section in `MUSIC` is a list of rounds, each a list of files (`dance: [[round 1 files], [round 2 files], …]`). After the last round it wraps to the first. File names are free, but ending them in `-instrument.mid` picks the instrument.

### Which instrument plays a track
Five instruments: **drums**, **perc**, **bass**, **melody**, **chords**. In order:
1. `{ file, instrument: "melody" }` in `MUSIC`
2. The track name, if it's an instrument name or ends in `-instrument`
3. The file name, if it ends in `-instrument.mid`
4. MIDI channel 10 → drums
5. Otherwise melody

drums and perc use General MIDI note numbers; a note from the other map is passed across, so one combined drum track works. Other notes are ignored.

| drums | Note | perc | Note |
|---|---|---|---|
| kick | 36 | rim | 37 |
| snare | 38 | clap | 39 |
| low tom | 41 | closed hat | 42 |
| high tom | 45 | open hat (choked by closed) | 46 |
| | | crash | 49 |
| | | ride | 51 |
| | | tambourine | 54 |
| | | cowbell | 56 |
| | | shaker | 82 |

### Controllers
- Velocity is used.
- **CC1** (mod wheel) on bass, melody or chords sweeps its lowpass (50 Hz–20 kHz). Default 95.
- **CC2** on melody or chords scales its delay+distortion send. Default 0.
- **CC3** on any track scales its instrument's reverb send. Default 0.
- Sends: 0 = off, 127 = the channel's `MIX` level. The last value sticks until the next event; a track without that CC starts at the default.

### Things to know
- **Dance drums are the chart:** in a dance clip's drums track, low tom (41), kick (36), snare (38) and high tom (45) become the four lanes and aren't auto-played. Notes ≤ ½ beat apart in a lane form a run that can be held.
- **Extra auto-played drums in dance:** put them on the perc track; perc passes them to the drums kit.
- **Nothing before the downbeat:** a pickup goes at the end of the previous section's clip (remember `bowl` repeats, and its last bar may be cut to 2/4).
- Notes may ring past the bar line.
- **Checking what loaded:** the browser console lists each section, its length and track → instrument mapping, and any missing files.

## 7. Gotchas

- **Create Tone nodes only after `Clock.init()`.**
- **Tone throws if one synth starts twice at the same instant,** and clamps past start times to now. Coinciding sounds need separate synths, `nextStart` (`clock.js`) or `_once` (`music.js`).
- **`Clock.reset()` cancels everything on the Transport,** including the music loop; call `MidiMusic.start()` again after.
- **Pixi reuses event objects:** read `e.global` immediately, never after an `await`.
- **`Clock.beat()` is frozen while paused** and 0 before audio starts.
- **The bowling loop decides 1/8 beat before each bar line** whether to repeat the bar, so a throw at the last instant may cost one more bar.
- **Charts use absolute beats:** never build a future cycle's chart before its start is final (`_activeCycles`).
- **Browsers block audio until a user gesture;** `Input` unlocks it on every key/click. `Clock.unlock` also sets `navigator.audioSession.type = "playback"` so iPhones play on silent (and pause other apps' audio).
- **Settings aren't saved:** a reload starts with the defaults in `config.js`.
