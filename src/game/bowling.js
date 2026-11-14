// Bowling: aims swing with the beat; any key throws, one lane per half note.

const PIN_RADIUS = 9; // placeholder art; scaled by PIN_SCALE
const PIN_SCALE = 0.7; // pin size: art and hits
const PIN_FRAME_PX = 12; // distance a fallen pin travels per frame of its rolling animation
const PIN_MAX_SPIN = 0.05; // max radians a fallen pin turns per pixel it travels
const PIN_STOP_BEATS = 1.5, PIN_DECAY = 4; // a knocked pin's speed decays (rate PIN_DECAY) to 0 at PIN_STOP_BEATS
const PIN_FADE_BEATS = 2; // a stopped pin fades out over this long
const COUNT_STEP = 1 / 6; // beats between pin-count numbers
const COUNT_MOVE_BEATS = 2; // beats the total takes to slide under the tempo
const BPM_STEP = 0.1, RAMP_BEATS = 2; // tempo ramps finish in 2 beats; default step 0.1 BPM
const PIN_ANIMS = { standing: 1, fallen: 3 }; // spritesheet animation -> frame count

// Speed (1 -> 0) and distance factors of a pin `t` beats after its hit.
function pinSlow(t) {
  const u = clamp01(t / PIN_STOP_BEATS), k = PIN_DECAY, e = Math.exp(-k);
  return { speed: (Math.exp(-k * u) - e) / (1 - e), dist: (PIN_STOP_BEATS * ((1 - Math.exp(-k * u)) / k - u * e)) / (1 - e) };
}
const pinSpeed = (pin, t) => Math.hypot(pin.vx, pin.vy) * pinSlow(t).speed;
const pinPos = (pin, t) => {
  const d = pinSlow(t).dist;
  return { x: pin.x + pin.vx * d, y: pin.y + pin.vy * d };
};

let tempoRampEpoch = 0; // bumped by cancelTempoRamps; ramps from an older epoch do nothing

// Stops every tempoRamp whose steps haven't been set or cued yet.
function cancelTempoRamps() {
  tempoRampEpoch++;
}

// Steps the tempo bpm -> newBpm in `steps` equal steps (a click each) over RAMP_BEATS from rampStart.
// The curve is set `lead` beats early.
function tempoRamp(rampStart, bpm, newBpm, lead, steps = Math.ceil((newBpm - bpm) / BPM_STEP - 1e-6)) {
  const epoch = tempoRampEpoch;
  const step = (newBpm - bpm) / steps;
  const stepBeats = RAMP_BEATS / steps; // Infinity when there's nothing to ramp
  const stepBeat = (k) => rampStart + k * stepBeats;
  const setAt = rampStart - lead;
  Clock.atBeat(setAt, (time) => {
    if (epoch !== tempoRampEpoch) return;
    for (let k = 0; k < steps; k++) {
      Clock.transport.bpm.setValueAtTime(Math.min(newBpm, bpm + (k + 1) * step), Clock.timeAfter(time, stepBeat(k) - setAt));
    }
  });
  for (let k = 0; k < steps; k++) Clock.atBeat(stepBeat(k), (time) => epoch === tempoRampEpoch && Music.cue("sfx_bpmUpdate", time));
  return { rampStart, rampEnd: steps ? rampStart + RAMP_BEATS : rampStart, bpm, newBpm, steps, step, stepBeats };
}

// Tempo shown at `beat` during a tempoRamp.
function rampBpm(r, beat) {
  const k = beat < r.rampStart ? 0 : Math.min(r.steps, Math.floor((beat - r.rampStart) / r.stepBeats) + 1);
  return k ? Math.min(r.newBpm, r.bpm + k * r.step) : r.bpm;
}

// Next multiple of `step` after `from`, at or after `b` (after, if `strict`).
function nextStep(b, step, from, strict) {
  const n = from + Math.ceil((b - from) / step) * step;
  return strict && n <= b ? n + step : n;
}

