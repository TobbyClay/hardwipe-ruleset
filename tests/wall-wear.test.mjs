import test from "node:test";
import assert from "node:assert/strict";
import { planWallWear } from "../scripts/hardwipe-wall-wear.js";

// A 300 px wall in three 100 px sections of 40 HP; section 1 (x 100-200) is the one hit.
const wall = { c: [0, 0, 300, 0] };
const cover = (hits, hp = 40 - hits.reduce((sum, hit) => sum + hit.damage, 0)) =>
  ({ max: 40, hp: 40, sectionPixels: 100, sections: { 1: { hp, max: 40, impact: hits[0] ? { x: hits[0].x, y: 0 } : { x: 150, y: 0 }, hits } } });
const hit = (x, damage) => ({ x, y: 0, damage });
const widths = plan => plan.gaps.map(gap => Math.hypot(gap.c[2] - gap.c[0], gap.c[3] - gap.c[1]));
const middles = plan => plan.gaps.map(gap => (gap.c[0] + gap.c[2]) / 2).sort((a, b) => a - b);

test("an undamaged wall stays whole", () => {
  const plan = planWallWear(wall, { max: 40, hp: 40, sectionPixels: 100, sections: {} }, null);
  assert.equal(plan.gaps.length, 0);
  assert.deepEqual(plan.solid, [[0, 0, 300, 0]]);
});

test("one big hit opens one wide hole on its impact", () => {
  const plan = planWallWear(wall, cover([hit(150, 30)]), null);
  assert.equal(plan.gaps.length, 1);
  assert.ok(widths(plan)[0] >= 55, `width ${widths(plan)[0]}`);
  const [gap] = plan.gaps;
  assert.ok(gap.c[0] <= 150 && gap.c[2] >= 150, JSON.stringify(gap.c));
});

test("several small hits open several small holes, scattered rather than evenly spaced", () => {
  const plan = planWallWear(wall, cover([hit(150, 4), hit(150, 4), hit(150, 4)]), null);
  assert.equal(plan.gaps.length, 3);
  assert.ok(widths(plan).every(width => width < 25), widths(plan).join(", "));
  const [a, b, c] = middles(plan);
  assert.notEqual(Math.round(b - a), Math.round(c - b), "holes evenly spaced");
  assert.equal(plan.scars.length, 3, "one damage decal per hole");
});

test("bigger hits make bigger holes", () => {
  const small = widths(planWallWear(wall, cover([hit(150, 5)]), null))[0];
  const large = widths(planWallWear(wall, cover([hit(150, 20)]), null))[0];
  assert.ok(large > small * 2, `${small} vs ${large}`);
});

test("holes stay inside the hit section, clear of its ends, and every client draws the same plan", () => {
  const data = cover([hit(105, 12), hit(195, 9), hit(150, 6), hit(120, 3)]);
  const plan = planWallWear(wall, data, null);
  for (const gap of plan.gaps) assert.ok(gap.c[0] > 100 && gap.c[2] < 200, JSON.stringify(gap.c));
  const covered = widths(plan).reduce((sum, width) => sum + width, 0) + plan.solid.reduce((sum, c) => sum + Math.hypot(c[2] - c[0], c[3] - c[1]), 0);
  assert.equal(covered, 300);
  assert.deepEqual(planWallWear(wall, data, null), plan);
});

test("a section damaged before hits were recorded reads as one hit for its damage", () => {
  const plan = planWallWear(wall, { max: 40, hp: 40, sectionPixels: 100, sections: { 1: { hp: 10, max: 40, impact: { x: 150, y: 0 } } } }, null);
  assert.equal(plan.gaps.length, 1);
  assert.ok(widths(plan)[0] >= 55);
});
