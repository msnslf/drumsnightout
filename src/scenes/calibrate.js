// Calibration: tap 16 quarter notes; the offset cancels the median error.

const CAL_COUNT_IN = 4; // beats of clicks before the first arrow
const CAL_NOTES = 16;
const CAL_MIN_HITS = 8;
const CAL_LANES = [1, 2, 1, 2, 0, 3, 0, 3]; // just for variety; any key counts

class CalibrateScene {
  constructor() {
    this.view = new PIXI.Container();
    this.staff = new StaffView();
    this.view.addChild(this.staff.gfx);

    this.arrowLayer = new PIXI.Container();
    this.view.addChild(this.arrowLayer);
    this.arrowLayer.mask = this.view.addChild(Layout.clip(Layout.danceTop.y));

    const center = { align: "center" };
    this.title = makeText("CALIBRATE", 30, "900", center);
    this.title.position.set(16, 14);
    this.hint = makeText("", 20, "normal", center);
    this.hint.anchor.set(0.5, 0);
    this.hint.position.set(CONFIG.WIDTH / 2, 20);
    this.big = makeText("", 64, "900", center);
    this.big.anchor.set(0.5);
    this.big.position.set(CONFIG.WIDTH / 2, Layout.countY);
    this.progress = makeText("", 24, "bold", center);
    this.progress.anchor.set(0.5);
    this.progress.position.set(CONFIG.WIDTH / 2, Layout.drums.floorY + 34);
    this.result = makeText("", 40, "900", center);
    this.result.anchor.set(0.5);
    this.result.position.set(CONFIG.WIDTH / 2, 230);
    this.detail = makeText("", 24, "bold", center);
    this.detail.anchor.set(0.5);
    this.detail.position.set(CONFIG.WIDTH / 2, 285);
    this.menu = new Menu([
      { label: "CONTINUE", onSelect: () => this._done() },
      { label: "RECALIBRATE", onSelect: () => Scenes.go("calibrate", { then: this.then, ready: true }) },
    ], { y: 400 });

    // Instructions overlay (pause menu style). From settings: OK calibrates. First PLAY: START or CALIBRATE.
    this.info = new PIXI.Container();
    this.info.eventMode = "static"; // swallows clicks
    this.info.hitArea = new PIXI.Rectangle(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    this.info.on("pointertap", (e) => e.stopPropagation());
    this.info.addChild(new PIXI.Graphics().rect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT).fill({ color: CONFIG.PAPER, alpha: 0.85 }));
    this.heading = this.info.addChild(makeText("CALIBRATION", 96, "900"));
    this.heading.anchor.set(0.5);
    this.heading.position.set(CONFIG.WIDTH / 2, 170);
    this.howTo = this.info.addChild(makeText("", 32, "bold", { align: "center", wordWrap: true, wordWrapWidth: 1000 }));
    this.howTo.anchor.set(0.5);
    this.howTo.position.set(CONFIG.WIDTH / 2, 340);
    this.ok = new Menu([{ label: "OK", onSelect: () => this._start() }], { y: 520 });
    this.choose = new Menu([
      { label: "START", onSelect: () => this._done() },
      { label: "CALIBRATE", onSelect: () => this._start() },
    ], { y: 450 });
    this.info.addChild(this.ok.view, this.choose.view);
    this.back = makeButton("BACK", () => this._done());
    this.back.position.set(CONFIG.WIDTH - 20 - this.back.width, 14);
    this.view.addChild(this.title, this.hint, this.big, this.progress, this.result, this.detail, this.menu.view, this.info, this.back);
  }

  // then: scene to go to when done (first PLAY: "game"); else the title's difficulty page.
  // ready: skip the instructions overlay (RECALIBRATE).
  enter({ then, ready }) {
    Settings.calibrated = true;
    this.then = then;
    this.back.visible = !then;
    this.heading.visible = this.ok.view.visible = !then;
    this.choose.view.visible = !!then;
    this.ok.choice = this.choose.choice = 0;
    this.howTo.y = then ? 290 : 340;
    this.arrowLayer.removeChildren().forEach((c) => c.destroy());
    this.hint.text = Settings.touch
      ? "Tap on every beat, as each dot hits the line"
      : `Tap any of ${Settings.keys.join(" ").toUpperCase()} on every beat, as each letter hits the line`;
    this.howTo.text = (Settings.touch
      ? "tap on beat as the dots arrive."
      : `tap ${Settings.keys.join(" ").toUpperCase()} on beat as the letters arrive.`) +
      "\n\n(bluetooth audio will be problematic with latency!)";
    this.music = !!then && !!MidiMusic.clips.intro; // first PLAY: tap to the intro, not the metronome
    this.notes = [];
    this.deltas = [];
    this.started = this.finished = false;
    this.result.text = this.detail.text = this.big.text = "";
    this.progress.text = `0 / ${CAL_NOTES}`;
    this.menu.view.visible = false;
    this.menu.choice = 0;
    this.staff.gfx.visible = this.arrowLayer.visible = true;
    this.staff.update(Layout.state({ name: "dance", progress: 0 }));
    this.info.visible = !ready;
    if (ready) this._start();
  }

