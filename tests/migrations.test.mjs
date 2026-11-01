import test from "node:test";
import assert from "node:assert/strict";
import { MIGRATIONS, compareVersions, pendingMigrations, planCyberwareFlags, planSessionEnds, planShieldMax, planWallHeight, planWallTypeHeights } from "../scripts/hardwipe-migrations.js";

const FLAGS = "hardwipe-ruleset";
const shield = (flag, extra = {}) => ({ _id: "s1", type: "equipment", system: { type: { value: "shield" } }, flags: flag === undefined ? {} : { [FLAGS]: { shield: flag } }, ...extra });
const implant = (flag, type = "hardwipe-arms") => ({ _id: "c1", type: "equipment", system: { type: { value: type }, equipped: true }, flags: flag === undefined ? {} : { [FLAGS]: { cyberware: flag } } });
const slots = new Set(["hardwipe-arms", "hardwipe-eyes"]);

test("versions compare numerically, part by part, with missing parts as zero", () => {
  assert.equal(compareVersions("0.7.49", "0.7.48"), 1);
  assert.equal(compareVersions("0.7.10", "0.7.9"), 1);
  assert.equal(compareVersions("0.7.49", "0.7.49.0"), 0);
  assert.equal(compareVersions("", "0.0.1"), -1);
  assert.equal(compareVersions("1.0", "0.9.99"), 1);
  assert.equal(compareVersions(undefined, undefined), 0);
});

test("only steps newer than the recorded version run, oldest version first, in list order within a version", () => {
  const list = [
    { version: "0.7.50", key: "c" }, { version: "0.7.49", key: "a" }, { version: "0.7.49", key: "b" }, { version: "0.7.48", key: "old" }
  ];
  assert.deepEqual(pendingMigrations(list, "0.7.48").map(step => step.key), ["a", "b", "c"]);
  assert.deepEqual(pendingMigrations(list, "").map(step => step.key), ["old", "a", "b", "c"]);
  assert.deepEqual(pendingMigrations(list, "0.7.49").map(step => step.key), ["c"]);
  assert.deepEqual(pendingMigrations(list, "0.7.50"), []);
  assert.ok(MIGRATIONS.every(step => typeof step.run === "function" && step.version && step.key));
});

test("a shield with Hardwipe HP but no maximum gets the old fixed maximum; others are left alone", () => {
  assert.deepEqual(planShieldMax(shield({ hp: 7, broken: false })), { _id: "s1", [`flags.${FLAGS}.shield.max`]: 10 });
  assert.equal(planShieldMax(shield({ hp: 7, max: 25 })), null);
  assert.equal(planShieldMax(shield({ hp: 7, max: 0 })) !== null, true);
  assert.equal(planShieldMax(shield(undefined)), null);
  assert.equal(planShieldMax(shield({ hp: 7 }, { type: "weapon" })), null);
  assert.equal(planShieldMax({ _id: "x", type: "equipment", system: { type: { value: "light" } }, flags: { [FLAGS]: { shield: { hp: 1 } } } }), null);
});

test("cyberware without its state flag becomes carried and unequipped, keeping damage or disabled marks", () => {
  const update = planCyberwareFlags(implant(undefined), slots);
  assert.deepEqual(update, {
    _id: "c1", "system.equipped": false, "system.attunement": "", "system.attuned": false,
    [`flags.${FLAGS}.cyberware`]: { version: 1, installed: false, disabled: false, damaged: false, pending: null }
  });
  assert.equal(planCyberwareFlags(implant({ version: 1, installed: true, disabled: false, damaged: false, pending: null }), slots), null);
  assert.equal(planCyberwareFlags(implant({ damaged: true }), slots)[`flags.${FLAGS}.cyberware`].damaged, true);
  assert.equal(planCyberwareFlags(implant(undefined, "light"), slots), null);
  assert.equal(planCyberwareFlags({ type: "weapon", system: { type: { value: "hardwipe-arms" } } }, slots), null);
});

test("finished sessions without an end are ended at their last roll, and an archive already in shape is untouched", () => {
  const plan = planSessionEnds([{ id: "a", start: 10, last: 50 }, { id: "b", start: 20, end: 30 }, { id: "c", start: 40 }, { id: "", start: 1 }]);
  assert.equal(plan.changed, 2);
  assert.deepEqual(plan.sessions.map(session => session.end), [50, 30, 40, undefined]);
  assert.equal(planSessionEnds([{ id: "b", start: 20, end: 30 }]), null);
  assert.equal(planSessionEnds(undefined), null);
});

test("a wall's 0.7.49 top height is removed; walls without one are left alone", () => {
  const wall = cover => ({ _id: "w1", flags: cover === undefined ? {} : { [FLAGS]: { cover } } });
  assert.deepEqual(planWallHeight(wall({ material: "concrete", height: 4 })), { _id: "w1" });
  assert.deepEqual(planWallHeight(wall({ material: "concrete", height: 0 })), { _id: "w1" });
  assert.equal(planWallHeight(wall({ material: "concrete" })), null);
  assert.equal(planWallHeight(wall(undefined)), null);
  assert.equal(planWallHeight(null), null);
});

test("wall types lose their 0.7.49 top height and keep everything else", () => {
  const value = { version: 1, revision: 3, types: [{ id: "a", name: "A", max: 10, height: 4 }, { id: "b", name: "B", max: 20 }] };
  const plan = planWallTypeHeights(value);
  assert.equal(plan.changed, 1);
  assert.deepEqual(plan.value, { version: 1, revision: 3, types: [{ id: "a", name: "A", max: 10 }, { id: "b", name: "B", max: 20 }] });
  assert.equal(planWallTypeHeights({ version: 1, types: [{ id: "b", max: 20 }] }), null);
  assert.equal(planWallTypeHeights(undefined), null);
});
