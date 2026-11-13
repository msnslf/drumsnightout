// Song form: which phase a beat is in; bowling grows bar by bar (extendBowl).

const Song = {
  extraBowlBeats: [], // per cycle: beats added to bowling (bars, maybe a final 2/4 bar)

  reset() {
    this.extraBowlBeats = [];
  },

  get countoffBeats() {
    return CONFIG.COUNTOFF_BARS * CONFIG.BEATS_PER_BAR;
  },

  // Length of a phase in beats (bowl includes its repeats in that cycle).
  phaseBeats(name, cycle) {
    let bars = CONFIG.PHASES.find((p) => p.name === name).bars;
    const extra = name === "bowl" && cycle !== undefined ? this.extraBowlBeats[cycle] || 0 : 0;
    return bars * CONFIG.BEATS_PER_BAR + extra;
  },

  cycleBeats(cycle) {
    return CONFIG.PHASES.reduce((n, p) => n + this.phaseBeats(p.name, cycle), 0);
  },

  cycleStart(cycle) {
    let start = this.countoffBeats;
    for (let c = 0; c < cycle; c++) start += this.cycleBeats(c);
    return start;
  },

  // Lengthens a cycle's bowling by a bar, or 2 beats to start toDance on 3.
  extendBowl(cycle, beats = CONFIG.BEATS_PER_BAR) {
    this.extraBowlBeats[cycle] = (this.extraBowlBeats[cycle] || 0) + beats;
  },

  // Where are we? Returns { name, cycle, startBeat, endBeat, progress (0..1) }.
  phaseAt(beat) {
    if (beat < this.countoffBeats) {
      return { name: "countoff", cycle: -1, startBeat: 0, endBeat: this.countoffBeats, progress: beat / this.countoffBeats };
    }
    let cycle = 0, start = this.countoffBeats;
    while (beat >= start + this.cycleBeats(cycle)) {
      start += this.cycleBeats(cycle);
      cycle++;
    }
    for (const p of CONFIG.PHASES) {
      const end = start + this.phaseBeats(p.name, cycle);
      if (beat < end) {
        return { name: p.name, cycle, startBeat: start, endBeat: end, progress: (beat - start) / (end - start) };
      }
      start = end;
    }
  },

  // First beat of a named phase in a given cycle.
  phaseStart(cycle, name) {
    let start = this.cycleStart(cycle);
    for (const p of CONFIG.PHASES) {
      if (p.name === name) return start;
      start += this.phaseBeats(p.name, cycle);
    }
    throw new Error("unknown phase " + name);
  },
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;
