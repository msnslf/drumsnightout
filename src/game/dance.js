// Dancing: letters come down the lanes, placed from the beat each frame.

// A dance segment's notes, from the lane notes of that round's drums clip.
function generateChart(cycle) {
  const bpb = CONFIG.BEATS_PER_BAR;
  const start = Song.phaseStart(cycle, "dance");
  const notes = [];
  for (let bar = 0; bar < Song.phaseBeats("dance", cycle) / bpb; bar++) {
    for (const n of MidiMusic.barNotes("dance", cycle, bar)) {
      if (n.lane === undefined) continue;
      notes.push({ beat: start + bar * bpb + n.offset, lane: n.lane, velocity: n.velocity, state: "pending", view: null });
    }
  }
  markHoldStarts(notes);
  return notes;
}

// Flags the first note of each same-lane run of notes ≤ ½ beat apart.
function markHoldStarts(notes) {
  const prev = [];
  for (const n of [...notes].sort((a, b) => a.beat - b.beat)) {
    const p = prev[n.lane];
    if (p && n.beat - p.beat <= 0.5 + 1e-6) {
      if (!p.inRun) p.holdStart = true;
      p.inRun = n.inRun = true;
    }
    prev[n.lane] = n;
  }
}

// "(hold)" label shown just left of a run's first letter.
function makeHoldLabel() {
  const t = new PIXI.Text({ text: "(hold)", style: { fontFamily: CONFIG.FONT, fontSize: 16 * CONFIG.HIT_CUE_SCALE, fontWeight: "bold", fill: CONFIG.INK } });
  t.anchor.set(1, 0.5);
  return t;
}

// The lane's key letter, drawn at hit-line size so shrinking keeps it sharp.
function makeLetter(lane) {
  const t = new PIXI.Text({ text: Settings.keys[lane].toUpperCase(), style: { fontFamily: CONFIG.FONT, fontSize: 34 * CONFIG.HIT_CUE_SCALE, fontWeight: "900", fill: CONFIG.INK } });
  t.anchor.set(0.5);
  return t;
}

// Places a letter `ahead` beats before its note; false when out of view.
function placeLetter(view, lane, ahead, spread) {
  if (ahead > CONFIG.PATTERN_LOOKAHEAD_BEATS + 1 || ahead <= 0) return false; // the extra beat slides in under the mask
  const s = Layout.beatS(ahead);
  const scale = lerp(1, Layout.danceTopWidth, s); // follows the lane width
  const p = Layout.lanePoint(lane, s, spread);
  view.position.set(p.x, p.y);
  view.scale.set(scale);
  return true;
}

const JUDGE_POP = 0.3; // extra scale when judgement text first appears

class DanceMode {
  constructor(drums) {
    this.drums = drums;
    this.view = new PIXI.Container();
    this.view.mask = this.view.addChild(Layout.danceClip());
    this.charts = new Map(); // cycle -> notes
    this.windowMs = 90;

    this.judges = [0, 1, 2, 3].map((lane) => {
      const text = new PIXI.Text({ text: "", style: { fontFamily: CONFIG.FONT, fontSize: Layout.hitRadius * 0.26, fontWeight: "bold", fill: CONFIG.INK, align: "center" } });
      text.anchor.set(0.5);
      text.position.set(Layout.drumX(lane), Layout.hitY); // inside the hit circle
      this.view.addChild(text);
      return { text, beat: -Infinity, fit: 1 };
    });
    this.held = [false, false, false, false]; // lane key still down since a hit: it keeps hitting that lane's notes
  }

  // Shows the current key bindings on letters already made.
  relabel() {
    for (const notes of this.charts.values()) for (const n of notes) if (n.view) n.view.text = Settings.keys[n.lane].toUpperCase();
  }

  reset(windowMs) {
    this.windowMs = windowMs;
    for (const notes of this.charts.values()) for (const n of notes) n.view?.destroy(), n.holdView?.destroy();
    this.charts.clear();
    for (const j of this.judges) j.beat = j.until = -Infinity;
    this.held.fill(false);
  }

  chart(cycle) {
    if (cycle < 0) return [];
    if (!this.charts.has(cycle)) {
      const notes = generateChart(cycle);
      for (const n of notes) {
        n.view = makeLetter(n.lane);
        this.view.addChild(n.view);
        if (n.holdStart) n.holdView = this.view.addChild(makeHoldLabel());
      }
      this.charts.set(cycle, notes);
    }
    return this.charts.get(cycle);
  }

  // Called when a dance segment begins.
  startSegment(cycle) {
    for (const d of this.drums) d.misses = 0; // miss count is per segment; squish level persists
    // Free charts we're done with.
    for (const [c, notes] of this.charts) {
      if (c < cycle) {
        for (const n of notes) n.view.destroy(), n.holdView?.destroy();
        this.charts.delete(c);
      }
    }
  }

