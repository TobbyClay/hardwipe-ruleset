import { planWallWear } from "./hardwipe-wall-wear.js";

const ID = "hardwipe-ruleset";
const copy = value => foundry.utils.deepClone(value);
const replace = value => foundry.data.operators.ForcedReplacement.create(value);
const marker = { hardwipeWallWear: true };
const dataOf = document => document.toObject();
export function wallWearDataEqual(a, b) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter(k => k !== "_stats")
      .sort().map(k => [k, stable(value[k])]));
    return value;
  };
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** Native optical walls and vision-aware surface Tiles. The parent remains physical cover. */
export class WallAppearance {
  static _initialized = false;

  static initialize({ enqueue, report }) {
    if (this._initialized) return;
    this._initialized = true;
    const activeGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
    const rebuild = (wall, changes = {}) => {
      if (!activeGM() || !wall.getFlag(ID, "cover")?.wear || wall.getFlag(ID, "wallWear")) return;
      void enqueue(async () => {
        if (!wall.parent.walls.has(wall.id)) return;
        const material = copy(wall.getFlag(ID, "cover"));
        for (const key of ["sight", "light"]) if (key in changes) material.wear.restrictions[key] = wall[key];
        if ("c" in changes && material.wear.coordinates) this.reanchor(material, material.wear.coordinates, wall.c);
        const plan = this.plan(wall.parent, wall.toObject(), material);
        await foundry.documents.modifyBatch(this.operations(wall.parent, plan));
      }).catch(report);
    };
    Hooks.on("updateWall", (wall, changes, options) => {
      if (options.hardwipeWallWear || wall.getFlag(ID, "wallWear")) return;
      if (["c", "dir", "door", "ds", "levels", "threshold", "sight", "light", "move", "sound"].some(k => k in changes)) {
        rebuild(wall, changes);
      }
    });
    Hooks.on("deleteWall", (wall, options) => {
      if (options.hardwipeWallWear || !activeGM() || wall.getFlag(ID, "wallWear")) return;
      void enqueue(async () => {
        const owned = this.owned(wall.parent, wall.id);
        const operations = this.removeOperations(wall.parent, owned);
        if (operations.length) await foundry.documents.modifyBatch(operations);
      }).catch(report);
    });
    Hooks.on("canvasReady", () => {
      this.refreshVisibility();
      if (!activeGM()) return;
      void enqueue(async () => {
        const scene = canvas.scene;
        if (!scene) return;
        const orphaned = {
          walls: scene.walls.contents.filter(w => w.getFlag(ID, "wallWear") && !scene.walls.has(w.getFlag(ID, "wallWear").parentId)).map(dataOf),
          tiles: scene.tiles.contents.filter(t => t.getFlag(ID, "wallWear") && !scene.walls.has(t.getFlag(ID, "wallWear").parentId)).map(dataOf)
        };
        const operations = this.removeOperations(scene, orphaned);
        if (operations.length) await foundry.documents.modifyBatch(operations);
        for (const wall of scene.walls.contents) {
          if (wall.getFlag(ID, "cover")?.wear && !wall.getFlag(ID, "wallWear")) {
            const material = copy(wall.getFlag(ID, "cover"));
            // Leave IDs and undo snapshots stable across reloads and scene switches.
            if (wallWearDataEqual(material.wear.parent, this.parentState(wall.toObject()))) continue;
            if (material.wear.coordinates && !wallWearDataEqual(material.wear.coordinates, wall.c)) this.reanchor(material, material.wear.coordinates, wall.c);
            await foundry.documents.modifyBatch(this.operations(scene, this.plan(scene, wall.toObject(), material)));
          }
        }
      }).catch(report);
    });
    Hooks.on("refreshTile", tile => this.refreshTile(tile));
    Hooks.on("visibilityRefresh", () => this.refreshVisibility());
    Hooks.on("sightRefresh", () => this.refreshVisibility());
  }

  static refreshVisibility() {
    for (const tile of canvas.tiles?.placeables ?? []) this.refreshTile(tile);
  }

  static refreshTile(tile) {
    if (tile.document.getFlag(ID, "wallWear")?.kind !== "scar") return;
    const point = { x: tile.document.x, y: tile.document.y, elevation: tile.document.elevation };
    const visible = tile.isVisible && tile.document.viewed && (game.user.isGM || canvas.scene?.tokenVision === false
      || canvas.visibility?.testVisibility(point, { tolerance: 2, object: tile }));
    tile.visible = Boolean(visible);
    if (tile.mesh) tile.mesh.visible = Boolean(visible);
  }

  static owned(scene, parentId) {
    return {
      walls: scene.walls.contents.filter(w => w.getFlag(ID, "wallWear")?.parentId === parentId).map(dataOf),
      tiles: scene.tiles.contents.filter(t => t.getFlag(ID, "wallWear")?.parentId === parentId).map(dataOf)
    };
  }

  static reanchor(cover, from, to) {
    const oldLength = Math.hypot(from[2] - from[0], from[3] - from[1]);
    const newLength = Math.hypot(to[2] - to[0], to[3] - to[1]);
    if (!oldLength || !newLength) return;
    const a = { x: (from[2] - from[0]) / oldLength, y: (from[3] - from[1]) / oldLength };
    const b = { x: (to[2] - to[0]) / newLength, y: (to[3] - to[1]) / newLength };
    const transform = point => {
      const along = (point.x - from[0]) * a.x + (point.y - from[1]) * a.y;
      return { x: to[0] + along * b.x, y: to[1] + along * b.y };
    };
    if (cover.sectionOrigin) cover.sectionOrigin = transform(cover.sectionOrigin);
    cover.sectionDirection = b;
    for (const section of Object.values(cover.sections ?? {})) if (section.impact) section.impact = transform(section.impact);
  }

