// Boot: Pixi app, letterboxed 1280x720 stage, scenes.

const Scenes = {
  app: null,
  stage: null, // scaled root container
  list: {},
  current: null,

  go(name, data) {
    if (this.current) {
      this.current.exit();
      this.stage.removeChild(this.current.view);
    }
    this.current = this.list[name];
    this.stage.addChild(this.current.view);
    this.current.enter(data || {});
  },
};

async function main() {
  Clock.init();
  Mixer.init();
  Music.init();
  await Music.loadSamples();

  try {
    await MidiMusic.load();
  } catch (error) {
    console.error("MIDI loading failed:", error);
  }

  const root = document.getElementById("game");
  const app = new PIXI.Application();
  await app.init({
    background: CONFIG.PAPER,
    resizeTo: root,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  root.appendChild(app.canvas);
  Scenes.app = app;

  // Letterboxed stage at a fixed virtual resolution.
  Scenes.stage = new PIXI.Container();
  app.stage.addChild(Scenes.stage);
  const fit = () => {
    const s = Math.min(app.screen.width / CONFIG.WIDTH, app.screen.height / CONFIG.HEIGHT);
    Scenes.stage.scale.set(s);
    Scenes.stage.position.set((app.screen.width - CONFIG.WIDTH * s) / 2, (app.screen.height - CONFIG.HEIGHT * s) / 2);
  };
  fit();
  app.renderer.on("resize", fit);

  Scenes.list = {
    title: new TitleScene(),
    comic: new ComicScene(),
    game: new GameScene(),
    calibrate: new CalibrateScene(),
  };
  Input.init();

  const sheet = await PIXI.Assets.load("assets/drums/drum0.json");
  const sheets = {
    1: await PIXI.Assets.load("assets/drums/drum1.json"),
    2: await PIXI.Assets.load("assets/drums/drum2.json"),
    3: await PIXI.Assets.load("assets/drums/drum3.json"),
  };
  Scenes.list.game.drums.forEach((drum, i) => drum.useSpritesheet(sheets[i] ?? sheet));

  try {
    Scenes.list.game.bowling.useSpritesheet(await PIXI.Assets.load("assets/pins/pin.json"));
  } catch {
    console.log("No pin spritesheet yet (assets/pins/pin.json), using placeholder pins");
  }

  Scenes.go("title");
  app.ticker.add(() => {
    Scenes.current.update();
    Mixer.update();
  });
}

main();
