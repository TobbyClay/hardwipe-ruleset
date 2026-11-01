import test from "node:test";
import assert from "node:assert/strict";
import {
  RollRules, applyToTracker, catalogue, conditionsInForce, describeScope, describeWhen, explainRollModes, flagRows, foldRows, glossCondition,
  modeGroups, modeRules, parseRuleKey, planModeSwitch
} from "../scripts/hardwipe-roll-rules.js";

const ABILITIES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const SKILLS = { ath: "Athletics", prc: "Perception", ste: "Stealth" };
const labels = { abilityNames: ABILITIES, skillNames: SKILLS };
const ability = (check = 0, save = 0) => ({ check: { roll: { mode: check } }, save: { roll: { mode: save } } });
const abilities = (pick = () => [0, 0]) => Object.fromEntries(Object.keys(ABILITIES).map(id => [id, ability(...pick(id))]));
const brief = rows => rows.map(row => [row.type, row.name, row.scopeText]);

test("mode effects group by their feature, with the active one marked, and a switch plan touches only what changes", () => {
  const entries = [
    { id: "aim", uuid: "Item.gun.ActiveEffect.aim", name: "Aim", disabled: true, parentId: "gun", parentName: "Smartgun", img: "gun.png" },
    { id: "spray", uuid: "Item.gun.ActiveEffect.spray", name: "Spray", disabled: false, parentId: "gun", parentName: "Smartgun", img: "gun.png" },
    { id: "guard", uuid: "Actor.a.ActiveEffect.guard", name: "Guard", disabled: true, parentId: "actor", parentName: "Nova", img: "nova.png" }
  ];
  assert.deepEqual(modeGroups(entries).map(group => [group.parentId, group.activeId, group.modes.map(mode => [mode.name, mode.active])]), [
    ["gun", "spray", [["Aim", false], ["Spray", true]]],
    ["actor", null, [["Guard", false]]]
  ]);
  const gun = entries.filter(entry => entry.parentId === "gun");
  assert.deepEqual(planModeSwitch(gun, "aim"), [{ _id: "aim", disabled: false }, { _id: "spray", disabled: true }]);
  assert.deepEqual(planModeSwitch(gun, "spray"), []);
  assert.deepEqual(planModeSwitch(gun, null), [{ _id: "spray", disabled: true }]);
});

test("a mode's rules cover Midi flags and D&D5e roll mode keys", () => {
  const rows = modeRules({ name: "Brace", changes: [
    { key: "flags.midi-qol.advantage.attack.rwak", value: "1" },
    { key: "system.abilities.str.save.roll.mode", value: "1" },
    { key: "system.skills.ste.roll.mode", value: "-1" },
    { key: "system.attributes.ac.bonus", value: "2" }
  ] });
  assert.deepEqual(foldRows(rows, labels).map(row => [row.type, row.scopeText]),
    [["ADV", "Ranged weapon attacks"], ["ADV", "Strength saves"], ["DIS", "Stealth checks"]]);
});

test("only Midi roll-mode flags parse, with their family, scope and grants side", () => {
  assert.deepEqual(parseRuleKey("flags.midi-qol.advantage.attack.rwak"), { grants: false, type: "ADV", scope: "attack.rwak" });
  assert.deepEqual(parseRuleKey("flags.midi-qol.grants.disadvantage.attack.all"), { grants: true, type: "DIS", scope: "attack.all" });
  assert.deepEqual(parseRuleKey("flags.midi-qol.noAdvantage.all"), { grants: false, type: "NOADV", scope: "all" });
  assert.equal(parseRuleKey("flags.midi-qol.fail.ability.save.all"), null);
  assert.equal(parseRuleKey("system.skills.ste.roll.mode"), null);
});

test("scopes read as the rolls they cover", () => {
  assert.equal(describeScope("attack.all"), "All attacks");
  assert.equal(describeScope("attack.rwak"), "Ranged weapon attacks");
  assert.equal(describeScope("attack.dex", labels), "Attacks with Dexterity");
  assert.equal(describeScope("ability.save.int", labels), "Intelligence saves");
  assert.equal(describeScope("skill.prc", labels), "Perception checks");
  assert.equal(describeScope("initiative"), "Initiative");
});

test("a flag value is always, never, or a condition put into words where the shape is known", () => {
  assert.equal(describeWhen("1").always, true);
  assert.equal(describeWhen(1).always, true);
  assert.equal(describeWhen("false").never, true);
  const when = describeWhen('target.statuses.has("prone")');
  assert.deepEqual([when.always, when.text, when.expression], [false, "the target is prone", 'target.statuses.has("prone")']);
  assert.equal(glossCondition('raceOrType === "undead" && item.type === "weapon"'), "you are undead and the item is a weapon");
});

