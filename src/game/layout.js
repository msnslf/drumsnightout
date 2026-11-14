// Stage geometry, plus the transitions' choreography (Layout.state).

const HUD_H = 56;
const FLOOR_Y = HUD_H + (CONFIG.HEIGHT - HUD_H) * 0.925 + 5;

const Layout = {
  drums: { floorY: FLOOR_Y, scale: 1.7 },
  danceTop: { x: CONFIG.WIDTH / 2, y: 110 }, // centre of the dance lanes' top edge
  danceTopWidth: 1 / 8, // lane width at the top, as a fraction of the width at the hit line
  clefHomeY: 81,
  lanes: { top: 110, bottom: FLOOR_Y - 205 }, // bowling lanes, ending just above the drums

  // Hit line: its circles' bottoms sit just above the drums' heads.
  get hitY() {
    return this.drums.floorY - 230 - this.hitRadius - this.hitHalf;
  },
  hitHalf: 4, // half the hit line's thickness
  // Circle framing a letter on the hit line, in proportion to the letter.
  get hitRadius() {
    return 23 * CONFIG.HIT_CUE_SCALE;
  },
  // How far up a lane (0..1) a letter is `ahead` beats early, in perspective.
  beatS(ahead) {
    const w = this.danceTopWidth, depth = (CONFIG.PATTERN_LOOKAHEAD_BEATS * w) / (1 - w);
    return ahead / (ahead + depth) / (1 - w);
  },
  // Mask hiding everything above `top`, so things slide in from there.
  clip(top) {
    return new PIXI.Graphics().rect(0, top, CONFIG.WIDTH, CONFIG.HEIGHT - top).fill(CONFIG.INK);
  },
  get countY() {
    return (this.danceTop.y + this.hitY) / 2;
  },

  // ---- the choreography ----
  state(phase) {
    const b = phase.progress * 4;
    const seg = (a, z) => ease((b - a) / (z - a));
    const lin = (a, z) => clamp01((b - a) / (z - a));
    switch (phase.name) {
      case "toBowl":
        return { spread: seg(0, 1.5), clef: lin(1.5, 3), bowlUI: seg(3, 4) };
      case "bowl":
        return { spread: 1, clef: 1, bowlUI: 1 };
      case "toDance": {
        const spread = 1 - seg(1.25, 2.5);
        return { spread, clef: 0, bowlUI: 1 - seg(1, 1.75) };
      }
      default: // countoff, dance
        return { spread: 0, clef: 0, bowlUI: 0 };
    }
  },

  // ---- lines (i = 0..4, left to right) ----
  lineX(i) {
    return (CONFIG.WIDTH * (i + 0.5)) / 5;
  },
  lineTop(i, spread) {
    const x = lerp(this.danceTop.x, this.lineX(i), this.danceTopWidth);
    return { x: lerp(x, this.lineX(i), spread), y: lerp(this.danceTop.y, this.lanes.top, spread) };
  },
  lineBottom(i, spread) {
    return { x: this.lineX(i), y: lerp(this.hitY, this.lanes.bottom, spread) };
  },
  // Point on line i, s of the way from its bottom (0) to its top (1).
  linePoint(i, s, spread) {
    const a = this.lineBottom(i, spread), b = this.lineTop(i, spread);
    return { x: lerp(a.x, b.x, s), y: lerp(a.y, b.y, s) };
  },
  // Centre of lane i, s of the way from its bottom (0) to its top (1).
  lanePoint(i, s, spread) {
    const l = this.linePoint(i, s, spread), r = this.linePoint(i + 1, s, spread);
    return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  },
  lane(i) {
    const left = this.lineX(i), right = this.lineX(i + 1);
    return { left, right, top: this.lanes.top, bottom: this.lanes.bottom, centerX: (left + right) / 2, width: right - left };
  },
  drumX(i) {
    return (CONFIG.WIDTH * (i + 1)) / 5;
  },
  // Lane whose hit circle contains stage point p, or -1.
  circleAt(p) {
    return [0, 1, 2, 3].findIndex((i) => Math.hypot(p.x - this.drumX(i), p.y - this.hitY) <= this.hitRadius + this.hitHalf);
  },

  // ---- clef / pin machine ----
  // Pin spots in lane i, in clef visiting order: back row first, snaking.
  pins(i) {
    const lane = this.lane(i), out = [];
    [3, 2, 1].forEach((count, k) => {
      for (let j = 0; j < count; j++) {
        const col = k % 2 ? count - 1 - j : j;
        out.push({ x: lane.centerX + (col - (count - 1) / 2) * lane.width * 0.26, y: lane.top + 56 + k * 32, order: i * 6 + out.length });
      }
    });
    return out;
  },
  // Clef route: home, every pin spot of every lane, home.
  get clefPath() {
    const home = { x: this.danceTop.x, y: this.clefHomeY };
    return [home, ...[0, 1, 2, 3].flatMap((i) => this.pins(i)), home];
  },
  // 0..1: how far the pin with this `order` has been deposited.
  pinDrop(order, st) {
    const legs = this.clefPath.length - 1;
    return clamp01(st.clef * legs - (order + 1));
  },
};

// Draws the lines and the hit line.
class StaffView {
  constructor() {
    this.gfx = new PIXI.Graphics();
  }

  update(st) {
    const g = this.gfx;
    const ink = CONFIG.INK;
    g.clear();
    for (let i = 0; i < 5; i++) {
      const a = Layout.lineTop(i, st.spread), b = Layout.lineBottom(i, st.spread);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: ink });
    }
    // Hit line: fades out as the lanes open.
    if (st.spread < 1) {
      // Broken at each lane's centre by an empty circle.
      const y = Layout.hitY, h = Layout.hitHalf, R = Layout.hitRadius, alpha = 1 - st.spread;
      let x = Layout.lineX(0) - 18;
      for (let i = 0; i < 4; i++) {
        const cx = Layout.drumX(i);
        g.rect(x, y - h, cx - R - x, 2 * h).fill({ color: ink, alpha });
        g.circle(cx, y, R).stroke({ width: 2 * h, color: ink, alpha });
        x = cx + R;
      }
      g.rect(x, y - h, Layout.lineX(4) + 18 - x, 2 * h).fill({ color: ink, alpha });
      // Faint guides 0.5, 1, 1.5 and 2 beats before the hit (halves dashed).
      for (const ahead of [0.5, 1, 1.5, 2]) {
        const s = Layout.beatS(ahead);
        const at = (i) => Layout.linePoint(i, s, st.spread);
        const a = at(0), z = at(4), dashes = ahead % 1 ? 40 : 1;
        for (let k = 0; k < dashes; k++) {
          const t0 = k / dashes, t1 = dashes > 1 ? (k + 0.5) / dashes : 1;
          g.moveTo(lerp(a.x, z.x, t0), lerp(a.y, z.y, t0)).lineTo(lerp(a.x, z.x, t1), lerp(a.y, z.y, t1));
        }
        g.stroke({ width: 2, color: ink, alpha: 0.2 * (1 - st.spread) });
      }
    }
  }
}
