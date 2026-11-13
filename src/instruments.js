// The instruments that play MIDI tracks (track matching: GUIDE.md §8).

const DEFAULT_INSTRUMENT = "melody";

const INSTRUMENTS = {
  drums: (out) => new DrumKit(out),
  perc: (out) => new PercKit(out),

  bass: (out) => {
    const { filter, cc } = cutoffCC(out);
    const synth = new Tone.AMSynth({
      detune: 0,
      portamento: 0,
      harmonicity: 3.5,
      oscillator: { type: "fatsawtooth", count: 3, spread: 48, phase: 0 },
      envelope: { attack: 0.01, attackCurve: "linear", decay: 0.2, decayCurve: "exponential", sustain: 1, release: 0.05, releaseCurve: "exponential" },
      modulation: { type: "square5", phase: 0 },
      modulationEnvelope: { attack: 0.5, attackCurve: "linear", decay: 0.01, decayCurve: "exponential", sustain: 1, release: 0.5, releaseCurve: "exponential" },
    });
    return { ...melodic(synth, filter, -12, { mono: true }), cc };
  },

  melody: (out) => {
    const { filter, cc } = cutoffCC(out);
    const synth = new Tone.MonoSynth({ 
      oscillator: { type: "fatsawtooth", count: 3, spread: 48, phase: 0 }, 
      envelope: { attack: 0.01, decay: 0.01, sustain: 0.9, release: 0.5 },
      filter: {Q: 1, type: "lowpass", rolloff: -12},
      filterEnvelope: { attack: 0.001, decay: 0.5, release: 0.2, sustain: 0.1, baseFrequency: 3000, octaves: 2} 
    });
    return { ...melodic(synth, filter, -20, { mono: true }), cc: { ...cc, 2: sendCC("melody", "distortion") } };
  },

  chords: (out) => {
    const { filter, cc } = cutoffCC(out);
    const synth = new Tone.PolySynth({
      oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
      envelope: { attack: 0.05, decay: 0.05, sustain: 0.5, release: 0.01 },
    });
    return { ...melodic(synth, filter, -30), cc: { ...cc, 2: sendCC("chords", "distortion") } };
  },
};

// CC values (0–1) for tracks without that CC: cutoff 95, sends 0.
const CC_DEFAULTS = { 1: 95 / 127, 2: 0, 3: 0 };

// MIDI CC value (0–1) -> Hz on an exponential scale, so the sweep sounds even.
const ccToHz = (value, min, max) => min * (max / min) ** value;

// Lowpass into `out`, cutoff on CC1 (50 Hz–20 kHz); starts fully open.
function cutoffCC(out) {
  const filter = new Tone.Filter({ type: "lowpass", frequency: 20000, rolloff: -24, Q: 1 }).connect(out);
  return { filter, cc: { 1: (value, time) => filter.frequency.setValueAtTime(ccToHz(value, 50, 20000), time) } };
}

// Scales a channel's send by a CC: 0 = off, 127 = its MIX level.
const sendCC = (name, key) => (value, time) => Mixer.setSendCC(name, key, value, time);

// Wraps any Tone instrument with the play() interface the MIDI player uses.
function melodic(synth, out, volumeDb, { mono = false } = {}) {
  synth.volume.value = volumeDb;
  synth.connect(out);
  let last = -1;
  return {
    synth,
    play(midi, duration, time, velocity) {
      // Mono synths can't start twice at one instant (Tone throws), so nudge.
      if (mono) time = Math.max(time, synth.context.currentTime, last + 0.001);
      last = time;
      synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), duration, time, velocity);
    },
  };
}

// "Bass" or "dance-bass.mid" -> "bass"; null if it doesn't name an instrument.
function instrumentForName(name) {
  const key = (name || "").toLowerCase().replace(/\.mid$/, "").split("-").pop();
  return INSTRUMENTS[key] ? key : null;
}

// GM drum notes -> voices: DRUM_MAP (drum characters), PERC_MAP (the rest).
const DRUM_MAP = {
  36: "kick",
  38: "snare",
  41: "lowTom",
  45: "highTom",
};

const PERC_MAP = {
  37: "rim",
  39: "clap",
  42: "hatClosed",
  46: "hatOpen",
  49: "crash",
  51: "ride",
  54: "tambourine",
  56: "cowbell",
  82: "shaker",
};

class Kit {
  constructor(map, otherMap, otherName) {
    this.map = map;
    this.otherMap = otherMap;
    this.otherName = otherName;
    this.last = {};
  }

  // Sets a voice's level, output and synth trigger args [note, duration].
  static voice(node, db, dest, trigger = ["16n"]) {
    node.volume.value = db;
    node._baseDb = db;
    node._trigger = trigger;
    node.connect(dest);
    return node;
  }

  play(midi, duration, time, velocity) {
    if (!this.map[midi] && this.otherMap[midi]) {
      return MidiMusic._instrument(this.otherName).play(midi, duration, time, velocity);
    }

    const name = this.map[midi];
    if (!name) return; // unmapped notes are ignored
    time = Math.max(time, Tone.getContext().currentTime, (this.last[name] ?? -1) + 0.001); // late times get clamped to now
    this.last[name] = time;

    this.beforeHit?.(name, time);

    const s = this.voices[name];
    if (!s) return;

    // 1. Sample playback
    if (s instanceof Tone.Player) {
      if (s.loaded) {
        s.volume.setValueAtTime(s._baseDb + Tone.gainToDb(Math.max(velocity, 0.001)), time);
        s.start(time);
      }
      return;
    }

    // 2. Synth playback (spreads ["16n"] or ["C1", "8n"] cleanly)
    s.triggerAttackRelease(...s._trigger, time, velocity);
  }
}

class DrumKit extends Kit {
  constructor(out) {
    super(DRUM_MAP, PERC_MAP, "perc");
    const v = (node, db, trigger) => Kit.voice(node, db, out, trigger);

    this.voices = {
      kick: v(new Tone.Player("../assets/music/samples/kick.wav"), -10, out),
      snare: v(new Tone.Player("../assets/music/samples/snare.wav"), -10, out),
      lowTom: v(new Tone.Player("../assets/music/samples/tomLow.wav"), -10, out),
      highTom: v(new Tone.Player("../assets/music/samples/tomHigh.wav"), -10, out)
    };
  }
}

class PercKit extends Kit {
  constructor(out) {
    super(PERC_MAP, DRUM_MAP, "drums");
    const hp = new Tone.Filter(7000, "highpass").connect(out);
    const v = (node, db, dest = hp, trigger) => Kit.voice(node, db, dest, trigger);

    this.voices = {
      rim: v(new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 1, envelope: { decay: 0.04, sustain: 0 } }), -10, out, ["A4", "32n"]),
      clap: v(new Tone.Player("../assets/music/samples/clap.wav"), -10, out),
      hatClosed: v(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }), -14),
      hatOpen: v(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.25, sustain: 0 } }), -16),
      crash: v(new Tone.Player("../assets/music/samples/crash.wav"), -10, out),
      ride: v(new Tone.Player("../assets/music/samples/ride.wav"), -10, out),
      shaker: v(new Tone.Player("../assets/music/samples/shaker.wav"), -10, out),
      tambourine: v(new Tone.Player("../assets/music/samples/tamb.wav"), -10, out),
      cowbell: v(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }), -22, out, [800, "16n"]),
    };
  }

  beforeHit(name, time) {
    if (name === "hatClosed") this.voices.hatOpen.triggerRelease(time);
  }
}
