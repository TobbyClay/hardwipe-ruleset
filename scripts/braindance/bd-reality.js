/**
 * "Memory isn't reality": what a braindance changes in Hardwipe's world state is rolled back on Disconnect.
 *
 * At Enter memory the GM records every scene's Hardwipe wall state (cover walls, their optical children and
 * damage Tiles) and the scene flags that go with it (Mission Heat, wall undo history, damage ledger). On
 * Disconnect the difference between that record and the scene is planned here, as plain data, and applied
 * by the caller in one atomic batch per scene. Walls and Tiles without Hardwipe data are never touched.
 */
import { MODULE_ID } from "./bd-state.js";

export const SCENE_FLAGS = Object.freeze(["heat", "coverHistory", "coverDamageLedger"]);

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).filter(key => key !== "_stats").sort()
    .map(key => [key, stable(value[key])]));
  return value;
};
export const sameData = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const own = data => data?.flags?.[MODULE_ID] ?? {};

export const isRealityWall = data => Boolean(own(data).cover || own(data).wallWear);
export const isRealityTile = data => Boolean(own(data).wallWear);

/**
 * One scene's record: plain wall and Tile data plus the Hardwipe scene flags. Every scene gets one, even an
 * empty one, so Heat started or cover walls damaged there during the memory are rolled back too.
 */
export function sceneSnapshot({ id, walls = [], tiles = [], flags = {} }) {
  return {
    sceneId: id,
    walls: walls.filter(isRealityWall).map(data => structuredClone(data)),
    tiles: tiles.filter(isRealityTile).map(data => structuredClone(data)),
    flags: Object.fromEntries(SCENE_FLAGS.map(key => [key, flags?.[MODULE_ID]?.[key] === undefined ? null : structuredClone(flags[MODULE_ID][key])]))
  };
}

function documentPlan(type, recorded, current) {
  const before = new Map(recorded.map(data => [data._id, data]));
  const now = new Map(current.map(data => [data._id, data]));
  const operations = [];
  const removed = [...now.keys()].filter(key => !before.has(key));
  if (removed.length) operations.push({ action: "delete", documentName: type, ids: removed });
  const missing = recorded.filter(data => !now.has(data._id));
  if (missing.length) operations.push({ action: "create", documentName: type, data: missing.map(data => structuredClone(data)), keepId: true });
  const changed = recorded.filter(data => now.has(data._id) && !sameData(now.get(data._id), data));
  if (changed.length) operations.push({ action: "update", documentName: type, updates: changed.map(data => structuredClone(data)), replaceFlags: true });
  return operations;
}

/**
 * What it takes to put a scene back: delete Hardwipe walls and Tiles made since (breach remainders, new damage),
 * recreate the ones removed (a breached wall), and rewrite the ones that changed (section HP, holes). Scene flags
 * return to their recorded values; null means the flag did not exist and is removed.
 */
export function rollbackPlan(record, scene) {
  const walls = documentPlan("Wall", record.walls, (scene.walls ?? []).filter(isRealityWall));
  const tiles = documentPlan("Tile", record.tiles, (scene.tiles ?? []).filter(isRealityTile));
  // Walls first: a recreated parent wall must exist before its damage Tiles are compared against it.
  const operations = [...walls, ...tiles];
  const flags = {};
  for (const key of SCENE_FLAGS) {
    const current = scene.flags?.[MODULE_ID]?.[key] ?? null;
    if (!sameData(current, record.flags[key])) flags[key] = record.flags[key];
  }
  return { sceneId: record.sceneId, operations, flags, changed: operations.length > 0 || Object.keys(flags).length > 0 };
}