class BowlingMode {
  constructor() {
    this.view = new PIXI.Container();
    this.lanesView = new PIXI.Container();
    this.pinLayer = new PIXI.Container();
    this.gfx = new PIXI.Graphics();
    this.lanesView.addChild(this.pinLayer, this.gfx);
    const clip = Layout.clip(Layout.lanes.top);
    this.view.addChild(this.lanesView, clip);
    this.lanesView.mask = clip; // balls and pins vanish into the top of the lane
    this.frames = this._placeholderFrames();

    this.banner = makeText("", 120, "900", { fill: CONFIG.PAPER, stroke: { color: CONFIG.INK, width: 14 } });
    this.banner.anchor.set(0.5);
    this.banner.position.set(CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2);

    this.hints = (Settings.touch ? CONFIG.BOWL_HINT_WORDS_TOUCH : CONFIG.BOWL_HINT_WORDS).map((word, i) => {
      const t = makeText(word, 48, "900");
      t.anchor.set(0.5);
      t.position.set(Layout.lane(i).centerX, (Layout.lanes.top + Layout.lanes.bottom) / 2);
      this.view.addChild(t);
      return t;
    });

    this.countView = new PIXI.Container(); // pin count + tempo sum; the scene puts it in its overlay
    this.tempoAnchor = { x: 0, y: 0 }; // bottom-right of the tempo readout, set by the scene

    this.reset();
  }

  reset() {
    this.round = -1;
    this.thrown = false;
    this.lanes = [];
    this.banners = [];
    this.danceBeat = Infinity; // bowling ends on this beat (Infinity until thrown)
    this.count = null;
    this.pinLayer.removeChildren().forEach((s) => s.destroy());
    this.countView.removeChildren().forEach((c) => c.destroy());
  }

  // Swap in a pin sheet: `standing` (1 frame) and `fallen` (3 frames).
  useSpritesheet(sheet) {
    for (const [name, n] of Object.entries(PIN_ANIMS)) {
      if (sheet.animations[name]?.length !== n) throw new Error(`Pin spritesheet needs "${name}" with ${n} frame(s).`);
    }
    this.frames = { standing: sheet.animations.standing, fallen: sheet.animations.fallen };
  }

  _placeholderFrames() {
    const tex = (draw) => {
      const g = draw(new PIXI.Graphics());
      const t = Scenes.app.renderer.generateTexture(g);
      g.destroy();
      return t;
    };
    const ink = CONFIG.INK, paper = CONFIG.PAPER;
    return {
      standing: [tex((g) => g.circle(0, 0, PIN_RADIUS).fill(paper).stroke({ width: 3, color: ink }))],
      fallen: [0, 1, 2, 3].map((f) => tex((g) => g.roundRect(-14, -6, 28, 12, 6).fill(paper).stroke({ width: 3, color: ink })
        .moveTo(-8 + f * 5, -6).lineTo(-8 + f * 5, 6).stroke({ width: 2, color: ink }))), // stripe shifts as it rolls
    };
  }

  // Called at the start of the transition into bowling for cycle `round`.
  prepare(round) {
    this.reset();
    this.round = round;
    const ballFrac = CONFIG.BALL_SIZES[Math.min(round, CONFIG.BALL_SIZES.length - 1)];
    this.lanes = [0, 1, 2, 3].map((i) => {
      const lane = Layout.lane(i);
      const r = lane.width * ballFrac;
      // Triangle of 6 pins at the far (top) end of the lane, point towards the drum.
      const pins = Layout.pins(i).map((p) => {
        const sprite = this.pinLayer.addChild(new PIXI.Sprite(this.frames.standing[0]));
        sprite.anchor.set(0.5);
        return { ...p, knockBeat: Infinity, countBeat: Infinity, sprite };
      });
      return { lane, r, pins, angle: 0, throwBeat: Infinity, y0: lane.bottom - r - 12, y1: lane.top - r };
    });
  }

  // BPM added per standing pin this round (rounded so 0.4 + 0.2 shows as 0.6).
  _bpmPerPin() {
    return Math.round((CONFIG.BPM_PER_STANDING_PIN + this.round * CONFIG.BPM_PER_PIN_PER_ROUND) * 100) / 100;
  }

