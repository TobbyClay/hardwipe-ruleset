import test from "node:test";
import assert from "node:assert/strict";
import { rewriteDie } from "../scripts/hardwipe-edge.js";

// A stand-in for a Foundry roll: one d20 term plus a flat bonus, its total from the active results.
function fakeRoll(results, { bonus = 5, keep = null } = {}) {
  const term = {
    faces: 20, modifiers: keep ? [keep] : [],
    results: results.map(result => ({ result, active: true })),
    _evaluateModifiers() {
      // kh: keep the highest, kl: the lowest.
      const values = this.results.map(entry => entry.result);
      const best = keep === "kh" ? Math.max(...values) : Math.min(...values);
      let kept = false;
      for (const entry of this.results) {
        const keepIt = !kept && entry.result === best;
        entry.active = keepIt;
        entry.discarded = !keepIt;
        if (keepIt) kept = true;
      }
    }
  };
  if (keep) term._evaluateModifiers();
  return {
    terms: [term, { operator: "+" }, { number: bonus }],
    _evaluateTotal() { return term.results.filter(entry => entry.active).reduce((sum, entry) => sum + entry.result, 0) + bonus; },
    get total() { return this._total ?? this._evaluateTotal(); }
  };
}

test("a rerolled die replaces that result and the total follows", () => {
  const roll = fakeRoll([17]);
  assert.equal(roll.total, 22);
  assert.equal(rewriteDie(roll, 0, 0, 3), true);
  assert.equal(roll.terms[0].results[0].result, 3);
  assert.equal(roll.total, 8);
});

test("with advantage, rerolling one d20 re-picks the higher", () => {
  const roll = fakeRoll([17, 4], { keep: "kh" });
  assert.equal(roll.total, 22);
  rewriteDie(roll, 0, 0, 2);
  assert.equal(roll.total, 9);
  assert.deepEqual(roll.terms[0].results.map(entry => entry.active), [false, true]);
});

test("a die that isn't there changes nothing", () => {
  const roll = fakeRoll([10]);
  assert.equal(rewriteDie(roll, 0, 3, 20), false);
  assert.equal(rewriteDie(roll, 2, 0, 20), false);
  assert.equal(roll.total, 15);
});