  // t = how far the staff has spread into lanes (0 = staff, 1 = lanes)
  update(beat, phase, t) {
    const windowBeats = this.windowMs / Clock.beatsToMs(1);
    if (phase.name !== "dance" && phase.name !== "countoff") this.held.fill(false);
    for (const c of this._activeCycles(phase)) {
      for (const n of this.chart(c)) {
        if (n.state === "pending" && this.held[n.lane] && n.beat - beat <= windowBeats) this._hit(n, beat);
        // Miss detection: note is past the end of its window and was never hit.
        if (n.state === "pending" && beat > n.beat + windowBeats) {
          n.state = "miss";
          const drum = this.drums[n.lane];
          if (!drum.isPancake) drum.miss(beat);
          this._judge(n, "miss", beat);
        }
        const show = n.state === "pending" && t < 1 && placeLetter(n.view, n.lane, n.beat - beat, t);
        n.view.visible = show;
        if (show) n.view.alpha = 1 - t;
        if (n.holdView) this._placeHold(n, show, n.beat - beat, t);
      }
    }
    // Judgement text pops in its lane's hit circle and stays until `until`.
    for (const j of this.judges) {
      const age = beat - j.beat;
      j.text.visible = beat < j.until && t < 1;
      j.text.scale.set(j.fit * (1 + JUDGE_POP * Math.max(0, 1 - age * 4)));
    }
  }

  // A lane key was pressed at song position `beat`.
  press(lane, beat, phase) {
    const windowBeats = this.windowMs / Clock.beatsToMs(1);
    let best = null;
    for (const c of this._activeCycles(phase)) {
      for (const n of this.chart(c)) {
        if (n.lane !== lane || n.state !== "pending") continue;
        const d = Math.abs(n.beat - beat);
        if (d <= windowBeats && (!best || d < Math.abs(best.beat - beat))) best = n;
      }
    }
    // Early hits sound exactly on the note; late or stray ones sound now.
    const early = best && best.beat > beat ? Clock.beatsToMs(best.beat - beat) / 1000 : 0;
    MidiMusic.playLane(lane, Tone.immediate() + early, best?.velocity);
    this.held[lane] = !!best;
    if (!best) return; // stray press: no penalty for now (TBD)
    best.state = "hit";
    this.drums[lane].dance();
    const deltaMs = Clock.beatsToMs(beat - best.beat);
    this._judge(best, Math.abs(deltaMs) < this.windowMs * 0.4 ? "perfect" : "good", beat);
  }

  release(lane) {
    this.held[lane] = false;
  }

  // A held key reaching note `n`: it sounds and counts exactly on its beat.
  _hit(n, beat) {
    n.state = "hit";
    MidiMusic.playLane(n.lane, Tone.immediate() + Math.max(0, Clock.beatsToMs(n.beat - beat) / 1000), n.velocity);
    this.drums[n.lane].dance();
    this._judge(n, "perfect", n.beat);
  }

  // Charts in play; the next one is only made once its start beat is final.
  _activeCycles(phase) {
    if (phase.name === "countoff") return [0];
    if (phase.name === "toDance") return [phase.cycle, phase.cycle + 1];
    return [phase.cycle];
  }

  // Sits left of its letter, fading out between the 2 and 1.5 beat markers.
  _placeHold(n, show, ahead, t) {
    const fade = Math.min(1, Math.max(0, (ahead - 1.5) / 0.5));
    n.holdView.visible = show && fade > 0;
    if (!n.holdView.visible) return;
    n.holdView.position.set(n.view.x - n.view.width / 2 - 4 * n.view.scale.x, n.view.y);
    n.holdView.scale.set(n.view.scale.x);
    n.holdView.alpha = fade * (1 - t);
  }

  // kind: "miss" | "good" | "perfect"
  _judge(note, kind, beat) {
    const words = CONFIG.JUDGE_WORDS[kind], j = this.judges[note.lane];
    this._fitText(j, words[Math.floor(Math.random() * words.length)]);
    j.beat = beat;
    j.until = beat + (this._nextGap(note) <= 1 ? CONFIG.JUDGE_SHORT_BEATS : CONFIG.JUDGE_HOLD_BEATS);
  }

  // Sets the word, wrapping and/or shrinking it to fit its circle mid-pop.
  _fitText(j, word) {
    const r = Layout.hitRadius - Layout.hitHalf - 4;
    const fitFor = (text) => {
      j.text.text = text;
      const b = j.text.getLocalBounds();
      return Math.min(1, (2 * r) / ((1 + JUDGE_POP) * Math.hypot(b.width, b.height))); // box diagonal within the circle
    };
    const spaces = [...word].flatMap((c, i) => (c === " " ? [i] : []));
    const mid = spaces.sort((a, b) => Math.abs(a - word.length / 2) - Math.abs(b - word.length / 2))[0]; // most even split
    const one = fitFor(word), two = mid === undefined ? 0 : fitFor(word.slice(0, mid) + "\n" + word.slice(mid + 1));
    j.fit = two > one ? two : fitFor(word);
  }

  // Beats from `note` to the next note in its lane.
  _nextGap(note) {
    let gap = Infinity;
    for (const notes of this.charts.values())
      for (const n of notes) if (n.lane === note.lane && n.beat > note.beat) gap = Math.min(gap, n.beat - note.beat);
    return gap;
  }
}