  // Aim angle of a lane at a beat; lanes drift apart each round.
  aimAngle(i, beat) {
    const divergence = Math.min(Math.PI, this.round * CONFIG.AIM_DIVERGENCE_PER_ROUND);
    const phase = (2 * Math.PI * beat) / CONFIG.AIM_PERIOD_BEATS + i * divergence;
    return CONFIG.AIM_MAX_ANGLE * Math.sin(phase);
  }

  // Ball position at a beat, with bumper ricochets. Angle 0 = straight up.
  ballPos(L, beat) {
    const p = clamp01((beat - L.throwBeat) / CONFIG.ROLL_BEATS);
    const y = lerp(L.y0, L.y1, p);
    const a = L.lane.left + L.r, b = L.lane.right - L.r;
    const span = b - a;
    let x = L.lane.centerX;
    if (span > 0) {
      const u = L.lane.centerX - a + Math.tan(L.angle) * (L.y0 - y);
      const m = ((u % (2 * span)) + 2 * span) % (2 * span);
      x = a + (m < span ? m : 2 * span - m);
    }
    return { x, y };
  }

  // Freezes the aims, then precomputes every throw and schedules its sounds.
  throw(beat, bpm) {
    if (this.thrown) return;
    this.thrown = true;
    // Count from the bowl phase's start (a 2/4 bar may move the downbeat).
    const from = Song.phaseStart(this.round, "bowl"), bar = CONFIG.BEATS_PER_BAR, half = bar / 2;
    const nextBar = (b, strict) => nextStep(b, bar, from, strict), nextHalf = (b, strict) => nextStep(b, half, from, strict);
    const t0 = nextHalf(beat);
    let strikes = 0;
    this.lanes.forEach((L, i) => {
      const t = t0 + i * half;
      L.angle = this.aimAngle(i, beat);
      L.throwBeat = t;
      const done = t + CONFIG.ROLL_BEATS;
      Clock.atBeat(t, (time) => Music.cue("sfx_ballRoll", time, i));
      Clock.atBeat(done, (time) => Music.stopCue("sfx_ballRoll", time, i));
      const hit = this._roll(L);
      if (!hit) {
        // Missed everything: play the miss as the ball passes the front pin.
        const frontY = Math.max(...L.pins.map((p) => p.y)), passBeat = t + ((L.y0 - frontY) / (L.y0 - L.y1)) * CONFIG.ROLL_BEATS;
        Clock.atBeat(passBeat, (time) => Music.cue("sfx_bowlingMiss", time));
      }
      if (hit === L.pins.length) {
        const multi = ++strikes > 1, at = Math.ceil(done);
        this.banners.push({ beat: at, text: multi ? "MULTISTRIKE!" : "STRIKE!" });
        Clock.atBeat(at, (time) => Music.cue(multi ? "vo_multistrike" : "vo_strike", time));
      }
    });
    const lastDone = this.lanes.at(-1).throwBeat + CONFIG.ROLL_BEATS;

    const standing = this.lanes.flatMap((L) => L.pins.filter((p) => p.knockBeat === Infinity));
    const newBpm = bpm + standing.length * this._bpmPerPin();
    this.danceBeat = standing.length ? this._countAndRamp(standing, nextHalf(lastDone), nextHalf, bpm, newBpm) : nextBar(lastDone);
    return { bpm: newBpm, ramp: this.count }; // ramp: null if no pins stood
  }

