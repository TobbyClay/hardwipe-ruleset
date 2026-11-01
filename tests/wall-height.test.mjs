import test from "node:test";
import assert from "node:assert/strict";
import { bandOfWall, elevationAlong, elevationChanged, levelRange, wallBand, wallStopsLine } from "../scripts/hardwipe-wall-height.js";
import { findFirstWallIntersection } from "../scripts/hardwipe-cover-geometry.js";
import { WallTypes } from "../scripts/hardwipe-wall-types.js";

const ranges = { ground: { bottom: 0, top: 20 }, upper: { bottom: 20, top: 40 }, roof: { bottom: 40, top: null } };
const rangeOf = id => ranges[id] ? levelRange(ranges[id]) : null;

test("a level's range reads Foundry's elevation; an open end is infinite", () => {
  assert.deepEqual(levelRange({ elevation: { bottom: 0, top: 20 } }), { bottom: 0, top: 20 });
  assert.deepEqual(levelRange({ elevation: { bottom: null, top: null } }), { bottom: -Infinity, top: Infinity });
  assert.deepEqual(levelRange({ elevation: { bottom: -Infinity, top: Infinity } }), { bottom: -Infinity, top: Infinity });
  assert.deepEqual(levelRange({ bottom: 5, top: "15" }), { bottom: 5, top: 15 });
  assert.deepEqual(levelRange(undefined), { bottom: -Infinity, top: Infinity });
});

test("a wall stands from the lowest bottom to the highest top of its levels; no level is full height", () => {
  assert.deepEqual(wallBand(["ground"], rangeOf), { bottom: 0, top: 20 });
  assert.deepEqual(wallBand(new Set(["ground", "upper"]), rangeOf), { bottom: 0, top: 40 });
  assert.deepEqual(wallBand(["upper", "roof"], rangeOf), { bottom: 20, top: Infinity });
  assert.deepEqual(wallBand([], rangeOf), { bottom: -Infinity, top: Infinity });
  assert.deepEqual(wallBand(undefined, rangeOf), { bottom: -Infinity, top: Infinity });
  assert.deepEqual(wallBand(["gone"], rangeOf), { bottom: -Infinity, top: Infinity });
});

test("a wall document's band comes from its scene's levels", () => {
  const scene = { levels: new Map([["ground", { elevation: { bottom: 0, top: 20 } }]]) };
  assert.deepEqual(bandOfWall({ levels: new Set(["ground"]), parent: scene }), { bottom: 0, top: 20 });
  assert.deepEqual(bandOfWall({ levels: ["ground"] }, scene), { bottom: 0, top: 20 });
  assert.deepEqual(bandOfWall({ levels: new Set() }, scene), { bottom: -Infinity, top: Infinity });
});

test("a line's elevation interpolates between its ends", () => {
  assert.equal(elevationAlong(10, 0, 0.5), 5);
  assert.equal(elevationAlong(10, 0, 0), 10);
  assert.equal(elevationAlong(10, 0, 1), 0);
  assert.equal(elevationAlong(10, 0, 2), 0);
  assert.equal(elevationAlong(undefined, 6, 0.5), 3);
});

test("a wall stops a line only where it crosses inside the wall's band, ends included", () => {
  const ground = { bottom: 0, top: 20 };
  // A drone's eye line at 30 ft down to a target's at 2.5 ft: above the 20 ft top until about 40% of the way.
  assert.equal(wallStopsLine(ground, 30, 2.5, 0.2), false);
  assert.equal(wallStopsLine(ground, 30, 2.5, 0.9), true);
  assert.equal(wallStopsLine(ground, 2.5, 2.5, 0.5), true);
  assert.equal(wallStopsLine(ground, 20, 20, 0.5), true);
  assert.equal(wallStopsLine({ bottom: 20, top: 40 }, 2.5, 2.5, 0.5), false);
  assert.equal(wallStopsLine({ bottom: -Infinity, top: Infinity }, 1000, 1000, 0.5), true);
  assert.equal(wallStopsLine(undefined, 1000, 1000, 0.5), true);
});

test("the first blocking wall skips walls the shot passes over", () => {
  const walls = [
    { id: "ground", c: [100, -50, 100, 50], band: { bottom: 0, top: 20 } },
    { id: "tower", c: [200, -50, 200, 50], band: { bottom: -Infinity, top: Infinity } }
  ];
  const origin = { x: 0, y: 0 };
  const target = { x: 300, y: 0 };
  const from = (fromElevation, toElevation) => findFirstWallIntersection(origin, target, walls, {
    clears: (wall, hit) => !wallStopsLine(wall.band, fromElevation, toElevation, hit.t)
  });
  assert.equal(from(2.5, 2.5)?.wallId, "ground");
  // At x = 100 (a third of the way) the line from 32.5 ft down to 2.5 ft is still at 22.5 ft.
  assert.equal(from(32.5, 2.5)?.wallId, "tower");
  assert.equal(from(30, 30)?.wallId, "tower");
  assert.equal(findFirstWallIntersection(origin, target, walls)?.wallId, "ground");
});

test("a changed eye line after the shot counts as a move; records without one never do", () => {
  assert.equal(elevationChanged(2.5, 2.5), false);
  assert.equal(elevationChanged("2.5", 2.5), false);
  assert.equal(elevationChanged(2.5, 12.5), true);
  assert.equal(elevationChanged(12.5, 2.5), true);
  assert.equal(elevationChanged(undefined, 12.5), false);
  assert.equal(elevationChanged(null, 12.5), false);
});

test("wall types have no height of their own; a 0.7.49 height is dropped", () => {
  const base = { id: "t", name: "Test", material: "concrete", max: 10 };
  assert.equal("height" in WallTypes.validate(base), false);
  assert.equal("height" in WallTypes.validate({ ...base, height: 4 }), false);
});
