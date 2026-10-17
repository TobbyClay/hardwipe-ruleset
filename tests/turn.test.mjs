import test from "node:test";
import assert from "node:assert/strict";
import {
  attacksPerAction, compareOptions, currentLedger, generalMoveOf, isCastable, isMeleeWeapon, isWeaponAttack, optionGroup,
  payFor, reactionHeld, readLedger, recordUse, slotFor
} from "../scripts/hardwipe-turn.js";

// A four-combatant order; the character acts at index 2.
const at = (round, turn, extra = {}) => ({ combat: "c1", round, turn, own: 2, isTurn: turn === 2, ...extra });
const use = (activation, extra = {}) => ({ activation, attack: false, move: null, ...extra });
const fresh = { action: false, bonus: false, attacks: 0, moves: {}, dash: null, reaction: false };

test("an action and a bonus action on the actor's turn are spent until the turn ends", () => {
  let ledger = recordUse(null, use("action"), at(1, 2));
  ledger = recordUse(ledger, use("bonus"), at(1, 2));
  assert.deepEqual(readLedger(ledger, at(1, 2)), { ...fresh, action: true, bonus: true });
  // Someone else's turn: action-side entries are not in play.
  assert.equal(readLedger(ledger, at(1, 3)).action, false);
  // The actor's next turn starts clean even if nothing cleared the ledger.
  assert.equal(readLedger(ledger, at(2, 2)).action, false);
});

test("off-turn actions and bonus actions are not recorded", () => {
  assert.equal(recordUse(null, use("action"), at(1, 1)), null);
  assert.equal(recordUse(null, use("bonus"), at(1, 3)), null);
  assert.equal(recordUse(null, use("minute"), at(1, 2)), null);
});

test("a reaction stays spent until the actor's own next turn starts", () => {
  // Used before the actor's turn in round 1: back at round 1, turn 2.
  const early = recordUse(null, use("reaction"), at(1, 0));
  assert.equal(readLedger(early, at(1, 1)).reaction, true);
  assert.equal(readLedger(early, at(1, 2)).reaction, false);
  // Used after the actor's turn: back at round 2, turn 2.
  const late = recordUse(null, use("reaction"), at(1, 3));
  assert.equal(readLedger(late, at(2, 0)).reaction, true);
  assert.equal(readLedger(late, at(2, 1)).reaction, true);
  assert.equal(readLedger(late, at(2, 2)).reaction, false);
  // Used on its own turn: back next round.
  const own = recordUse(null, use("reaction"), at(1, 2));
  assert.equal(readLedger(own, at(1, 3)).reaction, true);
  assert.equal(readLedger(own, at(2, 2)).reaction, false);
});

test("an off-turn weapon attack that costs an action is an opportunity attack and spends the reaction", () => {
  const ledger = recordUse(null, use("action", { attack: true }), at(1, 0));
  assert.equal(readLedger(ledger, at(1, 1)).reaction, true);
  assert.equal(readLedger(ledger, at(1, 1)).action, false);
});

test("attacks in the Attack action count up; a general action records what paid for it", () => {
  let ledger = recordUse(null, use("action", { attack: true }), at(3, 2));
  ledger = recordUse(ledger, use("action", { attack: true }), at(3, 2));
  assert.equal(readLedger(ledger, at(3, 2)).attacks, 2);
  const dash = recordUse(null, use("bonus", { move: "dash" }), at(3, 2));
  assert.deepEqual(readLedger(dash, at(3, 2)).moves, { dash: "bonus" });
  assert.equal(readLedger(dash, at(3, 2)).dash, "bonus");
  assert.equal(readLedger(dash, at(3, 2)).action, false);
});

test("a ledger written before general actions existed keeps its Dash", () => {
  const old = { combat: "c1", round: 2, turn: 2, action: false, bonus: true, attacks: 0, dash: "bonus", reaction: null };
  assert.equal(readLedger(old, at(2, 2)).dash, "bonus");
  assert.deepEqual(readLedger(old, at(2, 2)).moves, { dash: "bonus" });
});

