import test from "node:test";
import assert from "node:assert/strict";
import { areaWallDamageMultiplier, areaWallRemainders, areaWallSections, assessAreaWallDamage, exposedAreaWallSections, isPhysicalAreaWall } from "../scripts/hardwipe-area-wall-geometry.js";

const rectangle = (left, top, right, bottom, hole = false) => ({ points: [left, top, right, top, right, bottom, left, bottom], hole });
const region = (overrides = {}) => ({ origin: { x: 0, y: 0 }, damageMultiplier: 0.5, sourcePolygons: [rectangle(-100, -100, 500, 500)], ...overrides });
const wall = (id, c, overrides = {}) => ({ id, c, move: 1, sight: 1, flags: {}, ...overrides });
const expose = (walls, regions = [region()], overrides = {}) => exposedAreaWallSections({ walls, regions, sectionPixels: 100, ...overrides });

test("disabled Wall Effects never cause structural impacts with a saved damage mode", () => {
  assert.equal(areaWallDamageMultiplier({ enabled: false, wallsBlock: "damage-half" }), 0);
  assert.equal(areaWallDamageMultiplier({ enabled: false, wallsBlock: "damage-normal" }), 0);
  assert.equal(areaWallDamageMultiplier({ enabled: true, wallsBlock: "damage-half" }), 0.5);
  assert.equal(areaWallDamageMultiplier({ wallsBlock: "damage-normal" }), 1);
  assert.equal(areaWallDamageMultiplier({ wallsBlock: "recurse" }), 0);
  assert.deepEqual(expose([wall("front", [100, 0, 100, 100])], [region({ damageMultiplier: areaWallDamageMultiplier({ enabled: false, wallsBlock: "damage-normal" }) })]), []);
});

test("half damage rounds down before threshold; equal threshold qualifies before armor", () => {
  const concrete = { armor: 5, damageThreshold: 10 };
  assert.equal(assessAreaWallDamage(18, 0.5, concrete).applied, 0);
  assert.equal(assessAreaWallDamage(19, 0.5, concrete).rolled, 9);
  assert.equal(assessAreaWallDamage(20, 0.5, concrete).applied, 5);
  assert.equal(assessAreaWallDamage(30, 0.5, concrete).applied, 10);
  assert.equal(assessAreaWallDamage(30, 1, concrete).applied, 25);
  assert.throws(() => assessAreaWallDamage(30, 2, concrete));
});

test("area affects every exposed five-foot section on the front wall but none behind", () => {
  const hits = expose([wall("front", [100, -100, 100, 400]), wall("back", [200, -100, 200, 400])]);
  assert.deepEqual(hits.map(hit => `${hit.wallId}:${hit.section}`), ["front:0", "front:1", "front:2", "front:3", "front:4"]);
});

test("indestructible physical walls still occlude a destructible wall", () => {
  const hits = expose([wall("front", [100, -100, 100, 400]), wall("back", [200, -100, 200, 400], { flags: { "hardwipe-ruleset": { cover: { ballistic: true, max: 40 } } } })]);
  assert.ok(hits.every(hit => hit.wallId === "front"));
});

test("optical helpers are excluded and glimpse damage retains the physical parent's blockage", () => {
  const hits = expose([
    wall("physical", [100, -100, 100, 400], { sight: 0, flags: { "hardwipe-ruleset": { cover: { ballistic: true, max: 40 } } } }),
    wall("optical", [100, 100, 100, 150], { move: 0, flags: { "hardwipe-ruleset": { wallWear: { parentId: "physical", kind: "optical" }, cover: { ballistic: false } } } }),
    wall("back", [200, -100, 200, 400])
  ]);
  assert.ok(hits.every(hit => hit.wallId === "physical"));
});

test("open doors pass the blast, closed doors block it", () => {
  assert.ok(expose([wall("door", [100, -100, 100, 400], { door: 1, ds: 1 }), wall("back", [200, -100, 200, 400])]).every(hit => hit.wallId === "back"));
  assert.ok(expose([wall("door", [100, -100, 100, 400], { door: 1, ds: 0 }), wall("back", [200, -100, 200, 400])]).every(hit => hit.wallId === "door"));
});

test("explicit levels and elevation exclude unrelated physical walls", () => {
  assert.equal(isPhysicalAreaWall(wall("upper", [100, 0, 100, 100], { levels: ["upper"] }), region({ levels: ["lower"] })), false);
  assert.equal(isPhysicalAreaWall(wall("upper", [100, 0, 100, 100], { levels: ["upper"] }), region({ elevation: { bottom: 0, top: 5 } }), { upper: { bottom: 20, top: 30 } }), false);
  assert.equal(isPhysicalAreaWall(wall("same", [100, 0, 100, 100], { levels: ["lower"] }), region({ levels: ["lower"] })), true);
  const upper = wall("upper", [100, 0, 100, 100], { levels: ["upper"] });
  assert.equal(isPhysicalAreaWall(upper, region({ elevation: { bottom: 0, top: 20 } }), { upper: { bottom: 20, top: 30 } }), false);
  assert.equal(isPhysicalAreaWall(upper, region({ elevation: { bottom: 0, top: 20, topInclusive: true } }), { upper: { bottom: 20, top: 30 } }), true);
  assert.equal(isPhysicalAreaWall(upper, region({ elevation: { bottom: 20, top: 20 } }), { upper: { bottom: 20, top: 30 } }), true);
});

