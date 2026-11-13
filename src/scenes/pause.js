// Pause overlay for the comic and game; pausing suspends the audio clock.

class PauseMenu {
  // onToggle(paused) runs after each toggle; canPause() can refuse a pause
  constructor({ onToggle = () => {}, canPause = () => true } = {}) {
    this.onToggle = onToggle;
    this.canPause = canPause;
    this.button = makeButton("PAUSE", () => this.toggle(), true);
    this.view = new PIXI.Container();
    this.view.eventMode = "static"; // swallows clicks so they don't reach the scene underneath
    this.view.hitArea = new PIXI.Rectangle(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    this.view.on("pointertap", (e) => e.stopPropagation());
    this.view.addChild(new PIXI.Graphics().rect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT).fill({ color: CONFIG.PAPER, alpha: 0.85 }));

    this.main = this.view.addChild(new PIXI.Container());
    const title = this.main.addChild(makeText("PAUSED", 96, "900"));
    title.anchor.set(0.5);
    title.position.set(CONFIG.WIDTH / 2, 170);
    this.menu = new Menu([
      { label: "RESUME", onSelect: () => this.toggle() },
      { label: "SETTINGS", onSelect: () => this._showSettings(true) },
      { label: "QUIT", onSelect: () => Scenes.go("title") },
    ], { y: 330 });
    this.main.addChild(this.menu.view);
    this.settings = new SettingsPanel({ onBack: () => this._showSettings(false) });
    this.view.addChild(this.settings.view);
    this.show(false);
  }

  toggle() {
    if (!Clock.paused && !this.canPause()) return;
    if (Clock.paused) Clock.resume();
    else Clock.pause();
    this.show(Clock.paused);
    this.onToggle(Clock.paused);
  }

  // Shows/hides the overlay without touching the clock.
  show(on) {
    this.view.visible = on;
    this.menu.choice = 0;
    this._showSettings(false);
  }

  _showSettings(on) {
    this.main.visible = !on;
    this.settings.view.visible = on;
    if (on) this.settings.show("main");
  }

  _active() {
    return this.settings.view.visible ? this.settings : this.menu;
  }

  update() {
    if (this.view.visible) this._active().update();
  }

  // Keys while paused. Esc on the pause menu quits to the title.
  onKey(e) {
    if (e.key === "Escape" && !this.settings.view.visible) Scenes.go("title");
    else this._active().onKey(e);
  }
}