test("a ledger from another combat, or a rewound combat, reads as empty", () => {
  const ledger = recordUse(null, use("reaction"), at(4, 1));
  assert.equal(readLedger(ledger, at(4, 1, { combat: "c2" })).reaction, false);
  assert.equal(readLedger(ledger, at(3, 3)).reaction, false);
  assert.deepEqual(readLedger(null, null), fresh);
});

test("an actor missing from the turn order keeps its reaction spent until the ledger is cleared", () => {
  assert.equal(reactionHeld({ round: 1, turn: 1 }, { round: 5, turn: 0, own: null }), true);
});

test("the current ledger keeps this turn's entries and the reaction, and resets an earlier turn's", () => {
  const ledger = { combat: "c1", round: 1, turn: 2, action: true, bonus: true, attacks: 1, moves: { dash: "action" }, reaction: { round: 1, turn: 3 } };
  assert.deepEqual(currentLedger(ledger, at(1, 2)), ledger);
  assert.deepEqual(currentLedger(ledger, at(2, 2)), { ...ledger, round: 2, action: false, bonus: false, attacks: 0, moves: {} });
  assert.deepEqual(currentLedger(ledger, at(2, 2, { combat: "c9" })),
    { combat: "c9", round: 2, turn: 2, action: false, bonus: false, attacks: 0, moves: {}, reaction: null });
});

test("a general action spends the action; Dash, Disengage and Hide fall back to the bonus action", () => {
  const economy = (action, bonus) => ({ action: { spent: action }, bonus: { spent: bonus }, reaction: { spent: false } });
  assert.equal(payFor("dodge", economy(false, false)), "action");
  assert.equal(payFor("dodge", economy(true, false)), null);
  for (const move of ["dash", "disengage", "hide"]) assert.equal(payFor(move, economy(true, false)), "bonus");
  assert.equal(payFor("dash", economy(true, true)), null);
});

test("Grapple and Shove take one attack of an Attack action under way, or start one", () => {
  const economy = action => ({ action: { spent: action }, bonus: { spent: false }, reaction: { spent: false } });
  assert.equal(payFor("grapple", economy(false)), "action");
  assert.equal(payFor("grapple", economy(true), 1), "attack");
  assert.equal(payFor("shove", economy(true), 0), null);
  // Never the bonus action, unlike Dash, Disengage and Hide.
  assert.equal(payFor("shove", { action: { spent: true }, bonus: { spent: false } }), null);
});

test("Extra Attack and similar features set the attacks per Attack action; the highest wins", () => {
  const feat = (name, identifier = "") => ({ type: "feat", name, system: { identifier } });
  assert.deepEqual(attacksPerAction([]), { count: 1, source: null });
  assert.deepEqual(attacksPerAction([feat("Extra Attack", "extra-attack")]), { count: 2, source: "Extra Attack" });
  assert.equal(attacksPerAction([feat("Extra Attack"), feat("Two Extra Attacks")]).count, 3);
  assert.equal(attacksPerAction([feat("Three Extra Attacks", "three-extra-attacks")]).count, 4);
  assert.equal(attacksPerAction([feat("Extra Attack (2)")]).count, 3);
  assert.equal(attacksPerAction([feat("Thirsting Blade", "thirsting-blade")]).count, 2);
  // Only features count by name: a weapon called Extra Attack does not.
  assert.equal(attacksPerAction([{ type: "weapon", name: "Extra Attack", system: {} }]).count, 1);
});

test("an implant's attacksPerAction flag counts only while it works", () => {
  const implant = { type: "equipment", name: "Kerenzikov", system: { type: { value: "hardwipe-nervous" } }, flags: { "hardwipe-ruleset": { attacksPerAction: 2 } } };
  assert.equal(attacksPerAction([implant], () => true).count, 2);
  assert.equal(attacksPerAction([implant], () => false).count, 1);
});