  // Precomputes which pins fall and when (by ball or pin); returns the count.
  _roll(L) {
    const dt = 1 / 128, rollEnd = L.throwBeat + CONFIG.ROLL_BEATS, end = rollEnd + PIN_STOP_BEATS * L.pins.length;
    const ballSpeed = (L.y0 - L.y1) / CONFIG.ROLL_BEATS / Math.cos(L.angle);
    const moving = [];
    const knock = (pin, b, from, speed) => {
      const dx = pin.x - from.x, dy = pin.y - from.y, len = Math.hypot(dx, dy) || 1;
      Object.assign(pin, { knockBeat: b, vx: (dx / len) * speed, vy: (dy / len) * speed });
      pin.fallAngle = Math.random() * 2 * Math.PI;
      pin.spin = (Math.random() * 2 - 1) * PIN_MAX_SPIN;
      moving.push(pin);
    };
    for (let b = L.throwBeat; b <= end; b += dt) {
      const ball = b <= rollEnd ? this.ballPos(L, b) : null;
      if (!ball && moving.every((m) => b - m.knockBeat > PIN_STOP_BEATS)) break;
      for (const pin of L.pins) {
        if (pin.knockBeat < Infinity) continue;
        if (ball && Math.hypot(pin.x - ball.x, pin.y - ball.y) < L.r + PIN_RADIUS * PIN_SCALE) {
          knock(pin, b, ball, ballSpeed);
          continue;
        }
        for (const m of moving) {
          const t = b - m.knockBeat, at = pinPos(m, t);
          if (t > 0 && pinSpeed(m, t) > 0 && Math.hypot(pin.x - at.x, pin.y - at.y) < 2 * PIN_RADIUS * PIN_SCALE) {
            knock(pin, b, at, pinSpeed(m, t));
            break;
          }
        }
      }
    }
    const knocks = L.pins.map((p) => p.knockBeat).filter((b) => b < Infinity);
    for (const b of knocks) Clock.atBeat(b, (time) => Music.cue("sfx_pinHitSingle", time)); // one per pin
    return knocks.length;
  }

  // Counts standing pins, then ramps the tempo; returns the beat bowling ends.
  _countAndRamp(standing, start, nextHalf, bpm, newBpm) {
    const n = standing.length;
    standing.forEach((p, k) => {
      p.countBeat = start + k * COUNT_STEP;
      Clock.atBeat(p.countBeat, (time) => Music.cue("sfx_pinCount", time));
    });
    const moveStart = nextHalf(start + (n - 1) * COUNT_STEP, true), rampStart = moveStart + COUNT_MOVE_BEATS;
    // Set the ramp just before toDance's first bar, so that bar follows it.
    const ramp = tempoRamp(rampStart, bpm, newBpm, 0.25, n); // one step per standing pin

    const text = (s, size) => this.countView.addChild(makeText(s, size));
    const labels = standing.map((p, k) => {
      const t = text(String(k + 1), 28);
      t.anchor.set(0.5);
      t.position.set(p.x, p.y);
      return t;
    });
    const plus = text("+ ", 22), times = text(` x ${this._bpmPerPin()}`, 22);
    plus.anchor.set(1, 0);
    times.anchor.set(1, 0);
    this.count = { labels, plus, times, home: { x: labels.at(-1).x, y: labels.at(-1).y }, start, moveStart, ...ramp };
    return rampStart;
  }

  // Round 1 hint if nobody has thrown by bowl bar 2: one word per beat.
  _updateHints(beat) {
    const start = this.round === 0 && !this.thrown ? Song.phaseStart(0, "bowl") + CONFIG.BEATS_PER_BAR : Infinity;
    this.hints.forEach((t, k) => {
      const age = beat - (start + k);
      t.visible = age >= 0 && age < 3;
      t.alpha = Math.min(1, 3 - age);
    });
  }

