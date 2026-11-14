// Game over: text and REPLAY on the left, the pancake on the right.

const GAME_OVER_ZOOM_MS = 900; // zoom-in / fade time; REPLAY is ignored until it's done

class GameOverPanel {
  constructor() {
    this.view = new PIXI.Container();
    const center = { align: "center" };
    const x = CONFIG.WIDTH * 0.28 + 25;
    this.title = makeText("MULTISTRUCK!", 96, "900", center);
    this.title.anchor.set(0.5);
    this.title.position.set(x, 190);
    this.sub = makeText("", 30, "900", center);
    this.sub.anchor.set(0.5);
    this.sub.position.set(x, 370);
    this.menu = new Menu([{ label: "REPLAY", onSelect: () => this.replay() }], { x, y: 540 });
    this.view.addChild(this.title, this.sub, this.menu.view);
    this.hide();
  }

  show(time, bpm) {
    this.sub.text = `Time to go home...\nPartied until ${time}\nFinal tempo: ${bpm.toFixed(1)} bpm`;
    this.shownAt = performance.now();
    this.view.visible = true;
  }

  hide() {
    this.view.visible = false;
  }

  update(alpha) {
    this.view.alpha = alpha;
    this.title.rotation = Math.sin(performance.now() / 300) * 0.04;
    this.menu.update();
  }

  replay() {
    if (performance.now() - this.shownAt < GAME_OVER_ZOOM_MS) return; // don't skip by accident
    Scenes.go("game");
  }

  onKey(e) {
    this.menu.onKey(e);
  }
}
