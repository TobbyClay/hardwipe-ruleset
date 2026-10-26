import { test } from "node:test";
import assert from "node:assert/strict";
import { isActionSurge, consumableKind, vialCount, VIAL_LIMIT } from "../scripts/hardwipe-consumable-cards.js";
import { bulletRows, changeRow, durationRing, effectRows, midiFlagLabel, ringScale, tidyKey } from "../scripts/hardwipe-effects.js";

test("the ring grows with the duration: a round is a sliver, a day is the whole ring", () => {
  const [round, minute, tenMinutes, hour, day, week] = [6, 60, 600, 3600, 86400, 604800].map(ringScale);
  assert.equal(round, 0.06);
  assert.ok(minute > round && tenMinutes > minute && hour > tenMinutes && day > hour);
  assert.ok(minute > 0.2 && minute < 0.3);
  assert.ok(tenMinutes > 0.45 && tenMinutes < 0.55);
  assert.equal(day, 1);
  assert.equal(week, 1);
  // On the Turn tab the lit part drains with the time left; no duration is a full, indefinite ring.
  assert.equal(durationRing(600, 300).lit, ringScale(600) / 2);
  assert.equal(durationRing(600).lit, ringScale(600));
  assert.deepEqual(durationRing(Infinity), { length: 1, lit: 1, indefinite: true });
});

test("numbers read before → after against the actor, whether or not the effect is already applied", () => {
  const read = path => ({ "system.attributes.ac.value": 14, "system.attributes.movement.walk": 30 })[path];
  assert.deepEqual(changeRow({ key: "system.attributes.ac.bonus", type: "add", value: 2 }, { read }), { label: "AC", before: 14, after: 16, unit: "", change: "+2" });
  assert.deepEqual(changeRow({ key: "system.attributes.movement.walk", type: "add", value: "10" }, { read }), { label: "Speed", before: 30, after: 40, unit: " ft", change: "+10" });
  // Already applied: the actor's 14 includes the +2.
  const applied = changeRow({ key: "system.attributes.ac.bonus", type: "add", value: 2 }, { read, applied: true });
  assert.equal(applied.before, 12);
  assert.equal(applied.after, 14);
  // Old numeric modes still read (2 = add).
  assert.equal(changeRow({ key: "system.attributes.ac.bonus", mode: 2, value: 1 }, { read }).after, 15);
});

test("bonuses without a readable number keep their formula; unknown keys still show, tidied", () => {
  assert.deepEqual(changeRow({ key: "system.bonuses.abilities.save", type: "add", value: "+1d4" }), { label: "Saving throws", change: "+1d4" });
  assert.deepEqual(changeRow({ key: "system.bonuses.mwak.damage", type: "add", value: "1d6" }), { label: "Melee weapon damage", change: "+1d6" });
  assert.equal(tidyKey("system.bonuses.weapon.critical"), "Bonuses › weapon › critical");
  assert.deepEqual(changeRow({ key: "system.attributes.senses.ranges.darkvision", type: "upgrade", value: 60 }), { label: "Darkvision", change: "≥ 60 ft" });
  assert.deepEqual(changeRow({ key: "system.some.custom.thing", type: "override", value: 3 }), { label: "Some › custom › thing", change: "= 3" });
});

test("Ready Set Midi's advantage flags read as words", () => {
  assert.equal(midiFlagLabel("flags.midi-qol.advantage.ability.save.dex"), "ADV on DEX saves");
  assert.equal(midiFlagLabel("flags.midi-qol.disadvantage.attack.rwak"), "DIS on ranged weapon attacks");
  assert.equal(midiFlagLabel("flags.midi-qol.advantage.all"), "ADV on everything");
  assert.equal(midiFlagLabel("flags.midi-qol.grants.disadvantage.attack.all"), "Attacks against you have DIS");
  assert.equal(midiFlagLabel("system.attributes.ac.bonus"), null);
  assert.deepEqual(changeRow({ key: "flags.midi-qol.advantage.ability.save.dex", type: "custom", value: 1 }), { label: "ADV on DEX saves", change: "ON" });
});

test("a GM's bulleted description replaces the rows; otherwise changes then conditions", () => {
  assert.deepEqual(bulletRows("<p>Stims.</p><ul><li>Ignore <b>one</b> Strike</li><li>Can't be Downed&nbsp;this round</li></ul>").map(r => r.label),
    ["Ignore one Strike", "Can't be Downed this round"]);
  const effect = { changes: [{ key: "system.attributes.ac.bonus", type: "add", value: 2 }], statuses: ["invisible"], description: "<p>No bullets.</p>" };
  const rows = effectRows(effect, { statusName: id => id === "invisible" ? "Invisible" : id });
  assert.deepEqual(rows.map(r => r.label), ["AC", "Invisible"]);
  assert.deepEqual(effectRows({ ...effect, description: "<ul><li>Just this</li></ul>" }).map(r => r.label), ["Just this"]);
});

test("a consumable or feature's payload kind, and Action Surge by identifier or name", () => {
  assert.equal(consumableKind({ type: "heal" }), "heal");
  assert.equal(consumableKind({ type: "save", damageParts: 1 }), "damage");
  assert.equal(consumableKind({ type: "save", effects: 1 }), "condition");
  assert.equal(consumableKind({ type: "utility", effects: 1 }), "buff");
  assert.equal(consumableKind({ type: "utility" }), "utility");
  assert.ok(isActionSurge({ system: { identifier: "action-surge" } }));
  assert.ok(isActionSurge({ name: "Action Surge", system: {} }));
  assert.ok(!isActionSurge({ name: "Action Surge (Two Uses)", system: {} }));
  assert.ok(!isActionSurge({ name: "Second Wind", system: { identifier: "second-wind" } }));
});

test("a big stack shows one vial and the number instead of a vial per dose", () => {
  assert.equal(vialCount(0), 1);
  assert.equal(vialCount(1), 2);
  assert.equal(vialCount(VIAL_LIMIT), VIAL_LIMIT + 1);
  assert.equal(vialCount(VIAL_LIMIT + 1), 1);
  assert.equal(vialCount(240), 1);
});
