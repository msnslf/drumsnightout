// Comic intro and instructions: any key or click turns the page; S skips.

const PAGE_TURN_MS = 650;

class ComicScene {
  constructor() {
    this.view = new PIXI.Container();
    // Clicking anywhere on the page turns it.
    this.view.eventMode = "static";
    this.view.hitArea = new PIXI.Rectangle(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);
    this.view.on("pointertap", () => this.next());

    this.pageLayer = new PIXI.Container();
    this.view.addChild(this.pageLayer);

    this.skip = makeButton("SKIP ▶▶", () => Scenes.go("game"), true); // underlined S: the skip key
    this.skip.position.set(20, 14);
    this.pause = new PauseMenu();
    this.pause.button.position.set(CONFIG.WIDTH - 20 - this.pause.button.width, 14);
    this.view.addChild(this.skip, this.pause.view, this.pause.button);
  }

  enter() {
    this.pause.show(false);
    this.pageLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.index = 0;
    this.current = this._buildPage(0);
    this.turning = null; // { page, start }
    this.pageLayer.addChild(this.current);
  }

  exit() {
    Clock.resume(); // the game's count-off follows on from the intro music
    this.pause.show(false);
  }

  next() {
    if (this.turning) this._finishTurn();
    if (this.index === COMIC_PAGES.length - 1) {
      Scenes.go("game");
      return;
    }
    // New page goes underneath; the old one turns away on top of it.
    this.index++;
    const old = this.current;
    this.current = this._buildPage(this.index);
    this.pageLayer.addChildAt(this.current, 0);
    this.turning = { page: old, start: performance.now() };
  }

  _finishTurn() {
    this.turning.page.destroy({ children: true });
    this.turning = null;
    this.current.shadow.alpha = 0;
  }

  _buildPage(index) {
    const page = new PIXI.Container();
    page.drums = [];
    const quotes = COMIC_PAGES[index];
    const margin = 40, gutter = 24, footer = 50, top = 70;
    const w = (CONFIG.WIDTH - margin * 2 - gutter * (quotes.length - 1)) / quotes.length;
    const h = CONFIG.HEIGHT - top - margin - footer;

    // Paper
    page.addChild(new PIXI.Graphics().rect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT).fill(CONFIG.PAPER));
    // Content (hidden past halfway through a turn, so the back looks blank)
    const content = new PIXI.Container();
    page.addChild(content);
    page.content = content;

    quotes.forEach((quote, i) => {
      const x = margin + i * (w + gutter), y = top;
      content.addChild(new PIXI.Graphics().rect(x, y, w, h).fill(CONFIG.PAPER).stroke({ width: 6, color: CONFIG.INK }));

      // Speech bubble
      const text = new PIXI.Text({
        text: quote,
        style: { fontFamily: CONFIG.FONT, fontSize: quotes.length > 2 ? 26 : 34, fontWeight: "bold", fill: CONFIG.INK, align: "center", wordWrap: true, wordWrapWidth: w - 70 },
      });
      text.anchor.set(0.5);
      const bw = Math.min(w - 30, text.width + 50), bh = text.height + 40;
      const bx = x + w / 2, by = y + 30 + bh / 2;
      const bubble = new PIXI.Graphics();
      bubble.ellipse(bx, by, bw / 2 + 14, bh / 2 + 10).fill(CONFIG.PAPER).stroke({ width: 4, color: CONFIG.INK });
      bubble.poly([bx - 16, by + bh / 2 + 4, bx + 10, by + bh / 2 + 4, bx - 26, by + bh / 2 + 50]).fill(CONFIG.PAPER);
      bubble.moveTo(bx - 16, by + bh / 2 + 7).lineTo(bx - 26, by + bh / 2 + 50).lineTo(bx + 10, by + bh / 2 + 7).stroke({ width: 4, color: CONFIG.INK });
      text.position.set(bx, by);
      content.addChild(bubble, text);

      // Placeholder cast. TODO: replace with drawn comic panels.
      const count = index <= 1 ? 4 : 1;
      for (let k = 0; k < count; k++) {
        const d = new Drum((i + k) % 4);
        d.view.position.set(x + (w * (k + 1)) / (count + 1), y + h - 30);
        d.view.scale.set(count > 1 ? 0.9 : 1.3);
        content.addChild(d.view);
        page.drums.push(d);
      }
    });

    const hint = new PIXI.Text({
      text: `${index + 1} / ${COMIC_PAGES.length}    press any key ▶`,
      style: { fontFamily: CONFIG.FONT, fontSize: 24, fill: CONFIG.INK },
    });
    hint.anchor.set(1, 0.5);
    hint.position.set(CONFIG.WIDTH - margin, CONFIG.HEIGHT - margin - footer / 2 + 10);
    content.addChild(hint);

    // Page border (on the back too) and the shadow of a page turning over it.
    page.addChild(new PIXI.Graphics().rect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT).stroke({ width: 4, color: CONFIG.INK }));
    page.shadow = new PIXI.Graphics().rect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT).fill(CONFIG.INK);
    page.shadow.alpha = 0;
    page.addChild(page.shadow);
    return page;
  }

  update() {
    MidiMusic.playIntro(); // normally already started on the title screen
    this.pause.update();
    // Drums bounce to the music if it's playing, else to a made-up beat.
    const beat = Clock.running ? Clock.beat() : performance.now() / (60000 / CONFIG.BPM);
    for (const page of this.pageLayer.children) for (const d of page.drums) d.update(beat);

    if (this.turning) {
      const p = (performance.now() - this.turning.start) / PAGE_TURN_MS;
      if (p >= 1) {
        this._finishTurn();
        return;
      }
      const e = ease(p);
      const page = this.turning.page;
      // Fold around the spine: width shrinks to nothing, the back swings off.
      page.scale.x = Math.cos(e * Math.PI);
      page.skew.y = -Math.sin(e * Math.PI) * 0.12; // lifts the free edge like curling paper
      page.content.visible = page.scale.x > 0;
      this.current.shadow.alpha = 0.35 * (1 - e);
    }
  }

  onKey(e) {
    if (e.key === "p" || e.key === "P") this.pause.toggle();
    else if (Clock.paused) this.pause.onKey(e);
    else if (e.key === "Escape" || e.key === "s" || e.key === "S") Scenes.go("game");
    else this.next();
  }
}

// Small text button; `underlineFirst` underlines the first letter (its key).
function makeButton(label, onTap, underlineFirst = false) {
  const btn = new PIXI.Container();
  const text = new PIXI.Text({ text: label, style: { fontFamily: CONFIG.FONT, fontSize: 22, fontWeight: "bold", fill: CONFIG.INK } });
  text.position.set(14, 6);
  const bg = new PIXI.Graphics().roundRect(0, 0, text.width + 28, text.height + 12, 8).fill(CONFIG.PAPER).stroke({ width: 3, color: CONFIG.INK });
  btn.addChild(bg, text);
  if (underlineFirst) {
    const w = PIXI.CanvasTextMetrics.measureText(label[0], text.style).width;
    btn.addChild(new PIXI.Graphics().rect(text.x, text.y + text.height - 3, w, 2.5).fill(CONFIG.INK));
  }
  btn.eventMode = "static";
  btn.cursor = "pointer";
  btn.on("pointertap", (e) => {
    e.stopPropagation();
    onTap();
  });
  return btn;
}
