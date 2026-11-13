# Pizza Jam — Drums' Night Out

Four drums go out dancing and bowling. Plain JavaScript with [PixiJS](https://pixijs.com) (graphics) and [Tone.js](https://tonejs.github.io) (music). No build step.

## Run

**Double-click `start-server.command`.** It serves the folder and opens the game in your browser (keep its window open while you play). Edit code or re-export MIDI, then refresh the page.

A server is needed because browsers won't let a double-clicked page load MIDI clips and images; opened directly, `index.html` runs without music.
To play on a phone, open `http://<your Mac's local IP>:8000` on the same Wi-Fi.
(If the script says Python is missing, run `xcode-select --install` in Terminal once, or use VS Code's "Live Server" extension.)

## Play

- **Menus:** arrow keys + Enter, or the mouse. Title: PLAY (comic, then the game) or SETTINGS (difficulty, starting tempo, calibration, music/sfx volume, dance keys; reset when the page reloads).
- **Comic:** any key or click turns the page; SKIP, S or Esc starts the game.
- **Dance:** D F J K, one per lane (rebind in SETTINGS → CONTROLS). Hold a key through a run of notes.
- **Bowl:** any key freezes all four aims; the drums bowl one per half note. Standing pins raise the tempo.
- **Touch screens** (detected at load): tap a hit circle to dance (hold a finger through a run), tap anywhere to bowl. Dots replace the key letters and CONTROLS is hidden.
- **Pause:** P or PAUSE (RESUME / SETTINGS / QUIT). **Esc** goes back to the title.
- **Calibrate:** SETTINGS → DIFFICULTY → CALIBRATE, then tap along to 16 quarter notes (from the pause menu this ends the game). `[` / `]` nudge the offset by 5 ms.

## Changing things

Start with [`GUIDE.md`](GUIDE.md): where everything lives, the timing rule, recipes, and how to export music from your DAW (section 6) and add art (section 5).

## Open TODOs / TBDs

- Squishes to pancake (3), BPM per standing pin (0.4), ball shrink rate: all in `config.js`
- Stray key presses during dancing aren't penalised yet
- Instruments are simple synths; swap in samples (`Tone.Sampler`, see `src/instruments.js`)
- Comic panels have no art yet
- Bowling sounds (`sfx_*`) are placeholder synths in `src/music.js`; the strike voice lines are samples in `assets/sfx/`
