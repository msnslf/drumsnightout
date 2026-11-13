// Option list for every menu: arrows/hover, Enter/click, ← → or drag sliders.

const SLIDER_W = 280, SLIDER_STEP = 0.05;

// Text in the game's font and ink; `extra` adds or overrides style.
const makeText = (text, size, weight = "bold", extra = {}) =>
  new PIXI.Text({ text, style: { fontFamily: CONFIG.FONT, fontSize: size, fontWeight: weight, fill: CONFIG.INK, ...extra } });

class Menu {
  // items: { label, onSelect } or 0..1 sliders { label, get, set, step? }
  constructor(items, { x = CONFIG.WIDTH / 2, y = 290, gap = 75, size = 40 } = {}) {
    this.items = items;
    this.choice = 0;
    this.view = new PIXI.Container();
    this.rows = items.map((item, i) => this._row(item, i, x, y + i * gap, gap, size));
    this.cursor = this.view.addChild(new PIXI.Graphics().poly([0, -16, 26, 0, 0, 16]).fill(CONFIG.INK));
  }

  _row(item, i, x, y, gap, size) {
    const row = this.view.addChild(new PIXI.Container());
    row.position.set(x, y);
    row.text = row.addChild(makeText("", size));
    row.text.anchor.set(item.get ? 1 : 0.5, 0.5);
    row.eventMode = "static";
    row.cursor = "pointer";
    row.hitArea = new PIXI.Rectangle(-CONFIG.WIDTH / 3, -gap / 2, (CONFIG.WIDTH * 2) / 3, gap);
    row.on("pointerover", () => (this.choice = i));
    row.on("pointertap", (e) => {
      e.stopPropagation();
      item.onSelect?.();
    });
    if (item.get) {
      row.text.x = -20;
      row.bar = row.addChild(new PIXI.Graphics());
      const drag = (e) => item.set(clamp01((row.toLocal(e.global).x - 20) / SLIDER_W));
      row.on("pointerdown", (e) => {
        if (row.toLocal(e.global).x < 10) return; // on the label
        row.dragging = true;
        drag(e);
      });
      row.on("globalpointermove", (e) => row.dragging && drag(e));
      row.on("pointerup", () => (row.dragging = false));
      row.on("pointerupoutside", () => (row.dragging = false));
    }
    return row;
  }

  update() {
    this.rows.forEach((row, i) => {
      const item = this.items[i];
      row.text.text = typeof item.label === "function" ? item.label() : item.label;
      row.scale.set(i === this.choice ? 1.1 : 1);
      if (!row.bar) return;
      const x = 20 + SLIDER_W * item.get(), h = 14;
      row.bar.clear()
        .rect(20, -h / 2, SLIDER_W, h).stroke({ width: 3, color: CONFIG.INK })
        .rect(20, -h / 2, x - 20, h).fill(CONFIG.INK)
        .circle(x, 0, 14).fill(CONFIG.PAPER).stroke({ width: 3, color: CONFIG.INK });
    });
    const row = this.rows[this.choice], s = row.scale.x;
    const left = row.bar ? (row.text.x - row.text.width) * s : (-row.text.width / 2) * s;
    this.cursor.position.set(row.x + left - 50, row.y);
  }

  onKey(e) {
    const n = this.items.length, item = this.items[this.choice];
    if (e.key === "ArrowUp") this.choice = (this.choice + n - 1) % n;
    else if (e.key === "ArrowDown") this.choice = (this.choice + 1) % n;
    else if (item.get && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const step = item.step ?? SLIDER_STEP;
      item.set(clamp01((Math.round(item.get() / step) + (e.key === "ArrowLeft" ? -1 : 1)) * step));
    }
    else if (e.key === "Enter" || e.key === " ") item.onSelect?.();
  }
}

// Small text button; `underlineFirst` underlines the first letter (its key).
function makeButton(label, onTap, underlineFirst = false) {
  const btn = new PIXI.Container();
  const text = makeText(label, 22);
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
