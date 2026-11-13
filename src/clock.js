// The music clock: song position in beats, as heard. Animate from this only.

const Clock = {
  ctx: null, // native AudioContext
  transport: null,
  paused: false,
  running: false, // started since the last reset
  _lastBeat: 0,

  init() {
    // Own native context (for output timestamps); make Tone nodes after this.
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    Tone.setContext(this.ctx);
    this.transport = Tone.getTransport();
    this.transport.timeSignature = CONFIG.BEATS_PER_BAR;
  },

  // Must be called from a user gesture (browser autoplay rules).
  unlock() {
    if (navigator.audioSession) navigator.audioSession.type = "playback"; // iOS: play even with the ringer on silent
    if (this.paused) return Promise.resolve();
    return Tone.start();
  },

  // Suspending the context freezes music, scheduled sounds and animations.
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.ctx.suspend();
  },
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ctx.resume();
  },

  // Audio time leaving the speakers at performance time `perfMs`.
  audibleTimeAt(perfMs) {
    const ctx = this.ctx;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.performanceTime > 0) {
        return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      }
    }
    // Fallback (e.g. Safari): estimate with the reported latencies.
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return ctx.currentTime - latency - (performance.now() - perfMs) / 1000;
  },

  // Song position (in beats) of a given audio-context time.
  beatAtTime(ctxTime) {
    // No song position before audio or the transport has started.
    if (!(ctxTime > 0) || this.transport.state === "stopped") return 0;
    return this.transport.getTicksAtTime(ctxTime) / this.transport.PPQ;
  },

  // Song position right now, as heard. Never goes backwards.
  beat() {
    if (this.paused || this.ctx.state !== "running") return this._lastBeat;
    const b = this.beatAtTime(this.audibleTimeAt(performance.now()));
    if (b > this._lastBeat) this._lastBeat = b;
    return this._lastBeat;
  },

  // Song position of a key/pointer event, with the calibration offset applied.
  beatOfEvent(e, offsetMs = Settings.inputOffsetMs) {
    return this.beatAtTime(this.audibleTimeAt(e.timeStamp + offsetMs));
  },

  bpm() {
    return this.transport.bpm.value;
  },

  beatsToMs(beats) {
    return (beats * 60000) / this.bpm();
  },

  // Run cb(audioTime) exactly at a song position (sample-accurate).
  atBeat(beat, cb) {
    return this.transport.scheduleOnce(cb, Math.round(beat * this.transport.PPQ) + "i");
  },

  // Audio time `beats` after audio time `time`, following tempo changes.
  timeAfter(time, beats) {
    return time + this.transport.bpm.getDurationOfTicks(beats * this.transport.PPQ, time);
  },

  // Stop everything and rewind.
  reset(bpm) {
    this.resume();
    const t = this.transport;
    t.stop();
    t.cancel(0);
    t.position = 0;
    t.bpm.cancelScheduledValues(0);
    t.bpm.value = bpm;
    this._lastBeat = 0;
    this.running = false;
  },

  start(time = "+0.1") {
    this.transport.start(time);
    this.running = true;
  },

  // Audio time of the next unscheduled bar line (0 if stopped).
  nextBar() {
    return this.transport.nextSubdivision("1m");
  },

  // Audio time of the next unscheduled half-bar line (beat 1 or 3).
  nextHalfBar() {
    return this.transport.nextSubdivision((CONFIG.BEATS_PER_BAR / 2) * this.transport.PPQ + "i");
  },
};

// Start time for `holder` (a synth or voice): Tone throws on two starts at one
// instant and clamps late times to now, so keep each holder's starts increasing.
// Late notes go just after now: the audio clock can tick before Tone clamps.
function nextStart(holder, time) {
  const now = Tone.getContext().currentTime + 0.001;
  return (holder._lastStart = Math.max(time, now, (holder._lastStart ?? -1) + 0.001));
}
