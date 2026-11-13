# Pizza Jam — Drums' Night Out

Four drums go out dancing and bowling. Plain JavaScript with [PixiJS](https://pixijs.com) (graphics) and [Tone.js](https://tonejs.github.io) (music). No build step.

## Run

**Double-click `start-server.command`.** It serves the folder and opens the game in your browser (keep its window open while you play). Edit code or re-export MIDI, then refresh the page.

A server is needed because browsers won't let a double-clicked page load files like MIDI clips and images. If you just double-click `index.html`, the game still runs but without music.
(If the script says Python is missing, run `xcode-select --install` in Terminal once, or use VS Code's "Live Server" extension.)

Title: PLAY (comic, then the game) or SETTINGS (difficulty and starting tempo, audio mix with music/sfx sliders (sfx includes the voice lines), dance keys; saved in your browser). Menus: arrow keys + Enter, or the mouse.
Keys: D F J K to dance (one per lane, left to right; change them in SETTINGS → CONTROLS), any key to bowl (freezes all four aims; the drums then bowl one per half note), P (or PAUSE, top right) to pause (RESUME / SETTINGS / QUIT), Esc back to the title.
Intro: any key/click turns the page, SKIP, S or Esc jumps straight to the game, P or PAUSE pauses (same pause menu as in the game). Game over: the pancake zooms in with REPLAY beside it.
Bowling loops bar by bar until everyone has bowled. Standing pins are counted and raise the tempo before dancing resumes. A drum's second stick squish raises it 5 BPM.
Calibration: pick SETTINGS → DIFFICULTY → CALIBRATE (on the title screen, or in the pause menu, which ends the current game) and tap along to 16 quarter notes; the offset is saved in your browser.
`[` / `]` nudge the input offset by 5 ms.

**Changing things? Start with [`GUIDE.md`](GUIDE.md)**, a map of how and where everything is implemented, with recipes for common changes.

## How timing works (read this first)

**One clock rules everything.** `Clock.beat()` returns the song position, in beats, *as currently heard from the speakers* (it uses the audio context's output timestamp, so output latency is accounted for). Every frame, the game asks for that one number and draws everything as a function of it:

- letter position = perspective projection of (noteBeat − beat) down its lane
- drum bounce, dance poses, the aim arrows, the ball's roll, the drumstick fall: all functions of `beat`
- which part of the game we're in: `Song.phaseAt(beat)`

Nothing keeps its own timer, so nothing can drift. Pause suspends the audio clock itself, so everything freezes and resumes together. Rules to keep it that way:

1. **Never animate with `ticker.deltaTime`** for anything musical. Compute it from `beat`.
2. **Judge key presses with `Clock.beatOfEvent(e)`**, the beat the key was actually pressed on (from the event timestamp), not the beat of the frame that processes it.
3. **Schedule sounds at musical positions** with `Clock.atBeat(beat, time => synth.trigger…(…, time))`. That's sample-accurate. Player-triggered sounds use `Tone.immediate()`.
4. **Tempo changes go through the Transport** (`bpm.setValueAtTime` at a beat). Beats are counted in Transport ticks, so notes stay on their beat when the tempo changes.
5. **Spritesheet frames are picked from the beat** (see `src/drum.js`). Don't use `AnimatedSprite`'s own timer.

## Files

| File | What it does |
|---|---|
| `src/config.js` | All tunable numbers (BPM, song form, difficulty windows, ball size, …) and the comic text |
| `src/clock.js` | The music clock: beat now, beat of a key press, schedule at a beat |
| `src/song.js` | Song form: which phase (countoff/dance/toBowl/bowl/toDance) a beat is in, including bowling bars repeated while waiting for a throw; easing helpers |
| `src/music.js` | Sound effects (incl. placeholder bowling cues) and the calibration metronome |
| `src/midi-music.js` | Loads your MIDI clips and plays them bar by bar in time with the game |
| `src/instruments.js` | Which sound plays each MIDI track; the GM drum kit |
| `src/drum.js` | Drum character (spritesheet), squish levels, the drumstick |
| `src/game/layout.js` | Screen layout, plus the beat-by-beat choreography of the transition bars (converging lanes straightening into bowling lanes, the clef darting to each pin spot as the pin machine) |
| `src/game/dance.js` | Note charts, key letters coming down the lanes, hit/miss judging |
| `src/game/bowling.js` | Aim, turn-by-turn throws, ball path with bumpers, pins, STRIKE/MULTISTRIKE, pin count and tempo ramp |
| `src/scenes/*.js` | Title, settings panel, shared menu list, pause menu, comic intro, calibration, game, game over panel |
| `src/input.js` | Keyboard → scenes (stamped with beat) |
| `src/main.js` | Boot, scaling, scene switching |

## Music from your DAW

Export MIDI per song section into `assets/music/` and list the files under `MUSIC` in `src/config.js`. Sections: `intro` (title and comic pages), `countoff`, `dance`, `toBowl`, `bowl`, `toDance`. Name tracks after the five instruments: `drums`, `perc` (hats/cymbals/shaker), `bass`, `melody`, `chords`. The dance drums track is the note chart (low tom/kick/snare/high tom → D F J K), and `dance2-….mid` etc. give each round its own version. Full details, including export settings and how clips loop, are in [GUIDE.md → Music from your DAW](GUIDE.md#8-music-from-your-daw). The included clips are the placeholder groove; import them into your DAW as a starting template.

## Spritesheets

Put them in `assets/drums/`. Expected animations: `idle` (loops once per beat), `dance` (plays over half a beat after a hit), `squish` (while the stick is down). Hook them up in `src/main.js` (see the TODO). Details at the top of `src/drum.js`.

Pins: `assets/pins/pin.json` + `.png` with animations `standing` (1 frame) and `fallen` (4 frames). Loaded in `src/main.js` if present; placeholder pins otherwise.

## Open TODOs / TBDs

- Squishes to pancake (3), BPM per standing pin (0.1), ball shrink rate: all in `config.js`
- Stray key presses during dancing aren't penalised yet
- Instruments are simple synths; swap in samples (`Tone.Sampler`, see `src/instruments.js`)
- Comic panels have placeholder art
- Bowling sounds (`sfx_*`) are placeholder synths in `src/music.js`; the strike voice lines are samples in `assets/sfx/`