test("general actions are recognised by activity or item name, not inside other words", () => {
  assert.equal(generalMoveOf({ name: "Dash", item: { name: "Cunning Action" } }), "dash");
  assert.equal(generalMoveOf({ name: "Disengage", item: { name: "Cunning Action" } }), "disengage");
  assert.equal(generalMoveOf({ name: "", item: { name: "Cunning Action: Hide" } }), "hide");
  assert.equal(generalMoveOf({ name: "Step of the Wind (Dash)", item: { name: "Monk" } }), "dash");
  assert.equal(generalMoveOf({ name: "Dashing Strike", item: { name: "Rapier" } }), null);
  assert.equal(generalMoveOf({ name: "Attack", item: { name: "Balderdash" } }), null);
});

test("weapon and unarmed attacks belong to the Attack action; spell attacks do not", () => {
  assert.ok(isWeaponAttack({ type: "attack", attack: { type: { classification: "weapon" } } }));
  assert.ok(isWeaponAttack({ type: "attack", attack: { type: { classification: "unarmed" } } }));
  assert.ok(!isWeaponAttack({ type: "attack", attack: { type: { classification: "spell" } } }));
  assert.ok(isWeaponAttack({ type: "attack", attack: { type: {} }, item: { type: "weapon" } }));
  assert.ok(!isWeaponAttack({ type: "save", item: { type: "weapon" } }));
});

test("activities sort into bands by cost; everything else is outside the action economy", () => {
  assert.equal(slotFor("action"), "action");
  assert.equal(slotFor("bonus"), "bonus");
  assert.equal(slotFor("reaction"), "reaction");
  for (const other of ["minute", "hour", "special", "legendary", "", undefined]) assert.equal(slotFor(other), null);
});

test("only castable programs are offered: cantrips, unprepared-type spells, prepared and always-prepared ones", () => {
  const spell = system => ({ type: "spell", system });
  assert.ok(isCastable(spell({ level: 0, canPrepare: true, prepared: 0 })));
  assert.ok(isCastable(spell({ level: 3, canPrepare: false, prepared: 0 })));
  assert.ok(isCastable(spell({ level: 1, canPrepare: true, prepared: 1 })));
  assert.ok(isCastable(spell({ level: 1, canPrepare: true, prepared: 2 })));
  assert.ok(!isCastable(spell({ level: 2, canPrepare: true, prepared: 0 })));
});

test("melee weapons are the ones offered as opportunity attacks", () => {
  const weapon = value => ({ type: "weapon", system: { type: { value } } });
  assert.ok(isMeleeWeapon(weapon("martialM")));
  assert.ok(isMeleeWeapon(weapon("simpleM")));
  assert.ok(isMeleeWeapon(weapon("natural")));
  assert.ok(!isMeleeWeapon(weapon("martialR")));
  assert.ok(!isMeleeWeapon({ type: "equipment", system: { type: { value: "hardwipe-arms" } } }));
});

test("options group and sort: weapons in hand, implants, features, programs by level, gear", () => {
  assert.equal(optionGroup({ type: "weapon" }), "weapon");
  assert.equal(optionGroup({ type: "equipment", system: { type: { value: "hardwipe-eyes" } } }), "implant");
  assert.equal(optionGroup({ type: "equipment", system: { type: { value: "light" } } }), "gear");
  assert.equal(optionGroup({ type: "feat" }), "feature");
  assert.equal(optionGroup({ type: "spell" }), "program");
  assert.equal(optionGroup({ type: "consumable" }), "gear");
  const rows = [
    { group: "program", level: 2, name: "Haste" }, { group: "gear", name: "Grenade" }, { group: "weapon", notDrawn: true, name: "Shotgun" },
    { group: "feature", name: "Second Wind" }, { group: "program", level: 0, name: "Zap" }, { group: "implant", name: "Optics" },
    { group: "weapon", name: "Pistol" }
  ];
  assert.deepEqual(rows.sort(compareOptions).map(row => row.name), ["Pistol", "Shotgun", "Optics", "Second Wind", "Zap", "Haste", "Grenade"]);
});
