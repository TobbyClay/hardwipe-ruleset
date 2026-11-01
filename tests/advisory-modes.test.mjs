import test from "node:test";
import assert from "node:assert/strict";
import { collectAttackAdvisory, collectRangedAdvisory, maskTargetSources, unlabelledSource } from "../scripts/hardwipe-ranged.js";

test("rules the target grants are marked, and masked for anyone but the GM", () => {
  const ranged = { attack: { type: { value: "ranged" } }, actionType: "rwak" };
  const data = collectRangedAdvisory({ activity: ranged, attackRollModifierTracker: { attribution: {
    ADV: { "attack.rwak": "Optical Targeting - Ranged attacks" },
    DIS: { "grants.disadvantage.attack.all QA Ninja": "Mirror Veil - Disadvantage (QA Ninja)", "grants.disadvantage.attack.rwak QA Ninja": "Smoke Screen - Disadvantage (QA Ninja)" }
  } } });
  assert.deepEqual(data.sources, [
    { type: "ADV", name: "Optical Targeting - Ranged attacks" },
    { type: "DIS", name: "Mirror Veil - Disadvantage (QA Ninja)", grants: true },
    { type: "DIS", name: "Smoke Screen - Disadvantage (QA Ninja)", grants: true }
  ]);
  assert.deepEqual(maskTargetSources(data.sources, "Granted by the target"), [
    { type: "ADV", name: "Optical Targeting - Ranged attacks" },
    { type: "DIS", name: "Granted by the target", grants: true }
  ]);
});

const melee = { attack: { type: { value: "melee" } }, actionType: "mwak" };
const ranged = { attack: { type: { value: "ranged" } }, actionType: "rwak" };
const workflow = (activity, attribution) => ({ activity, attackRollModifierTracker: { attribution } });

test("a melee attack reads Midi's live tracker and is marked as applied, not manual", () => {
  const data = collectAttackAdvisory(workflow(melee, { ADV: { flanking: "Flanking" }, DIS: { "config-buttons": "Dialog" }, NODIS: { "attack.all": "Steady Hands - No disadvantage" } }));
  assert.equal(data.manual, false);
  assert.deepEqual(data.sources, [{ type: "ADV", name: "Flanking" }, { type: "NODIS", name: "Steady Hands - No disadvantage" }]);
});

test("a ranged attack keeps the manual-mode rules", () => {
  const w = workflow(ranged, { ADV: { "attack.rwak": "Optical Targeting - Ranged attacks" } });
  assert.deepEqual(collectAttackAdvisory(w), collectRangedAdvisory(w));
  assert.equal(collectAttackAdvisory(w).manual, true);
});

test("an activity without an attack yields no sources", () => {
  assert.deepEqual(collectAttackAdvisory(workflow({ actionType: "save" }, { ADV: { x: "X" } })).sources, []);
});

test("a rolled mode that no source and no choice explains gets an unlabelled row; an explained one does not", () => {
  const labels = { name: "Unlabelled modifier", rule: "Set by a macro, a module or the system" };
  assert.deepEqual(unlabelledSource([], 1, {}, labels), { type: "ADV", name: "Unlabelled modifier - Set by a macro, a module or the system", unlabelled: true });
  assert.equal(unlabelledSource([], 1, { ADV: { "config-buttons": "Dialog" } }, labels), null);
  assert.equal(unlabelledSource([], 1, { ADV: { keyPress: "Key" } }, labels), null);
  // Fast-forwarded past the dialog, Midi still says "Roll Dialog": that is not the roller's click.
  assert.equal(unlabelledSource([], -1, { DIS: { "config-buttons": "Roll Dialog" } }, labels, { dialogUsed: false })?.type, "DIS");
  assert.equal(unlabelledSource([], -1, { DIS: { keyPress: "Key" } }, labels, { dialogUsed: false }), null);
  // A macro's workflow options are not the roller's click either.
  assert.equal(unlabelledSource([], 1, { ADV: { workflowOptions: "Workflow options" } }, labels)?.type, "ADV");
  assert.equal(unlabelledSource([{ type: "ADV", name: "Flanking" }], 1, {}, labels), null);
  assert.equal(unlabelledSource([{ type: "ADV", name: "Flanking" }], 0, {}, labels), null);
  assert.equal(unlabelledSource([{ type: "ADV", name: "Flanking" }], -1, {}, labels)?.type, "DIS");
  assert.equal(unlabelledSource([{ type: "ADV", name: "A" }, { type: "DIS", name: "B" }], 0, {}, labels), null);
  assert.equal(unlabelledSource([], undefined, {}, labels), null);
});

test("players see neither a target's rule names nor the unlabelled row, which is a note for the GM", async () => {
  const { playerSources } = await import("../scripts/hardwipe-ranged.js");
  const sources = [
    { type: "DIS", name: "Poisoned - Disadvantage on attack rolls" },
    { type: "DIS", name: "Mirror Veil - Disadvantage (QA Ninja)", grants: true },
    { type: "ADV", name: "Unlabelled modifier - Not named by any rule", unlabelled: true }
  ];
  assert.deepEqual(playerSources(sources, "Granted by the target"), [
    { type: "DIS", name: "Poisoned - Disadvantage on attack rolls" },
    { type: "DIS", name: "Granted by the target", grants: true }
  ]);
  assert.deepEqual(maskTargetSources(sources, "Granted by the target").at(-1), { type: "ADV", name: "Unlabelled modifier - Not named by any rule", unlabelled: true });
});
