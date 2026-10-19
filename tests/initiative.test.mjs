import { test } from "node:test";
import assert from "node:assert/strict";
import { initiativePlace, newestFor, ordinalKey } from "../scripts/hardwipe-initiative.js";

const turns = [
  { id: "juno", name: "Juno", initiative: 19 },
  { id: "mags", name: "Mags", initiative: 16 },
  { id: "guard", name: "Breach Guard", initiative: 11 },
  { id: "sniper", name: "Corpo Sniper", initiative: null }
];

test("a combatant's place counts only those who rolled, in the combat's own order", () => {
  const mags = initiativePlace(turns, "mags");
  assert.equal(mags.slot, 2);
  assert.equal(mags.count, 4);
  assert.equal(mags.before.id, "juno");
  assert.equal(mags.after.id, "guard");
  assert.equal(mags.waiting, 1);
  const juno = initiativePlace(turns, "juno");
  assert.equal(juno.slot, 1);
  assert.equal(juno.before, null);
  const guard = initiativePlace(turns, "guard");
  assert.equal(guard.after, null);
  // Not rolled yet, or not in the combat: no place.
  assert.equal(initiativePlace(turns, "sniper"), null);
  assert.equal(initiativePlace(turns, "nobody"), null);
});

test("a place reads as an English ordinal", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(n => ordinalKey(n)),
    ["one", "two", "few", "other", "other", "other", "other", "one", "two", "few"]);
});

test("only the newest initiative card of a combat carries the turn order", () => {
  const log = [{ id: "a", combatId: "c1" }, { id: "b", combatId: "c2" }, { id: "c", combatId: "c1" }, { id: "d", combatId: null }];
  assert.equal(newestFor(log, "c1"), "c");
  assert.equal(newestFor(log, "c2"), "b");
  assert.equal(newestFor(log, "c3"), null);
});