  static parentState(data) {
    return Object.fromEntries(["c", "dir", "door", "ds", "levels", "threshold", "sight", "light", "move", "sound"].map(key => [key, copy(data[key])]));
  }

  static base(data, cover) {
    const base = copy(data);
    if (cover.wear?.restrictions) Object.assign(base, copy(cover.wear.restrictions));
    return base;
  }

  static assertOwnedUnchanged(owned, cover) {
    for (const name of ["walls", "tiles"]) {
      const expected = cover.wear?.[name];
      if (!expected) continue;
      if (expected.length !== owned[name].length || expected.some(data => !owned[name].some(current => wallWearDataEqual(current, data)))) {
        throw new Error("A wall damage visual was edited. Reconfigure its parent wall before applying more damage.");
      }
    }
  }

  static plan(scene, data, material, { reset = false } = {}) {
    const cover = copy(material);
    const owned = this.owned(scene, data._id);
    if (!reset) this.assertOwnedUnchanged(owned, material);
    const base = this.base(data, material);
    const layout = planWallWear(base, cover, scene);
    const wall = copy(base);
    const walls = [], tiles = [];
    const open = Number(base.door) > 0 && Number(base.ds) === CONST.WALL_DOOR_STATES.OPEN;
    const optics = layout.gaps.length && (Number(base.sight) > 0 || Number(base.light) > 0);
    if (optics) {
      wall.sight = 0;
      wall.light = 0;
      for (const c of layout.solid) {
        const child = copy(base);
        child._id = foundry.utils.randomID();
        Object.assign(child, { c, move: 0, sound: 0, door: 0, ds: 0,
          sight: open ? 0 : base.sight, light: open ? 0 : base.light });
        child.flags = { ...copy(base.flags), [ID]: { cover: { ballistic: false }, wallWear: { parentId: data._id, kind: "optical" } } };
        walls.push(new CONFIG.Wall.documentClass(child, { parent: scene }).toObject());
      }
    }
    const style = ["glass", "light", "concrete", "reinforced"].includes(cover.material) ? cover.material : "concrete";
    for (const scar of layout.scars) {
      const width = Math.max(6, Math.round(scar.length * (0.32 + scar.stage * 0.12)));
      const height = Math.max(6, Math.round(Math.min(scar.length, cover.sectionPixels || scar.length) * (0.1 + scar.stage * 0.045)));
      const levels = base.levels instanceof Set ? [...base.levels] : base.levels ?? [];
      const elevations = levels.map(id => scene.levels?.get(id)?.bottom).filter(Number.isFinite);
      tiles.push(new CONFIG.Tile.documentClass({
        _id: foundry.utils.randomID(), name: "Wall surface damage", x: Math.round(scar.center.x), y: Math.round(scar.center.y),
        width, height, rotation: scar.rotation * 180 / Math.PI, alpha: open ? 0 : 0.85,
        levels, elevation: elevations.length ? Math.min(...elevations) : 0, sort: 10, locked: true,
        texture: { src: `modules/${ID}/assets/walls/${style}-${scar.stage}.svg`, anchorX: 0.5, anchorY: 0.5 },
        restrictions: { light: false, weather: false }, occlusion: { modes: [], alpha: 0 },
        flags: { [ID]: { wallWear: { parentId: data._id, kind: "scar", section: scar.key, stage: scar.stage } } }
      }, { parent: scene }).toObject());
    }
    // Keep the original restrictions even while the physical parent is sight-through.
    if (walls.length || tiles.length) cover.wear = { coordinates: copy(base.c), parent: this.parentState(wall), restrictions: { sight: base.sight, light: base.light }, walls: copy(walls), tiles: copy(tiles) };
    else delete cover.wear;
    wall.flags ??= {};
    wall.flags[ID] ??= {};
    wall.flags[ID].cover = cover;
    return { before: { walls: [copy(data), ...owned.walls], tiles: owned.tiles }, after: { walls: [wall, ...walls], tiles } };
  }

  static removeOperations(scene, owned) {
    const operations = [];
    for (const [name, type] of [["walls", "Wall"], ["tiles", "Tile"]]) {
      if (owned[name].length) operations.push({ action: "delete", documentName: type, parent: scene, ids: owned[name].map(d => d._id), ...marker });
    }
    return operations;
  }

  static operations(scene, plan) {
    const operations = [];
    for (const [name, type] of [["walls", "Wall"], ["tiles", "Tile"]]) {
      const before = plan.before[name], after = plan.after[name];
      const ids = new Set(before.map(d => d._id));
      const keep = new Set(after.map(d => d._id));
      const removed = before.filter(d => !keep.has(d._id)).map(d => d._id);
      if (removed.length) operations.push({ action: "delete", documentName: type, parent: scene, ids: removed, ...marker });
      const added = after.filter(d => !ids.has(d._id));
      if (added.length) operations.push({ action: "create", documentName: type, parent: scene, data: added, keepId: true, ...marker });
      const updated = after.filter(d => ids.has(d._id)).map(d => ({ ...copy(d), flags: replace(d.flags) }));
      if (updated.length) operations.push({ action: "update", documentName: type, parent: scene, updates: updated, ...marker });
    }
    return operations;
  }
}
