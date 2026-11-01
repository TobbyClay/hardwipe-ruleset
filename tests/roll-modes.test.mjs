import test from "node:test";
import assert from "node:assert/strict";
import { extractRecords, summarize } from "../scripts/hardwipe-roll-data.js";

const d20 = (results, options = {}) => ({ kind: "d20", options, total: 0, dice: [{ faces: 20, results: results.map(([v, a = true]) => ({ v, a })) }] });
const attackCard = (id, user, sources, mode) => ({
  id, timestamp: 1000, author: user, speaker: { actor: "pc" }, whisper: [], blind: false, type: "usage",
  system: { item: { name: "QA Ballistic Rifle", type: "weapon" } },
  flags: { "midi-qol": { resolvedTargetACs: [{ isHit: true, targetACWithoutCover: 12 }] }, "hardwipe-ruleset": sources ? { rangedAdvisory: { version: 4, mode: "manual", sources } } : {} },
  rolls: [{ ...d20(mode === 1 ? [[14], [6, false]] : mode === -1 ? [[6], [14, false]] : [[14]], { advantageMode: mode, "midi-qol": { rollType: "attack" } }), total: 18 }]
});

test("an attack record carries its card's named sources; cards without a scan carry none", () => {
  const [, atk] = extractRecords(attackCard("m1", "u1", [{ type: "ADV", name: "Flanking" }, { type: "DIS", name: "Long Range" }], 0));
  assert.deepEqual(atk.z, ["ADV:Flanking", "DIS:Long Range"]);
  const [, plain] = extractRecords(attackCard("m2", "u1", null, 1));
  assert.equal(plain.z, undefined);
  const [, bad] = extractRecords({ ...attackCard("m3", "u1", [{ type: "ADV", name: "  " }, { name: "no type" }], 0) });
  assert.equal(bad.z, undefined);
});

test("a rule the target granted is not counted as the roller's source", () => {
  const [, atk] = extractRecords(attackCard("m9", "u1", [{ type: "ADV", name: "Flanking" }, { type: "DIS", name: "Granted by the target", grants: true }], 0));
  assert.deepEqual(atk.z, ["ADV:Flanking"]);
});

test("the summary counts each source, who rolled with it, and how many advantage or disadvantage attacks named one", () => {
  const records = [
    ...extractRecords(attackCard("m1", "u1", [{ type: "ADV", name: "Flanking" }], 1)),
    ...extractRecords(attackCard("m2", "u2", [{ type: "ADV", name: "Flanking" }, { type: "NODIS", name: "Steady Hands - No disadvantage" }], 1)),
    ...extractRecords(attackCard("m3", "u1", [{ type: "DIS", name: "Long Range" }], -1)),
    ...extractRecords(attackCard("m4", "u2", null, 1)),
    ...extractRecords(attackCard("m5", "u2", null, 0))
  ];
  const s = summarize(records);
  assert.deepEqual(s.modes.ADV, { Flanking: 2 });
  assert.deepEqual(s.modes.DIS, { "Long Range": 1 });
  assert.deepEqual(s.modes.NODIS, { "Steady Hands - No disadvantage": 1 });
  assert.deepEqual(s.modes.users["ADV:Flanking"], ["u1", "u2"]);
  assert.deepEqual(s.modes.total, { adv: 3, dis: 1 });
  assert.deepEqual(s.modes.named, { adv: 2, dis: 1 });
  assert.equal(s.d20.adv, 3);
});
