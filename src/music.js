// Sound effects and the calibration metronome (music is in midi-music.js).

const Music = {
  init() {
    // Called once, after Clock.init(), so every node uses our AudioContext.
    const { drums, sfx } = Mixer.in;
    this.kick = new Tone.MembraneSynth({ octaves: 6, envelope: { decay: 0.35, sustain: 0 } }).connect(drums);
    const hatFilter = new Tone.Filter(8000, "highpass").connect(drums);
    this.hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(hatFilter);
    this.hat.volume.value = -16;
    this.click = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(sfx);
    this.click.volume.value = -14;

    this.stickHits = [0, 1, 2, 3].map((i) => new Tone.Player({ url: `assets/sfx/stickgod-drum${i}.wav`, volume: -12 }).connect(sfx));
    this.revCym = new Tone.Player("assets/music/samples/revcym.wav").connect(Mixer.in.nodrums);
    this.revCym.volume.value = -12;
    this._initCues(sfx, Mixer.in.banter);
  },

  // Calibration beat: count-in clicks, then kick on every beat plus hats.
  startMetronome(countInBeats) {
    Clock.transport.scheduleRepeat((time) => {
      const beat = Math.round(Clock.beatAtTime(time) * 2) / 2;
      if (beat % 1 === 0) {
        if (beat < countInBeats) this.click.triggerAttackRelease(beat === 0 ? "C6" : "C5", "32n", time);
        else this.kick.triggerAttackRelease("C1", "8n", time);
      }
      if (beat >= countInBeats) this.hat.triggerAttackRelease("32n", time, beat % 1 ? 1 : 0.5);
    }, "8n", 0);
  },

  // Count-off click on every beat, accented on each bar's downbeat.
  countoffClicks(beats) {
    for (let b = 0; b < beats; b++) {
      Clock.atBeat(b, (time) => this.click.triggerAttackRelease(b % CONFIG.BEATS_PER_BAR ? "C5" : "C6", "32n", time));
    }
  },

  // --- Sound effects ---
  // Tone can't start a synth twice at one instant, so play each sound once.
  _once(name, time, play) {
    this._lastTimes = this._lastTimes || {};
    if (this._lastTimes[name] !== undefined && time <= this._lastTimes[name]) return;
    this._lastTimes[name] = time;
    play();
  },
  // The stick god hitting drum `index`: assets/sfx/stickgod-drum<index>.wav.
  squish(time, index) {
    const p = this.stickHits[index];
    if (p?.loaded) this._once("squish" + index, time, () => p.start(time));
  },

  // Placeholder clicks and pops named after their future samples.
  _initCues(sfx, banter) {
    const make = (Kind, opts, out, db) => {
      const s = new Kind(opts).connect(out);
      s.volume.value = db;
      return s;
    };
    // `randomizeRange: [lo, hi]` shifts each trigger by random whole semitones.
    const pitch = (note, range) => {
      if (!range) return note;
      const [lo, hi] = range;
      return Tone.Frequency(note).transpose(lo + Math.floor(Math.random() * (hi - lo + 1))).toFrequency();
    };
    const pop = (note, decay, out = sfx, db = -6, { randomizeRange } = {}) => {
      const s = make(Tone.MembraneSynth, { pitchDecay: 0.01, octaves: 4, envelope: { attack: 0.001, decay, sustain: 0 } }, out, db);
      return (time) => s.triggerAttackRelease(pitch(note, randomizeRange), "32n", nextStart(s, time));
    };
    const click = (note, db, { randomizeRange } = {}) => {
      const s = make(Tone.Synth, { oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }, sfx, db);
      return (time) => s.triggerAttackRelease(pitch(note, randomizeRange), 0.01, nextStart(s, time));
    };
    // Each sample play gets its own player, so overlaps aren't cut.
    // `semitones` shifts pitch via playback rate (so it also changes length).
    const play = (buf, out, time, semitones = 0) => {
      if (!buf) return;
      const player = new Tone.Player({ url: buf, playbackRate: 2 ** (semitones / 12) }).connect(out);
      player.onstop = () => player.dispose();
      player.start(time);
    };
    // Two different random takes of a voice line, panned hard left and right.
    const pans = [-1, 1].map((p) => new Tone.Panner(p).connect(banter));
    const pair = (name) => (time) => {
      const bufs = this.voices[name];
      if (!bufs.length) return;
      const i = Math.floor(Math.random() * bufs.length);
      const j = bufs.length > 1 ? (i + 1 + Math.floor(Math.random() * (bufs.length - 1))) % bufs.length : i;
      const shift = () => Math.floor(Math.random() * 11) - 5; // -5..+5 semitones, per voice
      [i, j].forEach((k, side) => play(bufs[k], pans[side], time, shift()));
    };
    const rollFilter = new Tone.Filter(300, "lowpass").connect(new Tone.Filter(150, "highpass").connect(sfx));
    // One roll per lane (balls overlap), panned to its lane.
    const rolls = [-1, -0.5, 0.5, 1].map((pan) => make(Tone.NoiseSynth, { noise: { type: "brown" }, envelope: { attack: 0.05, decay: 0, sustain: 1, release: 0.05 } }, new Tone.Panner(pan).connect(rollFilter), -10));
    this.cues = {
      sfx_ballRoll: (time, voice) => rolls[voice].triggerAttack(time),
      sfx_pinHitSingle: pop("G3", 0.12),
      sfx_pinCount: click("C6", -14, { randomizeRange: [-12, 12] }),
      sfx_bpmUpdate: click("G6", -23),
      sfx_bowlingMiss: (time) => play(this.samples["bowling-miss"], sfx, time),
      vo_strike: pair("strike"),
      vo_multistrike: pair("multistrike"),
    };
    this.cueStops = { sfx_ballRoll: (time, voice) => rolls[voice].triggerRelease(time) };
  },
  // `voice` picks one of a cue's synths when it overlaps itself (ballRoll).
  // Voice line takes: assets/sfx/strike1.wav, strike2.wav… up to a gap.
  voices: { strike: [], multistrike: [] },
  samples: { "bowling-miss": null }, // single files: assets/sfx/<name>.wav
  async loadSamples() {
    for (const name of Object.keys(this.samples)) {
      try {
        this.samples[name] = await Tone.ToneAudioBuffer.fromUrl(`assets/sfx/${name}.wav`);
      } catch {
        console.warn(`♪ assets/sfx/${name}.wav not loaded`);
      }
    }
    for (const name of Object.keys(this.voices)) {
      for (let n = 1; ; n++) {
        try {
          this.voices[name].push(await Tone.ToneAudioBuffer.fromUrl(`assets/sfx/${name}${n}.wav`));
        } catch {
          break;
        }
      }
      console.log(`♪ ${name}: ${this.voices[name].length} variation(s)`);
    }
  },
  // Reverse cymbal ending at `end`, starting partway in if it doesn't fit.
  revCymbal(time, end) {
    const p = this.revCym;
    if (!p.loaded) return;
    const start = end - p.buffer.duration;
    p.start(Math.max(start, time), Math.max(0, time - start));
  },
  cue(name, time, voice = 0) {
    this._once(name + voice, time, () => this.cues[name](time, voice));
  },
  stopCue(name, time, voice = 0) {
    this._once(name + voice + ":stop", time, () => this.cueStops[name](time, voice));
  },
};
