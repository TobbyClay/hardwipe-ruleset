import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, dialPercent, initiativeChoices, lineIndex, nextTheme, signed, skillParts } from "../scripts/hardwipe-initiative-choice.js";

test("ordinary initiative comes first, then every skill by name with its bonus", () => {
  const choices = initiativeChoices({ init: 3, initAbility: "DEX", skills: [
    { key: "ste", label: "Stealth", ability: "DEX", total: 7, proficient: true },
    { key: "ath", label: "Athletics", ability: "STR", total: -1, proficient: false },
    { key: "dec", label: "Deception", ability: "CHA", total: 4, proficient: true }
  ] });
  assert.deepEqual(choices.map(choice => choice.value), ["init", "ath", "dec", "ste"]);
  assert.deepEqual(choices[0], { value: "init", label: "DEX", mod: 3 });
  assert.equal(choices[1].label, "Athletics (STR)");
  assert.equal(choices[1].mod, -1);
  assert.equal(choices[3].proficient, true);
});

test("a skill replaces the initiative's own modifier, and keeps condition penalties and the tiebreaker", () => {
  assert.deepEqual(skillParts(["@mod", "@prof", "@ruleBonus", "@reductions.exhaustion", "0.14"]), ["@hardwipeSkill", "@reductions.exhaustion", "0.14"]);
  assert.deepEqual(skillParts(["@mod"]), ["@hardwipeSkill"]);
  assert.deepEqual(skillParts(undefined), ["@hardwipeSkill"]);
});

test("every line of the bank can come up, and nothing past it", () => {
  assert.equal(lineIndex(0, 12), 1);
  assert.equal(lineIndex(0.999, 12), 12);
  assert.equal(lineIndex(0.5, 12), 7);
  assert.equal(lineIndex(1, 12), 12);
});

test("bonuses read with their sign", () => {
  assert.equal(signed(3), "+3");
  assert.equal(signed(0), "+0");
  assert.equal(signed(-2), "−2");
});

test("the radio and NCPD voices take turns, starting with the radio", () => {
  assert.deepEqual(THEMES, ["radio", "ncpd"]);
  assert.equal(nextTheme(""), "radio");
  assert.equal(nextTheme("radio"), "ncpd");
  assert.equal(nextTheme("ncpd"), "radio");
  assert.equal(nextTheme("something else"), "radio");
});

test("the radio dial's needle sweeps the band from the first choice to the last", () => {
  assert.equal(dialPercent(0, 19), 4);
  assert.equal(dialPercent(18, 19), 96);
  assert.equal(dialPercent(40, 19), 96);
  assert.equal(dialPercent(0, 1), 4);
});
