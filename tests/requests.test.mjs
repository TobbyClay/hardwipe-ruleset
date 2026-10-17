import test from "node:test";
import assert from "node:assert/strict";
import { contestOutcome, formatBonus, groupVerdict, margin, parseRoll, rollSpecOf, sameRoll } from "../scripts/hardwipe-requests.js";

test("a roll value names a skill, an ability check or a save", () => {
  assert.deepEqual(parseRoll("skill:ath"), { type: "skill", skill: "ath" });
  assert.deepEqual(parseRoll("check:str"), { type: "check", ability: "str" });
  assert.deepEqual(parseRoll("save:dex"), { type: "save", ability: "dex" });
  for (const value of ["", "skill", "skill:", "tool:thief", null, undefined]) assert.equal(parseRoll(value), null, String(value));
});

test("the margin is the total against the DC, and needs both", () => {
  assert.equal(margin(17, 15), 2);
  assert.equal(margin(15, 15), 0);
  assert.equal(margin(9, 15), -6);
  assert.equal(margin(null, 15), null);
  assert.equal(margin(12, null), null);
});

test("a group check passes when at least half the group passes, and waits for everyone", () => {
  assert.deepEqual(groupVerdict([true, false]), { pass: 1, total: 2, success: true });
  assert.deepEqual(groupVerdict([true, false, false]), { pass: 1, total: 3, success: false });
  assert.deepEqual(groupVerdict([true, true, false, false]), { pass: 2, total: 4, success: true });
  assert.equal(groupVerdict([true, null]), null);
  assert.equal(groupVerdict([]), null);
});

test("a contest goes to the higher total, and a tie leaves the defender holding", () => {
  assert.equal(contestOutcome(18, 12), "challenger");
  assert.equal(contestOutcome(11, 14), "defender");
  assert.equal(contestOutcome(13, 13), "defender");
  assert.equal(contestOutcome(13, null), null);
});

test("a roll message reads back as the skill, check or save it rolled", () => {
  assert.deepEqual(rollSpecOf({ type: "check", system: { ability: "str", skill: "ath" } }), { type: "skill", skill: "ath" });
  assert.deepEqual(rollSpecOf({ type: "check", system: { ability: "int" } }), { type: "check", ability: "int" });
  assert.deepEqual(rollSpecOf({ type: "save", system: { ability: "dex" } }), { type: "save", ability: "dex" });
  assert.deepEqual(rollSpecOf({ type: "save", system: { ability: "dex", type: "ability" } }), { type: "save", ability: "dex" });
  // Tools, death saves, concentration saves and other messages answer nothing.
  assert.equal(rollSpecOf({ type: "check", system: { ability: "dex", tool: "thief" } }), null);
  assert.equal(rollSpecOf({ type: "save", system: { type: "death" } }), null);
  assert.equal(rollSpecOf({ type: "save", system: { ability: "con", type: "concentration" } }), null);
  assert.equal(rollSpecOf({ type: "attack", system: { ability: "str" } }), null);
});

test("only the same skill, check or save matches", () => {
  assert.equal(sameRoll(parseRoll("skill:ath"), { type: "skill", skill: "ath" }), true);
  assert.equal(sameRoll(parseRoll("skill:ath"), { type: "skill", skill: "acr" }), false);
  assert.equal(sameRoll(parseRoll("save:dex"), { type: "check", ability: "dex" }), false);
  assert.equal(sameRoll(parseRoll("check:str"), { type: "check", ability: "str" }), true);
  assert.equal(sameRoll(null, parseRoll("save:dex")), false);
});

test("a bonus reads +5 or −1", () => {
  assert.equal(formatBonus(5), "+5");
  assert.equal(formatBonus(0), "+0");
  assert.equal(formatBonus(-1), "−1");
  assert.equal(formatBonus(null), "");
});