  // Starts on the intro's next downbeat (left playing), or with a fresh metronome.
  _start() {
    this.started = true;
    this.info.visible = false;
    if (this.music && Clock.running) {
      this.base = Math.round(Clock.beatAtTime(Clock.nextBar())); // intro keeps playing; start on its next downbeat
    } else {
      this.base = 0;
      Clock.reset(CONFIG.BPM);
      if (this.music) MidiMusic.start("intro");
      else Music.startMetronome(CAL_COUNT_IN);
      Clock.start();
    }
    this.notes = [];
    for (let i = 0; i < CAL_NOTES; i++) {
      const lane = CAL_LANES[i % CAL_LANES.length];
      const view = makeLetter(lane);
      this.arrowLayer.addChild(view);
      this.notes.push({ beat: this.base + CAL_COUNT_IN + i, lane, hit: false, view });
    }
  }

  exit() {
    if (!this.music) Clock.reset(CONFIG.BPM); // the intro carries on until the game's downbeat
  }

  update() {
    if (!this.started) return this._infoMenu().update();
    if (this.finished) return this.menu.update();
    const beat = Clock.beat();
    for (const n of this.notes) {
      n.view.visible = !n.hit && placeLetter(n.view, n.lane, n.beat - beat, 0);
    }
    const t = beat - this.base; // beats since calibration's first downbeat
    if (t >= 0 && t < CAL_COUNT_IN) {
      const k = Math.floor(t);
      this.big.text = String(k + 1);
      this.big.scale.set(1 + 0.4 * (1 - (t - k)));
    } else {
      this.big.text = "";
    }
    this.progress.text = `${this.deltas.length} / ${CAL_NOTES}`;
    if (t > CAL_COUNT_IN + CAL_NOTES) this._finish();
  }

  _finish() {
    this.finished = true;
    if (!this.music) Clock.reset(CONFIG.BPM); // stop the metronome
    this.staff.gfx.visible = this.arrowLayer.visible = false; // clear the stage for the result
    this.big.text = this.progress.text = "";
    this.menu.view.visible = true;
    if (this.deltas.length < CAL_MIN_HITS) {
      this.result.text = "Not enough taps";
      this.detail.text = "offset unchanged";
      return;
    }
    const sorted = this.deltas.slice().sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const offset = -Math.round(median);
    Settings.inputOffsetMs = offset;
    this.result.text = `Offset: ${offset > 0 ? "+" : ""}${offset} ms`;
    this.detail.text = `you were tapping ${Math.abs(Math.round(median))} ms ${median > 0 ? "late" : "early"} on average`;
  }

  _done() {
    if (this.then) Scenes.go(this.then);
    else Scenes.go("title", { page: "difficulty" });
  }

  onKey(e) {
    const key = e.key.toLowerCase();
    if (e.key === "Escape") return this._done();
    if (!this.started) return this._infoMenu().onKey(e);
    if (this.finished) return this.menu.onKey(e);
    if (Settings.keys.includes(key) || e.key === " ") this._tap(e);
  }

  _infoMenu() {
    return this.then ? this.choose : this.ok;
  }

  // Touch: a tap anywhere counts (menu and buttons are Pixi's).
  onTap(e) {
    if (this.started && !this.finished) this._tap(e);
  }

  _tap(e) {
    const beat = Clock.beatOfEvent(e, 0);
    const n = this.notes[Math.round(beat - this.base) - CAL_COUNT_IN];
    if (!n || n.hit) return;
    const deltaBeats = beat - n.beat;
    if (Math.abs(deltaBeats) > 0.4) return; // way off: ignore rather than skew the result
    n.hit = true;
    this.deltas.push(Clock.beatsToMs(deltaBeats));
  }
}
