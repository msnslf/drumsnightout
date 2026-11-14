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
  // Audio and images all load at once.
  const audio = Promise.all([Music.loadSamples(), MidiMusic.load().catch((error) => console.error("MIDI loading failed:", error))]);

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

  const drumSheet = async (i, atlas) => {
    const sheet = new PIXI.Spritesheet({ texture: await PIXI.Assets.load(`assets/drums/drum${i}.png`), data: await atlas, cachePrefix: `drum${i}:` });
    await sheet.parse();
    return sheet;
  };
  const atlas = fetch("assets/drums/drum.json").then((r) => r.json()); // shared by every drum's PNG
  const [drums, background, marquee, pins] = await Promise.all([
    Promise.all([0, 1, 2, 3].map((i) => drumSheet(i, atlas))),
    PIXI.Assets.load("assets/environment/startpagebackground.png"),
    PIXI.Assets.load("assets/environment/marquee_sign.png"),
    PIXI.Assets.load("assets/environment/bowlingpin.json").catch(() => null),
    audio,
  ]);

  Scenes.list = {
    title: new TitleScene(),
    game: new GameScene(),
    calibrate: new CalibrateScene(),
  };
  Input.init();
  Scenes.list.game.drums.forEach((drum, i) => drum.useSpritesheet(drums[i]));
  Scenes.list.title.useBackground(background);
  Scenes.list.game.useMarquee(marquee);
  if (pins) Scenes.list.game.bowling.useSpritesheet(pins);
  else console.log("No pin spritesheet yet (assets/environment/bowlingpin.json), using placeholder pins");

  Scenes.go("title");
  app.ticker.add(() => {
    Scenes.current.update();
    Mixer.update();
  });
}

main();
