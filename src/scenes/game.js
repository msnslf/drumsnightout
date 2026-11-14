// The main game: everything is drawn from the beat, phase and layout state.

// Party clock: 11:03pm + 1 h a round; ticks 45 min over dance (once a bar) and toBowl (once a beat).
function partyTime(beat) {
  const phase = Song.phaseAt(beat), cycle = Math.max(0, phase.cycle);
  let minutes = phase.name === "countoff" ? 0 : 45;
  if (phase.name === "dance" || phase.name === "toBowl") {
    const beats = Song.phaseBeats("dance", cycle) + Song.phaseBeats("toBowl", cycle);
    const step = phase.name === "dance" ? CONFIG.BEATS_PER_BAR : 1;
    const elapsed = Math.floor((beat - Song.phaseStart(cycle, "dance")) / step) * step;
    minutes = Math.round((elapsed * 45) / beats);
  }
  const total = 23 * 60 + 3 + cycle * 60 + minutes, h = Math.floor(total / 60) % 24;
  return `${h % 12 || 12}:${String(total % 60).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

const METER_REFILL_BEATS = 3; // miss bar refill (and fade from red) after the stick lands
const MARQUEE_ART_H = 836; // height of the art in marquee_sign.png (below it is transparent)

class GameScene {
  constructor() {
    this.view = new PIXI.Container();
    this.staff = new StaffView();
    this.drums = [0, 1, 2, 3].map((i) => new Drum(i));
    for (const d of this.drums) d.onStick = (level, landBeat) => level === CONFIG.SQUISH_TEMPO_LEVEL && this._squishTempo(landBeat);
    this.dance = new DanceMode(this.drums);
    this.bowling = new BowlingMode();

    this.drumLayer = new PIXI.Container();
    for (const d of this.drums) this.drumLayer.addChild(d.view);
    this.hud = new PIXI.Graphics();
    this.overlay = new PIXI.Container();

    // Top row: party clock + tempo on the left, pause button on the right.
    this.info = makeText("", 22);
    this.info.position.set(16, 16);
    this.pause = new PauseMenu({
      onToggle: (paused) => {
        if (paused) return (this.pausedBpm = Settings.bpm);
        this.dance.relabel(); // keys may have changed in settings
        if (Settings.bpm !== this.pausedBpm) this._setTempo(Settings.bpm); // so may the tempo
      },
      canPause: () => this.gameOverBeat === Infinity,
    });
    this.pause.button.position.set(CONFIG.WIDTH - 20 - this.pause.button.width, 14);

    this.marquee = new PIXI.Sprite(); // texture set by useMarquee
    this.marquee.anchor.set(0.5, 0);
    this.marquee.position.set(CONFIG.WIDTH / 2, 0);

    this.countIn = makeText("", 140, "900");
    this.countIn.anchor.set(0.5);
    this.countIn.position.set(CONFIG.WIDTH / 2, Layout.countY);

    this.gameOver = new GameOverPanel();
    this.overlay.addChild(this.info, this.marquee, this.countIn, this.bowling.banner, this.bowling.countView, this.pause.view);
    this.view.addChild(this.bowling.view, this.staff.gfx, this.dance.view, this.drumLayer, this.hud, this.overlay, this.gameOver.view, this.pause.button);
  }

  enter() {
    this.difficulty = CONFIG.DIFFICULTIES[Settings.difficulty];
    this.bpm = Settings.bpm;
    this.ramps = [];
    this.phaseKey = "";
    this.gameOverBeat = Infinity;
    this.ending = null;
    Mixer.unfade();
    for (const v of this._fading()) v.alpha = 1;
    this.gameOver.hide();
    for (const d of this.drums) d.reset(), (d.missesPerSquish = this.difficulty.missesPerSquish);
    Mixer.setDuck("nodrums", MIX.nodrums.duck);
    this.dance.reset(this.difficulty.windowMs);
    this.bowling.reset();
    this.pause.show(false);
    this.touches = new Map(); // pointerId -> lane held

    Song.reset();
    const startAt = Clock.nextBar(); // if music is playing (intro, game over…), start on its next downbeat
    Clock.reset(this.bpm);
    MidiMusic.start();
    Music.countoffClicks(Song.countoffBeats);
    Clock.start(startAt || undefined);
  }

  exit() {
    Clock.reset(this.bpm);
    Mixer.unfade();
    Mixer.setDuck("nodrums", MIX.nodrums.duck);
    this.pause.show(false);
  }

  // ---------- phase changes ----------

  _onPhase(phase) {
    if (phase.name === "dance") {
      this.dance.startSegment(phase.cycle);
      const rule = CONFIG.MISSES_FROM_ROUND.findLast((r) => phase.cycle + 1 >= r.round);
      for (const d of this.drums) d.missesPerSquish = Math.min(this.difficulty.missesPerSquish, rule?.misses ?? Infinity);
      Mixer.setDuck("nodrums", MIX.nodrums.duck + phase.cycle * CONFIG.DUCK_DB_PER_ROUND);
    } else if (phase.name === "toBowl") {
      this.bowling.prepare(phase.cycle);
      this._scheduleBowlCheck(phase.cycle, Song.phaseStart(phase.cycle, "bowl") + Song.phaseBeats("bowl"));
    }
  }

  // Repeats the bowling bar until the throw (and any pin count) is done.
  _scheduleBowlCheck(cycle, barEnd) {
    Clock.atBeat(barEnd - 0.125, () => {
      if (this.bowling.danceBeat <= barEnd || this.gameOverBeat < Infinity || Scenes.current !== this) return;
      const beats = Math.min(CONFIG.BEATS_PER_BAR, this.bowling.danceBeat - barEnd); // 2 makes a 2/4 bar, so the transition can start on beat 3
      Song.extendBowl(cycle, beats);
      this._scheduleBowlCheck(cycle, barEnd + beats);
    });
  }

  _throw(beat) {
    if (this.bowling.thrown || this.gameOverBeat < Infinity) return;
    const { bpm, ramp } = this.bowling.throw(beat, this.bpm);
    this.bpm = bpm; // BowlingMode ramps the tempo up to this for standing pins
    if (ramp) this.ramps.push(ramp);
    this.bowling.lanes.forEach((L, i) => this.drums[i].spin(L.throwBeat));
  }

  // Replaces the tempo (and ramps to come) from the next unscheduled half bar.
  _setTempo(bpm) {
    cancelTempoRamps();
    const param = Clock.transport.bpm, time = Clock.nextHalfBar();
    param.cancelAndHoldAtTime(time);
    param.setValueAtTime(bpm, time);
    this.ramps = [];
    this.bpm = bpm;
  }

  // Ramps the tempo up from the stick's landing, after any squish ramp.
  _squishTempo(landBeat) {
    const start = Math.max(landBeat, this.ramps.at(-1)?.rampEnd ?? -Infinity);
    this.ramps.push(tempoRamp(start, this.bpm, this.bpm + CONFIG.SQUISH_TEMPO_BPM, 0));
    this.bpm += CONFIG.SQUISH_TEMPO_BPM;
  }

  // Marquee sign at the top centre; its art ends where the dance lanes begin.
  useMarquee(texture) {
    this.marquee.texture = texture;
    this.marquee.scale.set(Layout.danceTop.y / MARQUEE_ART_H);
  }

  // ---------- frame ----------

  update() {
    if (this.ending) return this._updateEnding();
    this.pause.update();
    const beat = Clock.beat();
    const phase = Song.phaseAt(beat);
    const key = phase.name + phase.cycle;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this._onPhase(phase);
    }
    const st = Layout.state(phase);

    this.staff.update(st, this.drums.filter((d) => d.squishLevel === CONFIG.SQUISHES_TO_PANCAKE - 1).map((d) => d.index));
    this.dance.update(beat, phase, st.spread);
    this.bowling.update(beat, phase, st);

    for (const d of this.drums) {
      d.view.position.set(Layout.drumX(d.index), Layout.drums.floorY);
      d.view.scale.set(Layout.drums.scale);
      d.update(beat, phase.name === "bowl" ? 0.5 : 1);
    }
    this._drawHud(beat, phase, st);

    // Game over two beats after a drum turns into a pancake.
    if (this.gameOverBeat === Infinity && this.drums.some((d) => d.isPancake)) this.gameOverBeat = beat + 2;
    if (beat >= this.gameOverBeat) this._startEnding(beat);
  }

  // ---------- game over ----------
  // Freeze, slow and fade the music, zoom the pancake while the rest fades.

  _startEnding(beat) {
    const drum = this.drums.find((d) => d.isPancake);
    const b = drum.spinner.getLocalBounds(); // in the drum view's coordinates
    const scale = Math.min((CONFIG.WIDTH * 0.45) / b.width, (CONFIG.HEIGHT * 0.8) / b.height);
    cancelTempoRamps();
    MidiMusic.autoLanes = true;
    const time = Clock.nextHalfBar(), bpm = Clock.transport.bpm, from = bpm.getValueAtTime(time);
    bpm.cancelAndHoldAtTime(time); // drops any game tempo ramp still to come
    const slowed = time + Math.abs(from - CONFIG.END_BPM) / CONFIG.END_BPM_PER_SEC;
    bpm.linearRampToValueAtTime(CONFIG.END_BPM, slowed);
    const lastBar = Clock.beatAtTime(slowed) - Clock.beatAtTime(time) - CONFIG.BEATS_PER_BAR; // beats from `time` to the slowdown's last bar
    const fadeFrom = lastBar > 0 ? Clock.timeAfter(time, lastBar) : time;
    Mixer.lowpassSweep(time, slowed);
    Mixer.fadeOut(fadeFrom, slowed - fadeFrom);
    this.ending = {
      drum,
      silentAt: slowed, // the music is stopped once it has slowed (and faded) out
      beat,
      start: performance.now(),
      from: { x: drum.view.x, y: drum.view.y, scale: drum.view.scale.x },
      to: { x: CONFIG.WIDTH * 0.73 - (b.x + b.width / 2) * scale, y: CONFIG.HEIGHT / 2 - (b.y + b.height / 2) * scale, scale },
    };
    this.gameOver.show(partyTime(beat), this.bpm);
  }

  _updateEnding() {
    const { drum, beat, start, silentAt, from, to } = this.ending;
    if (Clock.running && Clock.ctx.currentTime >= silentAt) Clock.reset(this.bpm);
    const e = ease((performance.now() - start) / GAME_OVER_ZOOM_MS);
    drum.view.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e));
    drum.view.scale.set(lerp(from.scale, to.scale, e));
    drum.update(beat);
    for (const v of this._fading(drum)) v.alpha = 1 - e;
    this.gameOver.update(e);
  }

  // Everything that fades out at game over (all but the pancake).
  _fading(keep) {
    return [this.bowling.view, this.staff.gfx, this.dance.view, this.hud, this.overlay, ...this.drums.filter((d) => d !== keep).map((d) => d.view)];
  }

  _drawHud(beat, phase, st) {
    const g = this.hud;
    g.clear();
    // Miss bar under each drum while dancing: full, emptying by one step per miss.
    // Red with one miss left; empty and red until the stick lands, then refills and fades to black.
    const a = 1 - st.spread, w = 52, h = 12;
    if (a > 0) {
      for (const d of this.drums) {
        if (d.missesPerSquish <= 1) continue; // one miss is a hit: no bar
        const x = Layout.drumX(d.index) - w / 2, y = Layout.drums.floorY + 22 - h / 2;
        let left = 1 - d.misses / d.missesPerSquish, red = d.misses === d.missesPerSquish - 1 ? 1 : 0;
        const since = beat - d.stick.landBeat;
        if (since < 0) (left = 0), (red = 1);
        else if (since < METER_REFILL_BEATS) (left = Math.min(left, since / METER_REFILL_BEATS)), (red = Math.max(red, 1 - since / METER_REFILL_BEATS));
        const color = lerpColor(CONFIG.INK, CONFIG.DANGER, red);
        if (left > 0) g.rect(x, y, w * left, h).fill({ color, alpha: a });
        g.rect(x, y, w, h).stroke({ width: 2, color, alpha: a });
      }
    }

    const ramp = this.ramps.find((r) => beat < r.rampEnd);
    const bpm = ramp ? rampBpm(ramp, beat) : this.bpm;
    this.info.text = `${partyTime(beat)}   ${bpm.toFixed(1)} BPM`;
    this.bowling.tempoAnchor = { x: this.info.x + this.info.width, y: this.info.y + this.info.height + 4 };

    // Count-off: READY for the first bar, then 1 2 3 4, each popping on its beat.
    if (phase.name === "countoff" && beat > 0) {
      const bpb = CONFIG.BEATS_PER_BAR, n = Math.floor(beat), lastBar = phase.endBeat - bpb;
      this.countIn.visible = true;
      this.countIn.text = n < lastBar ? "READY" : String(n - lastBar + 1);
      this.countIn.scale.set(n < lastBar ? 1 : 1 + 0.4 * (1 - (beat - n)));
    } else {
      this.countIn.visible = false;
    }
  }

  // ---------- input ----------

  onKey(e, beat) {
    if (this.ending) return e.key === "Escape" ? Scenes.go("title") : this.gameOver.onKey(e);
    if (e.key === "p" || e.key === "P") return this.pause.toggle();
    if (Clock.paused) return this.pause.onKey(e);
    if (e.key === "Escape") return Scenes.go("title");
    const phase = Song.phaseAt(beat);
    if (phase.name === "bowl") {
      this._throw(beat);
      return;
    }
    const lane = Settings.keys.indexOf(e.key.toLowerCase());
    if (lane >= 0) this._press(lane, beat, phase);
  }

  _press(lane, beat, phase) {
    if (phase.name !== "toBowl" && phase.name !== "toDance") this.dance.press(lane, beat, phase); // no drum input in transitions
  }

  // Touch: tap a hit circle to dance, anywhere (but PAUSE) to bowl.
  onTap(e, p, beat) {
    const b = this.pause.button;
    if (this.ending || Clock.paused || (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)) return;
    const phase = Song.phaseAt(beat);
    if (phase.name === "bowl") return this._throw(beat);
    const lane = Layout.circleAt(p);
    if (lane < 0) return;
    this.touches.set(e.pointerId, lane);
    this._press(lane, beat, phase);
  }

  onTapUp(e) {
    const lane = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (lane !== undefined) this.dance.release(lane);
  }

  onHide() {
    if (!Clock.paused && !this.ending) this.pause.toggle();
  }

  onKeyUp(e) {
    const lane = Settings.keys.indexOf(e.key.toLowerCase());
    if (lane >= 0) this.dance.release(lane);
  }
}
