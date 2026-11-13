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
    const back = makeButton("BACK", () => this._back());
    back.position.set(CONFIG.WIDTH - 20 - back.width, 14);
    this.view.addChild(this.title, this.hint, this.big, this.progress, back);
  }

  enter() {
    this.arrowLayer.removeChildren().forEach((c) => c.destroy());
    this.hint.text = `Tap any of ${Settings.keys.join(" ").toUpperCase()} on every beat, as each letter hits the line   •   Esc to cancel`;
    this.notes = [];
    for (let i = 0; i < CAL_NOTES; i++) {
      const lane = CAL_LANES[i % CAL_LANES.length];
      const view = makeLetter(lane);
      this.arrowLayer.addChild(view);
      this.notes.push({ beat: CAL_COUNT_IN + i, lane, hit: false, view });
    }
    this.deltas = [];
    this.doneAt = null;
    this.staff.gfx.visible = this.arrowLayer.visible = true;
    this.staff.update(Layout.state({ name: "dance", progress: 0 }));

    Clock.reset(CONFIG.BPM);
    Music.startMetronome(CAL_COUNT_IN);
    Clock.start();
  }

  exit() {
    Clock.reset(CONFIG.BPM);
  }

  update() {
    const beat = Clock.beat();
    for (const n of this.notes) {
      n.view.visible = !n.hit && placeLetter(n.view, n.lane, n.beat - beat, 0);
    }

    if (this.doneAt === null) {
      if (beat < CAL_COUNT_IN) {
        const k = Math.floor(beat);
        this.big.text = String(k + 1);
        this.big.scale.set(1 + 0.4 * (1 - (beat - k)));
      } else {
        this.big.text = "";
      }
      this.progress.text = `${this.deltas.length} / ${CAL_NOTES}`;
      if (beat > CAL_COUNT_IN + CAL_NOTES) this._finish();
    } else if (performance.now() - this.doneAt > 2800) {
      this._back();
    }
  }

  _finish() {
    this.doneAt = performance.now();
    Clock.reset(CONFIG.BPM); // stop the beat
    this.staff.gfx.visible = this.arrowLayer.visible = false; // clear the stage for the result
    this.big.scale.set(1);
    if (this.deltas.length < CAL_MIN_HITS) {
      this.big.text = "Not enough taps — try again!";
      this.progress.text = "offset unchanged";
      return;
    }
    const sorted = this.deltas.slice().sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const offset = -Math.round(median);
    Settings.inputOffsetMs = offset;
    const late = median > 0;
    this.big.text = `Offset: ${offset > 0 ? "+" : ""}${offset} ms`;
    this.progress.text = `you were tapping ${Math.abs(Math.round(median))} ms ${late ? "late" : "early"} on average`;
  }

  _back() {
    Scenes.go("title", { page: "difficulty" });
  }

  onKey(e) {
    if (e.key === "Escape") return this._back();
    if (this.doneAt !== null) return;
    if (!(Settings.keys.includes(e.key.toLowerCase()) || e.key === " ")) return;
    const beat = Clock.beatOfEvent(e, 0);
    const n = this.notes[Math.round(beat) - CAL_COUNT_IN];
    if (!n || n.hit) return;
    const deltaBeats = beat - n.beat;
    if (Math.abs(deltaBeats) > 0.4) return; // way off: ignore rather than skew the result
    n.hit = true;
    this.deltas.push(Clock.beatsToMs(deltaBeats));
  }
}