test("partially reached sections qualify, endpoint-only contact does not", () => {
  const hits = expose([wall("thin", [100, 0, 100, 100])], [region({ sourcePolygons: [rectangle(90, 5, 110, 6)] })]);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].impact.y > 5 && hits[0].impact.y < 6);
  assert.equal(expose([wall("touch", [100, 100, 100, 200])], [region({ sourcePolygons: [rectangle(0, 0, 100, 100)] })]).length, 0);
});

test("a thin unoccluded edge slice qualifies even when the section center is blocked", () => {
  const hits = expose([wall("front", [50, 0, 50, 49]), wall("back", [100, 0, 100, 100])]);
  const back = hits.find(hit => hit.wallId === "back");
  assert.ok(back);
  assert.ok(back.impact.y > 98);
});

test("holes exclude walls while an outer polygon boundary still has positive-length contact", () => {
  const holes = region({ sourcePolygons: [rectangle(-100, -100, 500, 500), rectangle(90, 90, 110, 210, true)] });
  assert.equal(expose([wall("hole", [100, 100, 100, 200])], [holes]).length, 0);
  assert.equal(expose([wall("boundary", [100, 0, 100, 100])], [region({ sourcePolygons: [rectangle(0, 0, 100, 100)] })]).length, 1);
});

test("overlapping areas damage a section once using the highest multiplier", () => {
  const hits = expose([wall("same", [100, 0, 100, 100])], [region(), region({ damageMultiplier: 1 }), region()]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].multiplier, 1);
});

test("separately placed source shapes in one native Region keep their own blast origins", () => {
  const hits = expose([wall("divider", [100, -100, 100, 100]), wall("right", [300, -100, 300, 100])], [region({
    sourcePolygons: [rectangle(-100, -100, 50, 100), rectangle(200, -100, 350, 100)],
    sourceAreas: [
      { origin: { x: 0, y: 0 }, sourcePolygons: [rectangle(-100, -100, 50, 100)] },
      { origin: { x: 250, y: 0 }, sourcePolygons: [rectangle(200, -100, 350, 100)] }
    ]
  })]);
  assert.deepEqual(hits.map(hit => hit.wallId), ["right", "right"]);
});

test("crossing blockers retain a thin visible slice before the actual wall crossing", () => {
  const hits = expose([wall("cross", [50, 50, 150, 50]), wall("target", [100, 0, 100, 100])], [region({
    sourcePolygons: [rectangle(90, 49, 110, 100)]
  })]);
  const target = hits.find(hit => hit.wallId === "target");
  assert.ok(target);
  assert.ok(target.impact.y > 49 && target.impact.y < 50);
});

test("prior breach remainders keep the original anchored section indices", () => {
  const sections = areaWallSections(wall("remainder", [250, 0, 700, 0], { flags: { "hardwipe-ruleset": { cover: {
    sectionOrigin: { x: 0, y: 0 }, sectionDirection: { x: 1, y: 0 }, sectionPixels: 100
  } } } }), 100);
  assert.deepEqual(sections.map(section => section.key), ["2", "3", "4", "5", "6"]);
  assert.equal(sections[0].length, 50);
  assert.deepEqual(sections[0].center, { x: 275, y: 0 });
});

test("simultaneous adjacent and separated breaches are planned from one original wall", () => {
  const sections = areaWallSections(wall("original", [0, 0, 700, 0]), 100);
  assert.deepEqual(areaWallRemainders([0, 0, 700, 0], [sections[1], sections[2], sections[5]]), [
    [0, 0, 100, 0], [300, 0, 500, 0], [600, 0, 700, 0]
  ]);
  assert.deepEqual(areaWallRemainders([700, 0, 0, 0], [sections[1], sections[2], sections[5]]), [
    [700, 0, 600, 0], [500, 0, 300, 0], [100, 0, 0, 0]
  ]);
  assert.deepEqual(areaWallRemainders([0, 0, 700, 0], sections), []);
});

test("bounded processing refuses an oversized blast instead of silently omitting sections", () => {
  assert.throws(() => expose([wall("many", [100, 0, 100, 400])], [region()], { maximum: 2 }), /too many wall sections/);
  assert.equal(expose([wall("very-long", [100, -1000000, 100, 1000000])], [region({ sourcePolygons: [rectangle(90, 0, 110, 10)] })]).length, 1);
  assert.throws(() => expose([wall("complex", [100, 0, 100, 400])], [region()], { maximumWork: 1 }), /too complex/);
});
