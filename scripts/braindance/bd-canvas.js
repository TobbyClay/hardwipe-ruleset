/**
 * Braindance clues on the canvas, and picking a point for a scan or a new clue.
 *
 * Participants see traces of unfound clues on their current layer (a visual outline, audio ripples or a
 * thermal bloom) and the label of every found clue. GMs see every clue with its layer while a memory runs
 * or the console is open. Nothing here writes documents; scans and placement go through the caller.
 */
import { LAYERS } from "./bd-state.js";

const hex = rgb => rgb.split(",").reduce((value, part) => (value << 8) + Number(part), 0);

export class ClueCanvas {
  /**
   * @param {object} deps
   * @param {Function} deps.entries   () -> [{ id, x, y, layer, radius, found, label }] to draw on this client
   * @param {Function} deps.still     () -> boolean (reduced motion)
   */
  constructor({ entries, still }) {
    Object.assign(this, { entries, still });
    this.container = null;
    this.items = [];
    this.picking = null;
    this.ticker = null;
    this.phase = 0;
  }

  draw() {
    this.destroyGraphics();
    if (!canvas?.ready || !canvas.interface) return;
    const entries = this.entries();
    if (!entries.length) return;
    const container = new PIXI.Container();
    container.name = "hardwipe-braindance-clues";
    container.eventMode = "none";
    for (const clue of entries) {
      const color = hex(LAYERS[clue.layer].color);
      const node = new PIXI.Container();
      node.position.set(clue.x, clue.y);
      const graphics = new PIXI.Graphics();
      node.addChild(graphics);
      if (clue.found || clue.gm) {
        const label = new PIXI.Text(`${LAYERS[clue.layer].symbol} ${clue.label}`.trim(), {
          fontFamily: "Rajdhani, Bahnschrift, sans-serif", fontSize: 22, fontWeight: "600", fill: color,
          stroke: 0x05080a, strokeThickness: 4, letterSpacing: 1
        });
        label.anchor.set(0.5, 0);
        label.position.set(0, Math.min(clue.radius, 60) + 6);
        label.alpha = clue.found ? 1 : 0.8;
        node.addChild(label);
      }
      container.addChild(node);
      this.items.push({ clue, color, graphics });
    }
    canvas.interface.addChild(container);
    this.container = container;
    this.paint();
    if (!this.still()) {
      this.ticker = delta => { this.phase = (this.phase + delta / 90) % 1; this.paint(); };
      canvas.app.ticker.add(this.ticker);
    }
  }

  paint() {
    const still = this.still();
    for (const { clue, color, graphics } of this.items) {
      graphics.clear();
      const r = clue.radius;
      if (clue.found) {
        graphics.lineStyle(3, color, 0.95).drawCircle(0, 0, Math.min(r, 60) * 0.45);
        graphics.beginFill(color, 0.35).drawCircle(0, 0, 7).endFill();
        continue;
      }
      const dashed = clue.gm && !clue.trace;
      if (clue.layer === "audio") {
        for (let ring = 0; ring < 3; ring++) {
          const t = still ? ring / 3 : (this.phase + ring / 3) % 1;
          graphics.lineStyle(3, 0x05080a, (dashed ? 0.25 : 0.45) * (1 - t)).drawCircle(0, 0, r * (0.25 + 0.75 * t));
          graphics.lineStyle(2, color, (dashed ? 0.5 : 0.95) * (1 - t)).drawCircle(0, 0, r * (0.25 + 0.75 * t));
        }
      } else if (clue.layer === "thermal") {
        const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(this.phase * Math.PI * 2);
        for (let band = 4; band >= 1; band--) graphics.beginFill(color, (dashed ? 0.07 : 0.12) + 0.06 * pulse).drawCircle(0, 0, r * band / 4).endFill();
      } else {
        const alpha = still ? 0.85 : 0.55 + 0.4 * Math.sin(this.phase * Math.PI * 2) ** 2;
        const s = r * 0.55;
        graphics.lineStyle(4, 0x05080a, (dashed ? 0.3 : alpha) * 0.5).drawPolygon([0, -s, s, 0, 0, s, -s, 0]);
        graphics.lineStyle(2, color, dashed ? 0.5 : alpha).drawPolygon([0, -s, s, 0, 0, s, -s, 0]);
        graphics.lineStyle(1, color, (dashed ? 0.3 : alpha) * 0.6).drawCircle(0, 0, r);
      }
    }
  }

  /** A short ring where a scan landed. */
  ping(point, layer, found) {
    if (!canvas?.ready || !canvas.interface) return;
    const color = hex(LAYERS[layer]?.color ?? LAYERS.visual.color);
    const ring = new PIXI.Graphics();
    ring.position.set(point.x, point.y);
    ring.eventMode = "none";
    canvas.interface.addChild(ring);
    const size = canvas.dimensions.size;
    let age = 0;
    const step = delta => {
      age += delta / 60;
      ring.clear().lineStyle(3, found ? color : 0x8899a0, Math.max(0, 1 - age)).drawCircle(0, 0, size * (0.3 + age));
      if (age >= 1 || this.still()) { canvas.app.ticker.remove(step); ring.destroy(); }
    };
    canvas.app.ticker.add(step);
    step(0);
  }

  /** The next left click on the canvas, in scene coordinates; null on right click or Escape. */
  pick() {
    this.cancelPick();
    if (!canvas?.ready) return Promise.resolve(null);
    return new Promise(resolve => {
      const view = canvas.app.view;
      const finish = point => {
        canvas.stage.off("pointerdown", onPointer);
        window.removeEventListener("keydown", onKey, true);
        view.classList.remove("hardwipe-bd-picking");
        this.picking = null;
        resolve(point);
      };
      const onPointer = event => {
        if (event.button === 2) return finish(null);
        if (event.button !== 0) return;
        event.stopPropagation();
        const point = event.getLocalPosition(canvas.stage);
        finish({ x: Math.round(point.x), y: Math.round(point.y) });
      };
      const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); finish(null); } };
      canvas.stage.on("pointerdown", onPointer);
      window.addEventListener("keydown", onKey, true);
      view.classList.add("hardwipe-bd-picking");
      this.picking = { cancel: () => finish(null) };
    });
  }

  cancelPick() { this.picking?.cancel(); }
  get isPicking() { return Boolean(this.picking); }

  destroyGraphics() {
    if (this.ticker) canvas?.app?.ticker?.remove(this.ticker);
    this.ticker = null;
    this.items = [];
    if (this.container && !this.container.destroyed) this.container.destroy({ children: true });
    this.container = null;
  }
}
