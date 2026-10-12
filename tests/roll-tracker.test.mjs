import test from "node:test";
import assert from "node:assert/strict";
import { awards, chiSquareP, extractRecords, readD20, summarize } from "../scripts/hardwipe-roll-data.js";

const d20 = (results, options = {}) => ({ kind: "d20", options, total: 0, dice: [{ faces: 20, results: results.map(([v, a = true]) => ({ v, a })) }] });
const damage = (total, type, options = {}) => ({ kind: "damage", options: { type, ...options }, total, dice: [{ faces: 8, results: [{ v: total, a: true }] }] });
const message = data => ({ id: "m1", timestamp: 1000, author: "gm", speaker: { actor: "pc" }, whisper: [], blind: false, system: {}, flags: {}, rolls: [], ...data });
const ownedBy = (actor, author) => actor === "pc" ? "player" : author;

test("an attack card: the spell is used once, the attack hits, damage is typed", () => {
  const attack = { ...d20([[20]], { criticalSuccess: 20, target: 13, "midi-qol": { rollType: "attack" } }), total: 25 };
  const records = extractRecords(message({
    type: "usage", author: "player",
    system: { item: { name: "Fire Bolt", type: "spell" }, level: 0 },
    flags: { "midi-qol": { resolvedTargetACs: [{ isHit: true, targetACWithoutCover: 13 }] } },
    rolls: [attack, damage(8, "fire", { "midi-qol": { rollType: "defaultDamage" }, isCritical: true })]
  }), { userFor: ownedBy });
  const [use, atk, dmg] = records;
  assert.deepEqual(use, { k: "m1.use", t: 1000, u: "player", b: "player", a: "pc", c: "use", i: "Fire Bolt", y: "spell", l: 0 });
  assert.equal(atk.k, "m1.atk.0");
  assert.equal(atk.n, 20);
  assert.equal(atk.r, 1);
  assert.equal(atk.o, 1);
  assert.equal(atk.x, 13);
  assert.equal(dmg.c, "dmg");
  assert.equal(dmg.d, "fire");
  assert.equal(dmg.r, 1);
});

test("a GM roll for a player's character counts for the player; private rolls are marked", () => {
  const [save] = extractRecords(message({ type: "save", whisper: ["gm"], system: { ability: "dex" }, rolls: [{ ...d20([[7]], { target: 13 }), total: 9 }] }), { userFor: ownedBy });
  assert.equal(save.u, "player");
  assert.equal(save.b, "gm");
  assert.equal(save.p, 1);
  assert.equal(save.o, 0);
  assert.equal(save.s, "dex");
});

test("advantage keeps one die and remembers the dropped one", () => {
  const roll = d20([[4, false], [17]], { advantageMode: 1 });
  assert.deepEqual(readD20(roll), { n: 17, m: 1, r: false, fumble: false, dropped: [4] });
  const [record] = extractRecords(message({ type: "check", system: { skill: "ste", ability: "dex" }, rolls: [{ ...roll, total: 20 }] }));
  assert.equal(record.c, "skill");
  assert.equal(record.s, "ste");
  assert.equal(record.m, 1);
  assert.deepEqual(record.w, [4]);
  assert.equal("o" in record, false);
});

test("death saves, concentration, initiative and healing are told apart", () => {
  const kinds = [
    message({ id: "a", type: "save", system: { type: "death" }, rolls: [{ ...d20([[12]]), total: 12 }] }),
    message({ id: "b", type: "save", system: { type: "concentration", ability: "con" }, rolls: [{ ...d20([[3]], { target: 10 }), total: 8 }] }),
    message({ id: "c", type: "check", system: { type: "initiative" }, rolls: [{ ...d20([[15]]), total: 18 }] }),
    message({ id: "d", type: "usage", system: { item: { name: "Cure Wounds", type: "spell" }, level: 2 }, rolls: [damage(9, "healing")] })
  ].flatMap(entry => extractRecords(entry));
  assert.deepEqual(kinds.map(record => record.c), ["death", "conc", "init", "use", "heal"]);
  assert.equal(kinds[0].o, 1);
  assert.equal(kinds[0].x, 10);
  assert.equal(kinds[1].o, 0);
  assert.equal(kinds[3].l, 2);
});

