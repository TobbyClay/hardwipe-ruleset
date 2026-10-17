import test from "node:test";
import assert from "node:assert/strict";
import { limitWaiting, orderWaiting, rollCallExpired } from "../scripts/hardwipe-comms.js";

const posted = { combat: "c1", round: 3, turn: 1 };
const at = (round, turn, started = true) => ({ combat: { started, round, turn } });

test("in combat, a roll call closes at the end of the round it was posted by default", () => {
  const rules = { inCombat: "round", idleMinutes: 10 };
  assert.equal(rollCallExpired({ posted }, at(3, 1), rules), false);
  assert.equal(rollCallExpired({ posted }, at(3, 3), rules), false);
  assert.equal(rollCallExpired({ posted }, at(4, 0), rules), true);
});

test("the turn rule closes it as soon as the turn moves on", () => {
  const rules = { inCombat: "turn" };
  assert.equal(rollCallExpired({ posted }, at(3, 1), rules), false);
  assert.equal(rollCallExpired({ posted }, at(3, 2), rules), true);
  assert.equal(rollCallExpired({ posted }, at(4, 1), rules), true);
});

test("the combat rule waits for combat to end, and never means never", () => {
  assert.equal(rollCallExpired({ posted }, at(9, 0), { inCombat: "combat" }), false);
  assert.equal(rollCallExpired({ posted }, { combat: null }, { inCombat: "combat" }), true);
  assert.equal(rollCallExpired({ posted }, { combat: null }, { inCombat: "never" }), false);
});

test("a combat that's gone or not started closes what was posted in it", () => {
  assert.equal(rollCallExpired({ posted }, { combat: null }, { inCombat: "round" }), true);
  assert.equal(rollCallExpired({ posted }, at(0, 0, false), { inCombat: "round" }), true);
});

test("out of combat, a roll call closes after its minutes, or stays open with 0", () => {
  const now = 1_000_000_000;
  const minutes = n => now - n * 60000;
  assert.equal(rollCallExpired({ timestamp: minutes(9) }, { now }, { idleMinutes: 10 }), false);
  assert.equal(rollCallExpired({ timestamp: minutes(10) }, { now }, { idleMinutes: 10 }), true);
  assert.equal(rollCallExpired({ timestamp: minutes(500) }, { now }, { idleMinutes: 0 }), false);
});

test("saves owed now come first, then the rest, newest first", () => {
  const items = [
    { id: "old-call", kind: "rollcall", at: 1 }, { id: "contest", kind: "contest", at: 5 },
    { id: "save", kind: "save", at: 2 }, { id: "interrupt", kind: "interrupt", at: 3 }, { id: "new-call", kind: "rollcall", at: 9 }
  ];
  assert.deepEqual(orderWaiting(items).map(item => item.id), ["interrupt", "save", "new-call", "contest", "old-call"]);
});

test("the strip shows the limit and folds the rest under more", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(limitWaiting(items, 3), { shown: [1, 2, 3], more: 2, expanded: false });
  assert.deepEqual(limitWaiting(items, 3, true), { shown: items, more: 2, expanded: true });
  assert.deepEqual(limitWaiting(items, 0), { shown: items, more: 0, expanded: false });
  assert.deepEqual(limitWaiting([1, 2], 3, true), { shown: [1, 2], more: 0, expanded: false });
});