test("only rules in force are listed: switched-off effects and flags set to 0 are left out", () => {
  const rows = catalogue([
    { name: "Optical Targeting", source: "Kiroshi Optics", changes: [{ key: "flags.midi-qol.advantage.attack.rwak", value: "1" }, { key: "system.attributes.ac.bonus", value: "1" }] },
    { name: "Jammer field", source: "", disabled: true, changes: [{ key: "flags.midi-qol.grants.advantage.attack.all", value: "1" }] },
    { name: "Dormant", source: "", changes: [{ key: "flags.midi-qol.disadvantage.attack.all", value: "0" }] },
    { name: "Kneecapper", source: "Smartgun", changes: [{ key: "flags.midi-qol.disadvantage.skill.prc", value: 'target.statuses.has("prone")' }] }
  ]);
  assert.deepEqual(rows.map(row => [row.type, row.name, row.scope, row.when.always]),
    [["ADV", "Optical Targeting", "attack.rwak", true], ["DIS", "Kneecapper", "skill.prc", false]]);
  assert.deepEqual(flagRows({ advantage: { attack: { all: "1" } }, disadvantage: { attack: { all: "false" } } }).map(row => [row.type, row.name]),
    [["ADV", "Set on the character directly"]]);
});

test("D&D5e's condition table is read like the system reads it: levels, immunity, and dodging's exceptions", () => {
  const table = { abilityCheckDisadvantage: ["poisoned", "exhaustion-1"], attackDisadvantage: ["poisoned", "exhaustion-3"],
    dexteritySaveAdvantage: ["dodging"], noMovement: ["grappled", "restrained"] };
  const name = (status, level) => level ? `${status[0].toUpperCase()}${status.slice(1)} ${level}` : `${status[0].toUpperCase()}${status.slice(1)}`;
  const read = snapshot => conditionsInForce(table, { leveled: ["exhaustion"], ...snapshot }, name);
  assert.deepEqual(read({ statuses: ["poisoned"] }), { abilityCheckDisadvantage: ["Poisoned"], attackDisadvantage: ["Poisoned"] });
  assert.deepEqual(read({ statuses: ["exhaustion"], levels: { exhaustion: 2 } }), { abilityCheckDisadvantage: ["Exhaustion 2"] });
  assert.deepEqual(read({ statuses: ["exhaustion"], levels: { exhaustion: 4 } }), { abilityCheckDisadvantage: ["Exhaustion 4"], attackDisadvantage: ["Exhaustion 4"] });
  assert.deepEqual(read({ statuses: ["poisoned"], immunities: ["poisoned"] }), {});
  assert.deepEqual(read({ statuses: ["dodging"] }), { dexteritySaveAdvantage: ["Dodging"] });
  assert.deepEqual(read({ statuses: ["dodging", "incapacitated"] }), {});
  // Grappled stops movement, so dodging no longer helps Dexterity saves.
  assert.deepEqual(read({ statuses: ["dodging", "grappled"] }), { noMovement: ["Grappled"] });
});

test("D&D5e's roll mode fields are named after their cause; nothing unexplained hides behind a generic row unless nothing explains it", () => {
  const system = { abilities: abilities(id => [-1, ["str", "dex", "con"].includes(id) ? -1 : 0]), skills: { ste: { roll: { mode: -1 } }, ath: { roll: { mode: 1 } } },
    attributes: { init: { roll: { mode: 1 } } } };
  const rows = explainRollModes(system, {
    conditions: { abilityCheckDisadvantage: ["Poisoned"], physicalSaveDisadvantage: ["Heavily Encumbered"] },
    physical: ["str", "dex", "con"], stealthArmor: "Plate", athlete: { name: "Remarkable Athlete", skills: ["ath"], initiative: true }
  });
  assert.deepEqual(brief(foldRows(rows, labels)), [
    ["ADV", "Remarkable Athlete", "Athletics checks"],
    ["ADV", "Remarkable Athlete", "Initiative"],
    ["DIS", "Heavily Encumbered", "Strength, Dexterity, and Constitution saves"],
    ["DIS", "Plate", "Stealth checks"],
    ["DIS", "Poisoned", "Ability checks"]
  ]);
  // An effect that sets the field names the row; one nothing explains keeps the fallback name.
  const effects = explainRollModes({ abilities: { dex: ability(0, 1), wis: ability(0, -1) } },
    { effects: { "system.abilities.dex.save.roll.mode": [{ name: "Evasion Rig", value: "1" }] }, fallback: "Sheet roll mode" });
  assert.deepEqual(brief(foldRows(effects, labels)), [["ADV", "Evasion Rig", "Dexterity saves"], ["DIS", "Sheet roll mode", "Wisdom saves"]]);
  // A field set only by a feature mode is listed under the mode, not here.
  assert.deepEqual(explainRollModes({ abilities: { str: ability(0, 1) } }, { effects: { "system.abilities.str.save.roll.mode": [{ name: "Brace", value: "1", mode: true }] } }), []);
  // Straight fields produce nothing.
  assert.deepEqual(explainRollModes({ abilities: abilities(), skills: { ste: { roll: { mode: 0 } } } }, {}), []);
});

