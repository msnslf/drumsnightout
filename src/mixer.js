// The mix: channels, sends, ducking and player volumes; MIX levels in dB.

const MIX = {
  drums: { gain: -5, reverb: -60, distortion: -60 },
  perc: { gain: 2, reverb: -60, distortion: -60 },
  bass: { gain: 8, reverb: -60, distortion: -60 },
  chords: { gain: 7, reverb: -3, distortion: -12, pan: -1 },
  melody: { gain: 0, reverb: -3, distortion: -12, pan: 1 },
  nodrums: { gain: 0, reverb: -60, distortion: -60, duck: 16 },
  all: { gain: 0, reverb: -60, distortion: -60, duck: 0, threshold: -17 },
  sfx: { gain: 0, reverb: -60, distortion: -60 },
  banter: { gain: -3, reverb: -60, distortion: -60 },
  reverb: { gain: 20 },
  distortion: { gain: 0, amount: 0.5 }, // amount: Tone.Distortion 0..1, not dB
};

// 12 dB/oct high-pass, -3 dB at `hz` (Web Audio's high-pass Q is in dB).
const lowCut = (hz) => new Tone.BiquadFilter({ type: "highpass", frequency: hz, Q: -3 });

const Mixer = {
  channels: {}, // name -> Tone.Channel
  sends: {}, // name -> { reverb, distortion } send gains
  sendCC: {}, // name -> { send key -> 0..1 } scaling from MIDI CC (see setSendCC)
  in: {}, // name -> node instruments connect to
  user: {}, // music/sfx -> Tone.Volume set by the settings sliders (banter uses sfx)
  ducks: {}, // name -> Tone.Multiply on its ducking envelope (setDuck)

  init() {
    // Called once, after Clock.init(), so every node uses our AudioContext.
    const master = new Tone.Gain().chain(lowCut(150), new Tone.Limiter(-14).toDestination());
    this.distortion = new Tone.Distortion({ distortion: MIX.distortion.amount, wet: 1 });
    this.delay = new Tone.PingPongDelay({ delayTime: (this.delayTarget = this._delayTime()), maxDelay: 2, wet: 1 });
    const fx = { reverb: [new Tone.Reverb({ decay: 3, wet: 1 })], distortion: [this.delay, this.distortion] };
    this.fade = new Tone.Gain().connect(master);
    this.lowpass = new Tone.Filter({ type: "lowpass", frequency: 20000, Q: 0.7 }).connect(this.fade);
    for (const name of Object.keys(fx)) {
      this._channel(name, this.lowpass);
      new Tone.Channel({ channelCount: 2 }).receive(name).chain(...fx[name], this.channels[name]);
    }
    this.user.music = new Tone.Volume().connect(this.lowpass);
    this.user.sfx = new Tone.Volume().connect(master);
    this._bus("all", this.user.music);
    this._bus("sfx", this.user.sfx);
    this._bus("banter", this.user.sfx);
    this.in.sfx = lowCut(300).connect(this.channels.sfx);
    this._duck("all", this.channels.sfx);
    this.compressor = new Tone.Compressor({ threshold: MIX.all.threshold }).connect(this.in.all);
    this.in.all = this.compressor;
    this._bus("drums", this.in.all);
    this._bus("nodrums", this.in.all);
    this._duck("nodrums", this.channels.drums);
    for (const name of ["perc", "bass", "chords", "melody"]) this._bus(name, this.in.nodrums);
    for (const [group, v] of Object.entries(Settings.volume)) this.setVolume(group, v);
  },

  // Fades the music and effect returns to silence from `time` over `seconds`.
  fadeOut(time, seconds) {
    this.fade.gain.setValueAtTime(1, time);
    this.fade.gain.linearRampToValueAtTime(0, time + seconds);
  },
  // Sweeps the music low pass from 20 kHz to 20 Hz between `start` and `end`.
  lowpassSweep(start, end) {
    this.lowpass.frequency.setValueAtTime(20000, start);
    this.lowpass.frequency.exponentialRampToValueAtTime(20, end);
  },
  unfade() {
    this.fade.gain.cancelScheduledValues(0);
    this.fade.gain.value = 1;
    this.lowpass.frequency.cancelScheduledValues(0);
    this.lowpass.frequency.value = 20000;
  },

  // Every frame: ping pong delay at 3/4 beat, gliding 1 s on tempo changes.
  update() {
    const t = this._delayTime();
    if (t !== this.delayTarget) this.delay.delayTime.rampTo((this.delayTarget = t), 1);
  },
  _delayTime: () => (0.75 * 60) / Clock.bpm(),

  // Player volume for music or sfx (+ banter): slider 0..1, squared.
  setVolume(group, v) {
    const db = Tone.gainToDb(v * v);
    this.user[group].volume.value = db;
    for (const [name, sends] of Object.entries(this.sends))
      if (this._group(name) === group) for (const key in sends) sends[key].gain.value = this._sendDb(name, key);
  },

  // Scales a send by a CC value (0 = off, 1 = its MIX level) at `time`.
  setSendCC(name, key, value, time) {
    (this.sendCC[name] ??= {})[key] = value;
    this.sends[name][key].gain.setValueAtTime(this._sendDb(name, key), time);
  },
  _sendDb(name, key) {
    return MIX[name][key] + this._userDb(name) + Tone.gainToDb(Math.max(this.sendCC[name]?.[key] ?? 1, 0.001));
  },

  _group: (name) => (name === "sfx" || name === "banter" ? "sfx" : "music"),
  _userDb(name) {
    return this.user[this._group(name)].volume.value;
  },

  _channel(name, dest) {
    this.in[name] = this.channels[name] = new Tone.Channel({ volume: MIX[name].gain, pan: MIX[name].pan ?? 0, channelCount: 2 }).connect(dest);
  },

  _bus(name, dest) {
    this._channel(name, dest);
    const c = this.channels[name];
    this.sends[name] = { reverb: c.send("reverb", MIX[name].reverb), distortion: c.send("distortion", MIX[name].distortion) };
  },

  // Sets how deep `name` is ducked (dB, like MIX[name].duck).
  setDuck(name, db) {
    this.ducks[name].factor.value = Tone.dbToGain(db);
  },

  // Gain in front of `name` that dips with `source`'s envelope (x duck).
  _duck(name, source) {
    const gain = new Tone.Gain().connect(this.channels[name]);
    const amount = (this.ducks[name] = new Tone.Multiply(Tone.dbToGain(MIX[name].duck)));
    const dip = new Tone.WaveShaper((x) => 1 - Math.min(Math.max(x, 0), 1));
    source.chain(new Tone.Follower(0.1), amount, dip);
    dip.connect(gain.gain); // a signal connected to a param replaces its value
    this.in[name] = gain;
  },
};