  update(beat, phase, st) {
    const g = this.gfx;
    g.clear();
    this.pinLayer.visible = this.lanes.length > 0 && st.spread > 0;
    this._updateBanner(beat);
    this._updateCount(beat, phase, st);
    this._updateHints(beat);
    if (!this.pinLayer.visible) return;
    const ink = CONFIG.INK, paper = CONFIG.PAPER;

    for (let i = 0; i < 4; i++) {
      const L = this.lanes[i];
      // Pins drop in as the clef visits; in toDance they fade with the aim UI.
      const leaving = phase.name === "toDance";
      for (const pin of L.pins) {
        const s = pin.sprite, drop = leaving ? 1 : Layout.pinDrop(pin.order, st);
        const k = beat - pin.knockBeat; // beats since knocked
        s.visible = drop > 0 && k <= PIN_STOP_BEATS + PIN_FADE_BEATS && beat < pin.countBeat; // replaced by its number when counted
        if (!s.visible) continue;
        s.scale.set(PIN_SCALE * (1 + (1 - drop) * 0.6)); // falls from slightly above
        s.alpha = leaving ? st.bowlUI : drop;
        if (k > 0) {
          const at = pinPos(pin, k), dist = Math.hypot(pin.vx, pin.vy) * pinSlow(k).dist;
          s.position.set(at.x, at.y);
          s.alpha *= Math.min(1, 1 - (k - PIN_STOP_BEATS) / PIN_FADE_BEATS); // fades once stopped
          s.rotation = pin.fallAngle + pin.spin * dist;
          s.texture = this.frames.fallen[Math.floor(dist / PIN_FRAME_PX) % this.frames.fallen.length];
        } else {
          s.position.set(pin.x, pin.y);
          s.rotation = 0;
          s.texture = this.frames.standing[0];
        }
      }

      // Ball: while rolling
      if (beat >= L.throwBeat && beat - L.throwBeat < CONFIG.ROLL_BEATS) {
        const pos = this.ballPos(L, beat);
        g.circle(pos.x, pos.y, L.r).fill(ink);
        g.circle(pos.x + L.r * 0.3, pos.y - L.r * 0.3, L.r * 0.15).fill(paper);
      }
      // Aim arrow (0 = straight up): frozen once thrown, gone once its ball rolls.
      if (beat < L.throwBeat && st.bowlUI > 0) {
        const a = (this.thrown ? L.angle : this.aimAngle(i, beat)) - Math.PI / 2;
        const len = 110;
        const sx = L.lane.centerX, sy = L.lane.bottom - 6;
        const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
        g.moveTo(sx, sy).lineTo(ex, ey).stroke({ width: 5, color: ink, alpha: st.bowlUI });
        const h = 16;
        g.poly([ex + Math.cos(a) * h, ey + Math.sin(a) * h, ex + Math.cos(a + 2.2) * h, ey + Math.sin(a + 2.2) * h, ex + Math.cos(a - 2.2) * h, ey + Math.sin(a - 2.2) * h]).fill({ color: ink, alpha: st.bowlUI });
      }
    }
  }

  // Numbers replace standing pins; the total slides under the tempo readout.
  _updateCount(beat, phase, st) {
    const c = this.count;
    this.countView.visible = !!c && (phase.name === "bowl" || phase.name === "toDance");
    if (!this.countView.visible) return;
    const fade = 1 - clamp01((beat - c.moveStart) / COUNT_MOVE_BEATS);
    c.labels.forEach((t, k) => {
      t.visible = beat >= c.start + k * COUNT_STEP && fade > 0;
      t.alpha = fade;
    });
    // The total flies to its slot, right-aligned under the tempo.
    const top = c.labels.at(-1), from = c.home, to = this.tempoAnchor, slotX = to.x - c.times.width;
    const m = ease((beat - c.moveStart) / COUNT_MOVE_BEATS);
    top.position.set(lerp(from.x, slotX, m), lerp(from.y, to.y, m));
    top.anchor.set(lerp(0.5, 1, m), lerp(0.5, 0, m));
    top.scale.set(lerp(1, 22 / 28, m));
    const arrived = beat >= c.rampStart;
    top.alpha = 1;
    top.visible = beat >= c.start + (c.labels.length - 1) * COUNT_STEP && beat < c.rampEnd;
    c.plus.visible = c.times.visible = arrived && top.visible;
    c.times.position.set(to.x, to.y);
    c.plus.position.set(slotX - top.width, to.y);
  }

  // STRIKE banner: slams in on a beat, pulses each beat for 2 beats.
  _updateBanner(beat) {
    const b = this.banners.findLast((x) => beat >= x.beat);
    const m = b ? beat - b.beat : Infinity;
    this.banner.visible = m < 2;
    if (this.banner.visible) {
      this.banner.text = b.text;
      const pulse = 1 - (m - Math.floor(m));
      this.banner.scale.set((m < 0.25 ? 2.5 - m * 6 : 1) + 0.12 * pulse);
      this.banner.rotation = Math.sin(m * Math.PI) * 0.06;
    }
  }
}
