import test from "node:test";
import assert from "node:assert/strict";
import { conditionRuleIds, entryInForce, registerConditionRules } from "../scripts/hardwipe-condition-rules.js";
import { RollRules } from "../scripts/hardwipe-roll-rules.js";

const nameOf = (status, level) => ({ poisoned: "Poisoned", exhaustion: "Exhaustion" })[status] + (level ? ` ${level}` : "");
const snapshot = actor => ({ statuses: [...(actor.statuses ?? [])], immunities: [...(actor.ci ?? [])], levels: actor.conditions ?? {}, leveled: ["exhaustion"] });

test("the rules follow D&D5e's live table: Poisoned under both rule sets, Exhaustion 3 only when the legacy table lists it", () => {
  assert.deepEqual(conditionRuleIds(["poisoned"]), ["condition-poisoned"]);
  assert.deepEqual(conditionRuleIds(new Set(["poisoned", "exhaustion-3"])), ["condition-poisoned", "condition-exhaustion-3"]);
  assert.equal(entryInForce("poisoned", snapshot({ statuses: ["poisoned"] }), nameOf), "Poisoned");
  assert.equal(entryInForce("exhaustion-3", snapshot({ statuses: ["exhaustion"], conditions: { exhaustion: 2 } }), nameOf), null);
  assert.equal(entryInForce("exhaustion-3", snapshot({ statuses: ["exhaustion"], conditions: { exhaustion: 4 } }), nameOf), "Exhaustion 4");
  assert.equal(entryInForce("poisoned", snapshot({ statuses: ["poisoned"], ci: ["poisoned"] }), nameOf), null);
});

test("registered, a rule adds a disadvantage source named for the condition and reaches the sheet only while in force", () => {
  RollRules._sources.clear();
  const modern = registerConditionRules({ entries: new Set(["poisoned"]), snapshot, nameOf, rule: "Disadvantage on attack rolls" });
  assert.deepEqual(modern.map(entry => [entry.id, entry.name]), [["condition-poisoned", "Poisoned"]]);
  const poisoned = { statuses: ["poisoned"] };
  assert.deepEqual(RollRules.evaluate({ actor: poisoned }), [{ type: "DIS", id: "hardwipe:condition-poisoned", label: "Poisoned - Disadvantage on attack rolls" }]);
  assert.deepEqual(RollRules.evaluate({ actor: { statuses: ["prone"] } }), []);
  assert.deepEqual(RollRules.evaluate({ actor: { statuses: ["poisoned"], ci: ["poisoned"] } }), []);
  assert.deepEqual(RollRules.evaluate({}), []);
  assert.deepEqual(RollRules.liveRows(poisoned).map(row => [row.type, row.name, row.scope]), [["DIS", "Poisoned", "attack.all"]]);
  assert.deepEqual(RollRules.liveRows({ statuses: [] }), []);
  RollRules._sources.clear();
  const legacy = registerConditionRules({ entries: new Set(["poisoned", "exhaustion-3"]), snapshot, nameOf, rule: "Disadvantage on attack rolls" });
  assert.deepEqual(legacy.map(entry => entry.name), ["Poisoned", "Exhaustion 3"]);
  assert.deepEqual(RollRules.evaluate({ actor: { statuses: ["exhaustion"], conditions: { exhaustion: 3 } } }).map(entry => entry.id), ["hardwipe:condition-exhaustion-3"]);
  RollRules._sources.clear();
});