test("rows fold one cause across abilities and skills, but never across causes, directions or conditions", () => {
  const row = (type, name, scope, extra = {}) => ({ type, grants: false, name, source: "", scope, when: { always: true }, ...extra });
  const rows = [
    ...Object.keys(ABILITIES).map(id => row("DIS", "Poisoned", `ability.check.${id}`)),
    row("DIS", "Poisoned", "attack.all"),
    row("DIS", "Exhaustion 3", "ability.save.str"), row("DIS", "Exhaustion 3", "ability.save.dex"),
    row("ADV", "Sharp Ears", "skill.prc"), row("ADV", "Sharp Ears", "skill.ste"),
    row("DIS", "Kneecapper", "skill.prc", { when: { always: false, expression: "x" } }), row("DIS", "Kneecapper", "skill.ste", { when: { always: false, expression: "y" } }),
    row("DIS", "Jammer", "attack.all", { grants: true })
  ];
  assert.deepEqual(foldRows(rows, labels).map(r => [r.grants, r.type, r.name, r.scopeText]), [
    [false, "ADV", "Sharp Ears", "Perception and Stealth checks"],
    [false, "DIS", "Exhaustion 3", "Strength and Dexterity saves"],
    [false, "DIS", "Kneecapper", "Perception checks"],
    [false, "DIS", "Kneecapper", "Stealth checks"],
    [false, "DIS", "Poisoned", "Ability checks"],
    [false, "DIS", "Poisoned", "All attacks"],
    [true, "DIS", "Jammer", "All attacks"]
  ]);
});

test("one cause on all ability checks is one row, whether it came as \"all checks\" or ability by ability", () => {
  const row = (name, scope) => ({ type: "DIS", grants: false, name, source: "", scope, when: { always: true } });
  const rows = [row("Poisoned", "ability.check.all"), ...Object.keys(ABILITIES).map(id => row("Poisoned", `ability.check.${id}`)), row("Poisoned", "skill.all"), row("Poisoned", "ability.save.all")];
  assert.deepEqual(foldRows(rows, labels).map(r => r.scopeText), ["Ability checks", "Saving throws", "Skill checks"]);
});

test("registered rules add named sources to Midi's tracker; only rules in force on the actor reach the sheet", () => {
  const calls = [];
  const side = key => ({ add: (id, label) => calls.push([key, "add", id, label]), suppress: (id, label) => calls.push([key, "suppress", id, label]) });
  const tracker = { advantage: side("advantage"), disadvantage: side("disadvantage") };
  RollRules._sources.clear();
  RollRules.register({ id: "high-ground", name: "High ground", rule: "Shooting from above", test: workflow => workflow.elevated ? "ADV" : null,
    describe: { type: "ADV", scope: "attack.all" }, active: actor => actor.elevated });
  RollRules.register({ id: "jammed", name: "Jammed optics", test: () => "NOADV" });
  RollRules.register({ id: "broken", name: "Broken", test: () => { throw new Error("boom"); }, active: () => { throw new Error("boom"); } });
  assert.deepEqual(RollRules.evaluate({ elevated: true }), [
    { type: "ADV", id: "hardwipe:high-ground", label: "High ground - Shooting from above" },
    { type: "NOADV", id: "hardwipe:jammed", label: "Jammed optics" }
  ]);
  for (const entry of RollRules.evaluate({ elevated: true })) applyToTracker(tracker, entry.type, entry.id, entry.label);
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [["advantage", "add", "hardwipe:high-ground"], ["advantage", "suppress", "hardwipe:jammed"]]);
  assert.deepEqual(RollRules.liveRows({ elevated: true }).map(row => [row.type, row.name, row.scope]), [["ADV", "High ground", "attack.all"]]);
  assert.deepEqual(RollRules.liveRows({ elevated: false }), []);
  assert.throws(() => RollRules.register({ id: "no-test", name: "No test" }), /test\(workflow\)/);
  RollRules._sources.clear();
});
