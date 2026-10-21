import { test } from "node:test";
import assert from "node:assert/strict";
import { heatBand, heatBandSizes, heatBandStarts } from "../scripts/heat-bands.js";

const bands = max => Array.from({ length: max + 1 }, (_, spent) => heatBand(spent, max));

test("a budget of 6 is two marks each of Clean, Hot and Critical (the rules' example)", () => {
  // Remaining 6-5 Clean, 4-3 Hot, 2-1 Critical, 0 Lockdown; stored as marks spent 0..6.
  assert.deepEqual(bands(6), ["clean", "clean", "hot", "hot", "critical", "critical", "lockdown"]);
});

test("when the budget doesn't divide by three, Critical gets the smallest range", () => {
  assert.deepEqual(heatBandSizes(7), { clean: 3, hot: 2, critical: 2 });
  assert.deepEqual(heatBandSizes(8), { clean: 3, hot: 3, critical: 2 });
  assert.deepEqual(heatBandStarts(8), { hot: 3, critical: 6, lockdown: 8 });
  assert.deepEqual(bands(4), ["clean", "clean", "hot", "critical", "lockdown"]);
});

test("tiny budgets and no mission", () => {
  assert.deepEqual(bands(1), ["clean", "lockdown"]);
  assert.deepEqual(bands(2), ["clean", "hot", "lockdown"]);
  assert.deepEqual(bands(3), ["clean", "hot", "critical", "lockdown"]);
  assert.equal(heatBand(0, 0), "idle");
  assert.equal(heatBand(9, 6), "lockdown");
});
