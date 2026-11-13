// Player settings (saved in this browser) and the menu pages that edit them.

const Settings = {
  difficulty: 1, // index into CONFIG.DIFFICULTIES
  bpm: CONFIG.BPM, // starting tempo
  volume: { music: 1, sfx: 1 }, // slider positions 0..1, applied by Mixer.setVolume
  keys: [...CONFIG.LANE_KEYS], // dance key per lane, lowercase

  load() {
    try {
      const s = JSON.parse(localStorage.getItem("pizzajam.settings")) || {};
      if (CONFIG.DIFFICULTIES[s.difficulty]) this.difficulty = s.difficulty;
      if (s.bpm >= CONFIG.START_BPM_MIN && s.bpm <= CONFIG.START_BPM_MAX) this.bpm = s.bpm;
      for (const k in this.volume) if (Number.isFinite(s.volume?.[k])) this.volume[k] = s.volume[k];
      if (s.keys?.length === this.keys.length && s.keys.every(this.bindable)) this.keys = s.keys;
    } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem("pizzajam.settings", JSON.stringify({ difficulty: this.difficulty, bpm: this.bpm, volume: this.volume, keys: this.keys }));
    } catch (e) {}
  },
  setDifficulty(i) {
    this.difficulty = i;
    this.save();
  },
  setBpm(bpm) {
    this.bpm = bpm;
    this.save();
  },
  setVolume(group, v) {
    this.volume[group] = v;
    Mixer.setVolume(group, v);
    this.save();
  },
  // Single printable keys, except space and the keys taken by pause and debug.
  bindable: (key) => typeof key === "string" && key.length === 1 && !" p[]".includes(key),
  // Binds a lane; a lane already using that key gets this lane's old key.
  setKey(lane, key) {
    const other = this.keys.indexOf(key);
    if (other >= 0) this.keys[other] = this.keys[lane];
    this.keys[lane] = key;
    this.save();
  },
};
Settings.load();

// Loops a preview while a volume slider is selected (music or sfx).
const AudioPreview = {
  group: null,
  play(group = null) {
    if (group === this.group) return;
    this.group = group;
    Clock.reset(CONFIG.BPM); // stopping lets the title screen restart its intro
    if (!group) return;
    if (group === "music") MidiMusic.start("dance");
    else Clock.transport.scheduleRepeat((time) => this._sfxStep(time), "8n", 0);
    Clock.start();
  },
  // 2-bar loop of 8ths: a multistrike on the first, pin count clicks on the rest.
  _sfxStep(time) {
    const step = Math.round(Clock.beatAtTime(time) * 2) % 16;
    Music.cue(step ? "sfx_pinCount" : "vo_multistrike", time);
  },
};

// SETTINGS → DIFFICULTY / AUDIO MIX / CONTROLS pages.
class SettingsPanel {
  constructor({ onBack }) {
    this.view = new PIXI.Container();
    this.onBack = onBack;
    this.heading = this.view.addChild(new PIXI.Text({ text: "", style: { fontFamily: CONFIG.FONT, fontSize: 56, fontWeight: "900", fill: CONFIG.INK } }));
    this.heading.anchor.set(0.5);
    this.heading.position.set(CONFIG.WIDTH / 2, 140);

    const back = { label: "BACK", onSelect: () => this.back() };
    const levels = CONFIG.DIFFICULTIES.map((d, i) => ({
      label: () => `${d.name}   (±${d.windowMs} ms)${i === Settings.difficulty ? "  ●" : ""}`,
      onSelect: () => {
        Settings.setDifficulty(i);
        this.show("main");
      },
    }));
    const [lo, hi] = [CONFIG.START_BPM_MIN, CONFIG.START_BPM_MAX];
    levels.push({
      label: () => `TEMPO   ${Settings.bpm} BPM`,
      get: () => (Settings.bpm - lo) / (hi - lo),
      set: (v) => Settings.setBpm(Math.round(lo + v * (hi - lo))),
      step: 5 / (hi - lo), // ← → move 5 bpm
    });
    const offset = () => Math.round(Clock.inputOffsetMs);
    levels.push({ label: () => `CALIBRATE   (offset ${offset() > 0 ? "+" : ""}${offset()} ms)`, onSelect: () => Scenes.go("calibrate") });
    const controls = Settings.keys.map((_, lane) => ({
      label: () => `LANE ${lane + 1}   ${this.binding === lane ? "press a key…" : Settings.keys[lane].toUpperCase()}`,
      onSelect: () => (this.binding = lane),
    }));
    const slider = (group) => ({ label: group.toUpperCase(), preview: group, get: () => Settings.volume[group], set: (v) => Settings.setVolume(group, v) });

    this.pages = {
      main: {
        title: "SETTINGS",
        menu: new Menu([
          { label: () => `DIFFICULTY   ${CONFIG.DIFFICULTIES[Settings.difficulty].name}`, onSelect: () => this.show("difficulty") },
          { label: "AUDIO MIX", onSelect: () => this.show("audio") },
          { label: "CONTROLS", onSelect: () => this.show("controls") },
          back,
        ]),
      },
      difficulty: { title: "HOW TIGHT ARE YOUR MOVES?", menu: new Menu([...levels, back]) },
      audio: { title: "AUDIO MIX", menu: new Menu([slider("music"), slider("sfx"), back]) },
      controls: { title: "DANCE KEYS", menu: new Menu([...controls, back]) },
    };
    for (const p of Object.values(this.pages)) this.view.addChild(p.menu.view);
    this.show("main");
  }

  show(name) {
    this.binding = null; // lane waiting for a key on the controls page
    this.page = this.pages[name];
    for (const p of Object.values(this.pages)) p.menu.view.visible = p === this.page;
    this.heading.text = this.page.title;
  }

  back() {
    if (this.page === this.pages.main) this.onBack();
    else this.show("main");
  }

  update() {
    const menu = this.page.menu;
    menu.update();
    if (!Clock.paused) AudioPreview.play(menu.items[menu.choice].preview); // not while paused: the audio clock is frozen
  }

  onKey(e) {
    if (this.binding != null) {
      const key = e.key.toLowerCase();
      if (Settings.bindable(key)) Settings.setKey(this.binding, key);
      if (Settings.bindable(key) || e.key === "Escape") this.binding = null;
    } else if (e.key === "Escape") this.back();
    else this.page.menu.onKey(e);
  }
}
