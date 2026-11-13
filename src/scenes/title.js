// Title screen: PLAY or SETTINGS; intro music starts on the first input.

class TitleScene {
  constructor() {
    this.view = new PIXI.Container();
    this.main = this.view.addChild(new PIXI.Container());
    const title = this.main.addChild(makeText("DRUMS' NIGHT OUT", 100, "900"));
    title.anchor.set(0.5);
    title.position.set(CONFIG.WIDTH / 2, 190);
    this.menu = new Menu([
      { label: "PLAY", onSelect: () => Scenes.go("comic") },
      { label: "SETTINGS", onSelect: () => this.showSettings("main") },
    ], { y: 400, gap: 85, size: 48 });
    this.main.addChild(this.menu.view);

    this.settings = new SettingsPanel({ onBack: () => this.showSettings(null) });
    this.view.addChild(this.settings.view);

    if (MidiMusic.needsServer) {
      const note = this.view.addChild(makeText("♪ Your MIDI music needs a local server to load (see README); no music for now.", 18, "normal"));
      note.anchor.set(0.5);
      note.position.set(CONFIG.WIDTH / 2, 680);
    }
  }

  // data.page opens that settings page (calibration returns to difficulty).
  enter({ page }) {
    this.showSettings(page);
  }
  exit() {}

  showSettings(page) {
    this.main.visible = !page;
    this.settings.view.visible = !!page;
    if (page) this.settings.show(page);
  }

  _active() {
    return this.main.visible ? this.menu : this.settings;
  }

  update() {
    MidiMusic.playIntro();
    this._active().update();
  }

  onKey(e) {
    this._active().onKey(e);
  }
}
