import test from "node:test";
import assert from "node:assert/strict";
import { clearsWall, elevationAlong, elevationChanged, heightCover, wallStopsLine, wallTop } from "../scripts/hardwipe-wall-height.js";
import { findFirstWallIntersection } from "../scripts/hardwipe-cover-geometry.js";
import { WallTypes } from "../scripts/hardwipe-wall-types.js";

const ID = "hardwipe-ruleset";

test("a wall without a usable height is full height", () => {
  assert.equal(wallTop(undefined), Infinity);
  assert.equal(wallTop({}), Infinity);
  assert.equal(wallTop({ height: 0 }), Infinity);
  assert.equal(wallTop({ height: -2 }), Infinity);
  assert.equal(wallTop({ height: "tall" }), Infinity);
  assert.equal(wallTop({ height: "4" }), 4);
  assert.equal(wallTop({ height: 12.5 }), 12.5);
});

test("only a point strictly above the top clears a wall", () => {
  assert.equal(clearsWall(4, 4.5), true);
  assert.equal(clearsWall(4, 4), false);
  assert.equal(clearsWall(4, 2.5), false);
  assert.equal(clearsWall(Infinity, 1000), false);
  assert.equal(clearsWall(4, undefined), false);
  assert.equal(clearsWall(4, NaN), false);
});

test("a line's elevation interpolates between its ends", () => {
  assert.equal(elevationAlong(10, 0, 0.5), 5);
  assert.equal(elevationAlong(10, 0, 0), 10);
  assert.equal(elevationAlong(10, 0, 1), 0);
  assert.equal(elevationAlong(10, 0, 2), 0);
  assert.equal(elevationAlong(undefined, 6, 0.5), 3);
});

test("a rooftop shot passes over a low wall near the shooter and is stopped near the target", () => {
  // Shooter's eye line at 10 ft, target's at 2.5 ft: the line is above a 4 ft wall until 80% of the way.
  assert.equal(wallStopsLine(4, 10, 2.5, 0.3), false);
  assert.equal(wallStopsLine(4, 10, 2.5, 0.9), true);
  assert.equal(wallStopsLine(Infinity, 10, 2.5, 0.3), true);
  assert.equal(wallStopsLine(4, 2.5, 2.5, 0.5), true);
});

test("the first blocking wall skips walls the shot clears", () => {
  const walls = [
    { id: "low", c: [100, -50, 100, 50], top: 4 },
    { id: "back", c: [200, -50, 200, 50], top: Infinity }
  ];
  const origin = { x: 0, y: 0 };
  const target = { x: 300, y: 0 };
  const from = (fromElevation, toElevation) => findFirstWallIntersection(origin, target, walls, {
    clears: (wall, hit) => !wallStopsLine(wall.top, fromElevation, toElevation, hit.t)
  });
  assert.equal(from(2.5, 2.5)?.wallId, "low");
  // At x = 100 (a third of the way) the line from 10 ft down to 2.5 ft is still at 7.5 ft.
  assert.equal(from(10, 2.5)?.wallId, "back");
  assert.equal(from(10, 10)?.wallId, "back");
  assert.equal(findFirstWallIntersection(origin, target, walls)?.wallId, "low");
});

test("a damage helper borrows its parent's height", () => {
  const parent = { id: "p", flags: { [ID]: { cover: { height: 4 } } } };
  const walls = new Map([[parent.id, parent]]);
  assert.equal(wallTop(heightCover({ wallWear: { parentId: "p" } }, id => walls.get(id))), 4);
  assert.equal(wallTop(heightCover({ wallWear: { parentId: "gone" } }, id => walls.get(id))), Infinity);
  assert.equal(wallTop(heightCover({ cover: { height: 6 } })), 6);
  assert.equal(heightCover(undefined), null);
});

test("a changed eye line after the shot counts as a move; records without one never do", () => {
  assert.equal(elevationChanged(2.5, 2.5), false);
  assert.equal(elevationChanged("2.5", 2.5), false);
  assert.equal(elevationChanged(2.5, 12.5), true);
  assert.equal(elevationChanged(12.5, 2.5), true);
  assert.equal(elevationChanged(undefined, 12.5), false);
  assert.equal(elevationChanged(null, 12.5), false);
});

test("wall types carry a top height, 0 meaning full height", () => {
  const base = { id: "t", name: "Test", material: "concrete", max: 10 };
  assert.equal(WallTypes.validate(base).height, 0);
  assert.equal(WallTypes.validate({ ...base, height: "" }).height, 0);
  assert.equal(WallTypes.validate({ ...base, height: "4" }).height, 4);
  assert.throws(() => WallTypes.validate({ ...base, height: -1 }), /Top height/);
  assert.throws(() => WallTypes.validate({ ...base, height: "x" }), /Top height/);
});