test("Hardwipe's downed and flatlined cards count as events", () => {
  const downed = extractRecords(message({ type: "base", speaker: {}, flags: { "hardwipe-ruleset": { type: "hardwipe-card", kind: "downed", actorId: "pc" } } }));
  const dead = extractRecords(message({ type: "base", speaker: {}, flags: { "hardwipe-ruleset": { type: "hardwipe-death", actorId: "pc" } } }));
  assert.deepEqual([downed[0].e, downed[0].a, dead[0].e], ["downed", "pc", "flatlined"]);
});

test("a re-rolled card keeps the same keys, so the record is replaced, not doubled", () => {
  const first = extractRecords(message({ type: "usage", system: { item: { name: "Bow", type: "weapon" } }, rolls: [{ ...d20([[6]], { "midi-qol": { rollType: "attack" } }), total: 9 }] }));
  const second = extractRecords(message({ type: "usage", system: { item: { name: "Bow", type: "weapon" } }, rolls: [{ ...d20([[6, false], [19]], { advantageMode: 1, "midi-qol": { rollType: "attack" } }), total: 22 }] }));
  assert.deepEqual(first.map(record => record.k), second.map(record => record.k));
  assert.equal(second[1].n, 19);
});

test("summary: averages, streaks, rates and the fairness test", () => {
  const faces = [20, 18, 15, 12, 1, 3, 11, 20];
  const records = faces.map((n, index) => ({ k: `r${index}`, t: index, u: "p", c: index % 2 ? "save" : "atk", n, v: n + 3, o: n >= 10 ? 1 : 0, r: n === 20 ? 1 : undefined, f: { 20: 1 } }));
  records.push({ k: "d", t: 9, u: "p", c: "dmg", v: 14, d: "fire", i: "Sword", f: { 8: 2 } });
  records.push({ k: "s", t: 10, u: "p", c: "use", y: "spell", l: 3, i: "Fireball" });
  const s = summarize(records);
  assert.equal(s.d20.n, 8);
  assert.equal(s.d20.avg, 12.5);
  assert.equal(s.d20.nat20, 2);
  assert.equal(s.d20.nat1, 1);
  assert.equal(s.d20.hot, 4);
  assert.equal(s.d20.cold, 2);
  assert.equal(s.atk.n, 4);
  assert.equal(s.atk.rate, 0.75);
  assert.equal(s.save.rate, 0.75);
  assert.equal(s.dmg.max, 14);
  assert.equal(s.cast.byLevel[3], 1);
  assert.equal(s.diceTotal, 10);
  assert.ok(chiSquareP(new Array(20).fill(10)) > 0.99);
  assert.ok(chiSquareP([200, ...new Array(19).fill(10)]) < 0.001);
});

test("awards need enough rolls, and ties are shared", () => {
  const entry = (id, avgFace, n) => ({ id, stats: summarize(Array.from({ length: n }, (_, index) => ({ k: `${id}${index}`, t: index, u: id, c: "atk", n: avgFace, v: avgFace, f: { 20: 1 } }))) });
  const list = [entry("a", 15, 12), entry("b", 15, 12), entry("c", 19, 4)];
  const golden = awards(list).find(award => award.id === "golden");
  assert.deepEqual(golden.entities, ["a", "b"]);
  assert.equal(golden.runner, null);
});

test("awards name a runner-up, the next distinct score", () => {
  const entry = (id, avgFace) => ({ id, stats: summarize(Array.from({ length: 12 }, (_, index) => ({ k: `${id}${index}`, t: index, u: id, c: "atk", n: avgFace, v: avgFace, f: { 20: 1 } }))) });
  const list = [entry("a", 15), entry("b", 12), entry("c", 12), entry("d", 9)];
  const golden = awards(list).find(award => award.id === "golden");
  assert.deepEqual(golden.entities, ["a"]);
  assert.deepEqual(golden.runner, { entities: ["b", "c"], value: 12 });
  const cursed = awards(list).find(award => award.id === "cursed");
  assert.deepEqual([cursed.entities, cursed.runner.entities], [["d"], ["b", "c"]]);
});
