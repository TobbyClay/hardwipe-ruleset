import test from "node:test";
import assert from "node:assert/strict";
import {
  createController, normalizeState, normalizePreferences, currentCue, currentReplay, isParticipant, elapsedLabel, durationLabel, timelinePositions
} from "../scripts/braindance/bd-state.js";
import { MemoryForms, remapActorReferences, FORM_FLAG } from "../scripts/braindance/bd-forms.js";
import { sceneSnapshot, rollbackPlan } from "../scripts/braindance/bd-reality.js";
import { normalizeClue, scanClues, revealClue, resetClues, visibleClues } from "../scripts/braindance/bd-clues.js";
import { echoEffectData, overloadTarget, scanBlocked } from "../scripts/braindance/bd-echoes.js";
import { escapeHTML } from "../scripts/braindance/bd-panel.js";
import { extractRecords, summarize } from "../scripts/hardwipe-roll-data.js";

const ID = "hardwipe-ruleset";
const clone = value => structuredClone(value);

/* Controller -------------------------------------------------------------------------------------- */

const pairings = [{ characterUuid: "Actor.hero", npcUuid: "Actor.npc" }];
function controllerFixture() {
  let state = normalizeState(), isGM = true, time = 10000, writes = 0, recovery = false, failSave = false, failRestore = false, ids = 0;
  const restores = [], echoes = { applied: [], cleared: 0 };
  const forms = {
    hasRecovery: () => recovery,
    async enter() { if (recovery) throw new Error("Pending recovery"); recovery = true; return { participantIds: ["p1"], actorUuids: ["Actor.form"] }; },
    async restore(options) { restores.push(options); if (failRestore) throw new Error("Restore failed"); recovery = false; }
  };
  const api = createController({
    read: () => state, write: async value => { if (failSave) throw new Error("Save failed"); writes++; state = clone(value); },
    getUser: () => ({ isGM }), forms, now: () => time, id: () => `id-${++ids}`,
    echoes: { apply: async (_session, cue) => { echoes.applied.push(cue); }, clear: async () => { echoes.cleared++; } }
  });
  return { api, read: () => state, forms, restores, echoes, writes: () => writes, player: () => { isGM = false; }, advance: ms => { time += ms; },
    failSave: value => { failSave = value; }, failRestore: value => { failRestore = value; }, now: () => time };
}

test("players cannot run any braindance operation", async () => {
  const f = controllerFixture(); f.player();
  for (const action of [() => f.api.start({ pairings }), () => f.api.stop(), () => f.api.update({ intensity: 99 }), () => f.api.cue("panic"),
    () => f.api.clearCue(), () => f.api.mark({ label: "x" }), () => f.api.replay("id-1"), () => f.api.removeMarker("id-1")])
    await assert.rejects(action, /OnlyGM/);
  assert.equal(f.writes(), 0); assert.equal(f.forms.hasRecovery(), false);
});

test("all pairings must be complete before transforming", async () => {
  const f = controllerFixture();
  for (const value of [[], [{}], [{ characterUuid: "Actor.hero" }]]) await assert.rejects(() => f.api.start({ pairings: value }), /IncompletePairing/);
  assert.equal(f.forms.hasRecovery(), false);
});

test("participants and decorated sheets come from transformation results; the timeline starts", async () => {
  const f = controllerFixture();
  await f.api.start({ pairings, participantIds: ["intruder"], actorUuids: ["Actor.npc"], label: "Afterlight" });
  assert.deepEqual(f.read().participantIds, ["p1"]); assert.deepEqual(f.read().actorUuids, ["Actor.form"]);
  assert.equal(f.read().markers.length, 1); assert.equal(f.read().markers[0].kind, "start"); assert.equal(f.read().markers[0].label, "Afterlight");
});

test("start rolls back forms (without touching walls) if publishing the session fails", async () => {
  const f = controllerFixture(); f.failSave(true);
  await assert.rejects(() => f.api.start({ pairings }), /Save failed/);
  assert.equal(f.forms.hasRecovery(), false); assert.equal(f.read().active, false); assert.deepEqual(f.restores, [{ rollback: false }]);
});

test("failed rollback remains recoverable through stop", async () => {
  const f = controllerFixture(); f.failSave(true); f.failRestore(true);
  await assert.rejects(() => f.api.start({ pairings }), /RestorePending/);
  assert.equal(f.api.hasRecovery(), true);
  f.failSave(false); f.failRestore(false); await f.api.stop(); assert.equal(f.api.hasRecovery(), false);
});

test("an unsuccessful restoration leaves session state and recovery intact", async () => {
  const f = controllerFixture(); await f.api.start({ pairings }); f.failRestore(true);
  await assert.rejects(() => f.api.stop(), /Restore failed/);
  assert.equal(f.read().active, true); assert.equal(f.api.hasRecovery(), true);
  f.failRestore(false); await f.api.stop(); assert.equal(f.read().active, false); assert.equal(f.api.hasRecovery(), false);
  assert.deepEqual(f.read().pairings, pairings); assert.deepEqual(f.read().actorUuids, []); assert.deepEqual(f.read().markers, []);
});

test("stop follows the memory's reality choice unless the GM overrides it", async () => {
  const f = controllerFixture();
  await f.api.start({ pairings }); await f.api.stop();
  await f.api.start({ pairings, reality: "keep" }); await f.api.stop();
  await f.api.start({ pairings, reality: "keep" }); await f.api.stop({ reality: "rollback" });
  assert.deepEqual(f.restores.map(entry => entry.rollback), [true, false, true]);
});

test("a new memory always starts on rollback without echo mechanics, whatever the last one used", async () => {
  const f = controllerFixture();
  await f.api.start({ pairings, reality: "keep", mechanics: true, label: "First" }); await f.api.stop();
  assert.equal(f.read().reality, "rollback"); assert.equal(f.read().mechanics, false); assert.equal(f.read().label, "First");
  await f.api.start({ pairings }); await f.api.stop();
  assert.deepEqual(f.restores.map(entry => entry.rollback), [false, true]);
});

test("pairings cannot change in a live memory, but moods, mechanics and reality can", async () => {
  const f = controllerFixture(); await f.api.start({ pairings });
  await assert.rejects(() => f.api.update({ pairings: [] }), /PairingsLocked/);
  await f.api.update({ preset: "noir", mechanics: true, reality: "keep" });
  assert.equal(f.read().preset, "noir"); assert.equal(f.read().mechanics, true); assert.equal(f.read().reality, "keep");
  await assert.rejects(() => f.api.start({ pairings }), /AlreadyActive/);
});

test("rapid operations serialize without overwriting each other's values", async () => {
  const f = controllerFixture(); await f.api.start({ pairings });
  await Promise.all([f.api.update({ intensity: 44 }), f.api.cue("panic", 5), f.api.mark({ label: "door" })]);
  assert.equal(f.read().intensity, 44); assert.equal(f.read().cue.kind, "panic"); assert.equal(f.read().markers.at(-1).label, "door");
});

test("echo mechanics: applied only when the memory has them on; cleared on a new echo, clear and stop", async () => {
  const f = controllerFixture(); await f.api.start({ pairings });
  await f.api.cue("panic", 5);
  assert.equal(f.echoes.applied.length, 0); assert.equal(f.read().cue.mechanics, false);
  await f.api.update({ mechanics: true });
  await f.api.cue("overload", 5);
  assert.equal(f.echoes.applied.length, 1); assert.equal(f.echoes.applied[0].kind, "overload"); assert.equal(f.read().cue.mechanics, true);
  const cleared = f.echoes.cleared;
  await f.api.clearCue(); await f.api.stop();
  assert.equal(f.echoes.cleared, cleared + 2);
});

test("echoes are logged on the timeline with the mood at that moment", async () => {
  const f = controllerFixture(); await f.api.start({ pairings, preset: "warm" }); f.advance(4000);
  await f.api.cue("interference", 8);
  const marker = f.read().markers.at(-1);
  assert.equal(marker.kind, "cue"); assert.equal(marker.cue, "interference"); assert.equal(marker.at, 4000); assert.equal(marker.preset, "warm");
});

test("cue expiry works after reconnect without another write", async () => {
  const f = controllerFixture(); await f.api.start({ pairings }); await f.api.cue("overload", 5);
  const reconnected = normalizeState(JSON.parse(JSON.stringify(f.read())));
  assert.equal(currentCue(reconnected, f.now()).kind, "overload"); f.advance(5000); assert.equal(currentCue(reconnected, f.now()), null);
});

test("cue bounds, failed queue recovery and configuration field isolation", async () => {
  const f = controllerFixture(); await assert.rejects(() => f.api.cue("panic"), /NotActive/); await f.api.start({ pairings });
  await f.api.update({ active: false, id: "forged", cue: { kind: "panic" }, participantIds: ["other"], markers: [], replay: { markerId: "x" } });
  assert.equal(f.read().active, true); assert.notEqual(f.read().id, "forged"); assert.equal(f.read().cue, null); assert.equal(f.read().markers.length, 1);
  await f.api.cue("panic", 999); assert.equal(f.read().cue.endsAt - f.now(), 60000);
  await assert.rejects(() => f.api.cue("unknown"), /UnknownCue/);
});

test("timeline: mark with a view, replay a moment, remove a marker", async () => {
  const f = controllerFixture(); await f.api.start({ pairings, preset: "noir" }); f.advance(12000);
  await f.api.cue("panic", 30); f.advance(1000);
  await f.api.mark({ label: "The shot", view: { sceneId: "s1", x: 400.4, y: 300, scale: 9 } });
  const mark = f.read().markers.at(-1);
  assert.equal(mark.at, 13000); assert.equal(mark.cue, "panic"); assert.deepEqual(mark.view, { sceneId: "s1", x: 400, y: 300, scale: 3 });
  await f.api.replay(mark.id, 99);
  const replay = currentReplay(f.read(), f.now());
  assert.equal(replay.marker.id, mark.id); assert.equal(replay.endsAt - f.now(), 20000);
  f.advance(20000); assert.equal(currentReplay(f.read(), f.now()), null);
  await assert.rejects(() => f.api.replay("missing"), /UnknownMarker/);
  await f.api.removeMarker(mark.id);
  assert.equal(f.read().markers.some(entry => entry.id === mark.id), false);
  assert.equal(normalizeState({ ...f.read(), replay: { id: "r", markerId: mark.id, endsAt: f.now() + 5000 } }).replay, null);
});

test("clues found are logged; the timeline keeps the latest 60 markers", async () => {
  const f = controllerFixture(); await f.api.start({ pairings });
  await f.api.logClue({ label: "Shell casing", view: { sceneId: "s1", x: 1, y: 2 } });
  assert.equal(f.read().markers.at(-1).kind, "clue");
  for (let index = 0; index < 70; index++) await f.api.mark({ label: `m${index}` });
  assert.equal(f.read().markers.length, 60); assert.equal(f.read().markers.at(-1).label, "m69");
  await f.api.stop();
  assert.equal(await f.api.logClue({ label: "late" }).then(state => state.active), false);
});

test("timeline positions span the elapsed memory", () => {
  const state = normalizeState({ active: true, startedAt: 1000, markers: [{ id: "a", kind: "start", at: 0 }, { id: "b", kind: "mark", at: 5000 }] });
  assert.deepEqual(timelinePositions(state, 11000).map(entry => entry.position), [0, 0.5]);
});

test("malformed state and HTML strings are normalized safely", () => {
  const state = normalizeState({ preset: "__proto__", intensity: Infinity, label: "x".repeat(200), pairings: [null], cue: { kind: "constructor" },
    reality: "maybe", markers: [{ kind: "evil", id: "x" }] });
  assert.equal(state.preset, "clean"); assert.equal(state.intensity, 35); assert.equal(state.label.length, 90); assert.equal(state.cue, null);
  assert.equal(state.reality, "rollback"); assert.deepEqual(state.markers, []);
  assert.deepEqual(state.pairings, [{ characterUuid: "", npcUuid: "" }]);
  assert.equal(normalizePreferences({ intensity: -100 }).intensity, 0);
  assert.equal(normalizePreferences({ layer: "xray" }).layer, "visual");
  assert.equal(escapeHTML('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;");
});

test("viewer selection and elapsed time", () => {
  const state = normalizeState({ active: true, participantIds: ["p1"] });
  assert.equal(isParticipant(state, { id: "p1" }), true); assert.equal(isParticipant(state, { id: "observer" }), false);
  assert.equal(isParticipant(state, { id: "gm", isGM: true }, { preview: true }), true);
  assert.equal(elapsedLabel(0, 3661000), "01:01:01"); assert.equal(durationLabel(-5), "00:00:00");
});

/* Memory forms ------------------------------------------------------------------------------------ */

class Collection extends Map { [Symbol.iterator]() { return this.values(); } }

function formsFixture({ reality = null } = {}) {
  let count = 0, recovery = "", failUser = false, failToken = false;
  const documents = new Map();
  const actors = new Collection(), users = new Collection(), journals = new Collection();
  const scenes = [{ id: "s1", tokens: new Collection() }, { id: "s2", tokens: new Collection() }];
  const tokenData = (actorId, image) => ({ actorId, actorLink: true, name: actorId, texture: { src: image, scaleX: 1 }, width: 1, height: 1, sight: { enabled: true, range: 30 }, flags: {}, delta: {} });
  const makeActor = source => {
    const data = clone(source); const actor = {
      id: data._id, uuid: `Actor.${data._id}`, documentName: "Actor", type: data.type, name: data.name, folder: null,
      toObject: () => clone(data), getFlag: (ns, key) => data.flags?.[ns]?.[key], testUserPermission: user => data.ownership[user.id] === 3,
      getTokenDocument: async () => ({ toObject: () => ({ ...clone(data.prototypeToken), actorId: data._id }) }),
      delete: async () => { documents.delete(actor.uuid); actors.delete(actor.id); }
    }; documents.set(actor.uuid, actor); actors.set(actor.id, actor); return actor;
  };
  const makeToken = (scene, id, source) => {
    let data = clone(source); const token = {
      id, uuid: `Scene.${scene.id}.Token.${id}`, name: id,
      get actorId() { return data.actorId; },
      get actorLink() { return data.actorLink; },
      toObject: () => clone(data),
      async update(patch) { if (failToken) { failToken = false; throw new Error("Token write failed"); } data = { ...data, ...clone(patch) }; return token; }
    }; documents.set(token.uuid, token); scene.tokens.set(id, token); return token;
  };
  const hero = makeActor({ _id: "hero", name: "Hero", type: "character", system: { abilities: { str: 10 }, hp: 12 }, items: [{ _id: "sword", name: "Sword" }], effects: [], img: "hero.webp", ownership: { p1: 3 }, flags: {}, prototypeToken: tokenData("hero", "hero-token.webp") });
  const npc = makeActor({ _id: "npc", name: "Memory Guard", type: "npc", system: { abilities: { str: 18 }, hp: 60 }, items: [{ _id: "gun", name: "Pistol" }, { _id: "eye", name: "Kiroshi optics", flags: { [ID]: { cyberware: { installed: true } } } }], effects: [{ _id: "e1", origin: "Actor.npc.Item.gun" }], img: "npc.webp", ownership: { default: 0 }, flags: { [ID]: { heat: 2 } }, prototypeToken: { ...tokenData("npc", "npc-token.webp"), width: 2 } });
  const user = { id: "p1", name: "Player", isGM: false, characterId: hero.id, get character() { return actors.get(this.characterId); },
    async update(patch) { if (failUser) { failUser = false; throw new Error("User write failed"); } this.characterId = patch.character; } };
  users.set(user.id, user);
  const first = makeToken(scenes[0], "t1", { ...tokenData(hero.id, "custom-hero.webp"), x: 300, y: 400, elevation: 5, hidden: false, rotation: 20 });
  const second = makeToken(scenes[1], "t2", { ...tokenData(hero.id, "other-hero.webp"), actorLink: false, delta: { system: { hp: 7 } }, x: 500, y: 500 });
  const game = { system: { id: "dnd5e" }, actors, users, scenes, settings: { get: () => recovery, set: async (_ns, _key, value) => { recovery = value; } } };
  const dependencies = { game, reality, resolve: async uuid => documents.get(uuid), randomId: () => `form${++count}`,
    createActor: async data => makeActor(data), createJournal: async source => {
      const id = `j${++count}`, data = clone(source);
      const journal = { uuid: `JournalEntry.${id}`, toObject: () => clone(data), getFlag: (ns, key) => data.flags[ns][key], delete: async () => { documents.delete(journal.uuid); journals.delete(id); } };
      documents.set(journal.uuid, journal); journals.set(id, journal); return journal;
    }
  };
  return { service: new MemoryForms(dependencies), dependencies, game, hero, npc, user, first, second, actors, documents, journals, makeToken,
    pairings: [{ characterUuid: hero.uuid, npcUuid: npc.uuid }], failUser: () => { failUser = true; }, failToken: () => { failToken = true; } };
}

test("an NPC form replaces the complete data model, implants and internal references, keeping its Hardwipe flags", async () => {
  const f = formsFixture(), original = f.hero.toObject(), template = f.npc.toObject();
  await f.service.enter(f.pairings, "memory"); const form = f.user.character;
  assert.equal(form.type, "npc"); assert.deepEqual(form.toObject().system, template.system); assert.deepEqual(form.toObject().items, template.items);
  assert.equal(form.toObject().img, "npc.webp"); assert.equal(form.toObject().effects[0].origin, `${form.uuid}.Item.gun`);
  assert.equal(form.toObject().ownership.p1, 3); assert.deepEqual(f.hero.toObject(), original); assert.deepEqual(f.npc.toObject(), template);
  assert.equal(form.getFlag(ID, "heat"), 2);
  assert.deepEqual(form.getFlag(ID, FORM_FLAG), { sessionId: "memory", originalUuid: "Actor.hero", npcUuid: "Actor.npc", originalName: "Hero" });
});

test("all scenes transform and restore, preserving movement and unlinked token overrides", async () => {
  const f = formsFixture(), firstBefore = f.first.toObject(), secondBefore = f.second.toObject();
  await f.service.enter(f.pairings, "memory");
  assert.equal(f.first.actorId, f.user.character.id); assert.equal(f.second.actorId, f.user.character.id);
  assert.equal(f.first.toObject().texture.src, "npc-token.webp"); assert.equal(f.second.toObject().actorLink, true);
  assert.equal(f.first.toObject().flags[ID].braindanceToken.sessionId, "memory");
  await f.first.update({ x: 900, y: 100, elevation: 7 });
  await f.service.restore();
  assert.deepEqual(f.first.toObject(), { ...firstBefore, x: 900, y: 100, elevation: 7 }); assert.deepEqual(f.second.toObject(), secondBefore);
  assert.equal(f.user.character.id, "hero"); assert.equal(f.actors.size, 2); assert.equal(f.journals.size, 0);
});

test("recovery uses a GM-only journal holding the reality record; the world setting holds only a reference", async () => {
  const f = formsFixture({ reality: { snapshot: async () => ({ scenes: [{ sceneId: "s1" }] }), rollback: async () => {} } });
  await f.service.enter(f.pairings, "memory");
  const journal = [...f.journals][0]; assert.deepEqual(journal.toObject().ownership, { default: 0 });
  assert.equal(f.service.reference, journal.uuid);
  assert.deepEqual(journal.getFlag(ID, "braindanceRecovery").reality, { scenes: [{ sceneId: "s1" }] });
});

test("restore rolls the world back only when asked, after the characters are back", async () => {
  const calls = [];
  const reality = { snapshot: async () => ({ scenes: ["recorded"] }), rollback: async record => { calls.push([record, f.user.character.id]); } };
  const f = formsFixture({ reality });
  await f.service.enter(f.pairings, "m1"); await f.service.restore({ rollback: false });
  assert.equal(calls.length, 0);
  await f.service.enter(f.pairings, "m2"); await f.service.restore({ rollback: true });
  assert.deepEqual(calls, [[{ scenes: ["recorded"] }, "hero"]]);
});

test("a failed world rollback keeps the recovery record for a retry or a keep", async () => {
  let fail = true;
  const f = formsFixture({ reality: { snapshot: async () => ({ scenes: [] }), rollback: async () => { if (fail) throw new Error("Batch failed"); } } });
  await f.service.enter(f.pairings, "memory");
  await assert.rejects(() => f.service.restore({ rollback: true }), /Batch failed/);
  assert.equal(f.service.hasRecovery(), true); assert.equal(f.user.character.id, "hero"); assert.equal(f.actors.size, 2);
  fail = false; await f.service.restore({ rollback: true }); assert.equal(f.service.hasRecovery(), false);
});

test("a new service instance can restore after a refresh", async () => {
  const f = formsFixture(); await f.service.enter(f.pairings, "memory");
  await new MemoryForms(f.dependencies).restore(); assert.equal(f.user.character.id, "hero"); assert.equal(f.actors.size, 2);
});

test("partial user update failure rolls back forms and tokens", async () => {
  const f = formsFixture(), before = f.second.toObject(); f.failUser();
  await assert.rejects(() => f.service.enter(f.pairings, "memory"), /User write failed/);
  assert.deepEqual(f.second.toObject(), before); assert.equal(f.first.actorId, "hero"); assert.equal(f.actors.size, 2); assert.equal(f.service.hasRecovery(), false);
});

test("a silently rejected token update cannot publish a successful transformation", async () => {
  const f = formsFixture(); f.first.update = async () => undefined;
  await assert.rejects(() => f.service.enter(f.pairings, "memory"), /TokenTransform/);
  assert.equal(f.user.character.id, "hero"); assert.equal(f.actors.size, 2); assert.equal(f.service.hasRecovery(), false);
});

test("restoration failure retains the recovery record and form for a retry", async () => {
  const f = formsFixture(); await f.service.enter(f.pairings, "memory"); f.failToken();
  await assert.rejects(() => f.service.restore(), /Token write failed/); assert.equal(f.service.hasRecovery(), true); assert.equal(f.actors.size, 3);
  await f.service.restore(); assert.equal(f.service.hasRecovery(), false); assert.equal(f.actors.size, 2);
});

test("a missing original character never causes deletion of the remaining form", async () => {
  const f = formsFixture(); await f.service.enter(f.pairings, "memory"); f.documents.delete(f.hero.uuid);
  await assert.rejects(() => f.service.restore(), /OriginalMissing/);
  assert.equal(f.actors.size, 3); assert.equal(f.service.hasRecovery(), true);
  f.documents.set(f.hero.uuid, f.hero); await f.service.restore(); assert.equal(f.actors.size, 2);
});

test("tokens created during a memory revert to the character's original appearance", async () => {
  const f = formsFixture(); await f.service.enter(f.pairings, "memory");
  const token = f.makeToken(f.game.scenes[1], "new-token", { ...f.first.toObject(), x: 700, y: 800 });
  await f.service.restore(); assert.equal(token.actorId, "hero"); assert.equal(token.toObject().texture.src, "hero-token.webp"); assert.equal(token.toObject().x, 700);
});

test("validate every pair before mutating any actor, token or user", async () => {
  const f = formsFixture();
  await assert.rejects(() => f.service.enter([...f.pairings, { characterUuid: "Actor.missing", npcUuid: f.npc.uuid }], "memory"), /ChooseCharacter/);
  assert.equal(f.actors.size, 2); assert.equal(f.journals.size, 0); assert.equal(f.first.actorId, "hero");
  await assert.rejects(() => f.service.enter([...f.pairings, ...f.pairings], "memory"), /DuplicateCharacter/);
});

test("nested transformations and unsupported systems are rejected", async () => {
  const f = formsFixture(); f.hero.isPolymorphed = true;
  await assert.rejects(() => f.service.enter(f.pairings, "memory"), /NestedTransformation/);
  f.game.system.id = "other"; await assert.rejects(() => f.service.enter(f.pairings, "memory"), /SystemUnsupported/);
});

test("preserve a player's intentional reassignment during the memory", async () => {
  const f = formsFixture(); await f.service.enter(f.pairings, "memory"); f.user.characterId = "npc";
  await f.service.restore(); assert.equal(f.user.characterId, "npc");
});

test("reference rewriting only rewrites this NPC's own document paths", () => {
  assert.deepEqual(remapActorReferences(["Actor.npc", "Actor.npc.Item.a", "Actor.npc2.Item.a", "Actor.other"], "Actor.npc", "Actor.form"),
    ["Actor.form", "Actor.form.Item.a", "Actor.npc2.Item.a", "Actor.other"]);
});

/* Memory isn't reality ---------------------------------------------------------------------------- */

const wall = (id, hp, extra = {}) => ({ _id: id, c: [0, 0, 100, 0], move: 20, flags: { [ID]: { cover: { hp, max: 40 } } }, _stats: { modifiedTime: Math.random() }, ...extra });
const plainWall = (id, c = [0, 0, 1, 1]) => ({ _id: id, c, flags: {} });
const scar = (id, parentId) => ({ _id: id, x: 10, y: 10, flags: { [ID]: { wallWear: { parentId, kind: "scar" } } } });

test("the reality record keeps only Hardwipe walls, damage Tiles and Hardwipe scene flags", () => {
  const record = sceneSnapshot({ id: "s1", walls: [wall("w1", 40), plainWall("p1")], tiles: [scar("t1", "w1"), { _id: "art", flags: {} }],
    flags: { [ID]: { heat: { current: 3, max: 10 }, other: 1 }, core: {} } });
  assert.deepEqual(record.walls.map(data => data._id), ["w1"]); assert.deepEqual(record.tiles.map(data => data._id), ["t1"]);
  assert.deepEqual(record.flags, { heat: { current: 3, max: 10 }, coverHistory: null, coverDamageLedger: null });
  assert.deepEqual(sceneSnapshot({ id: "empty" }).walls, []);
});

test("rollback rewrites damaged sections, deletes new damage marks and restores Heat", () => {
  const record = sceneSnapshot({ id: "s1", walls: [wall("w1", 40), plainWall("p1")], flags: { [ID]: { heat: { current: 1, max: 10 } } } });
  const plan = rollbackPlan(record, { walls: [wall("w1", 25), plainWall("p1", [5, 5, 6, 6])], tiles: [scar("t9", "w1")],
    flags: { [ID]: { heat: { current: 7, max: 10 }, coverHistory: [{ id: "h" }] } } });
  assert.equal(plan.changed, true);
  const update = plan.operations.find(operation => operation.action === "update");
  assert.equal(update.documentName, "Wall"); assert.equal(update.updates[0].flags[ID].cover.hp, 40); assert.equal(update.replaceFlags, true);
  assert.deepEqual(plan.operations.find(operation => operation.documentName === "Tile"), { action: "delete", documentName: "Tile", ids: ["t9"] });
  assert.ok(!JSON.stringify(plan.operations).includes("p1"), "walls without Hardwipe data are never touched");
  assert.deepEqual(plan.flags, { heat: { current: 1, max: 10 }, coverHistory: null });
});

test("rollback undoes a breach: remainders go, the original wall comes back with its ID", () => {
  const record = sceneSnapshot({ id: "s1", walls: [wall("w1", 40)] });
  const plan = rollbackPlan(record, { walls: [wall("r1", 40, { c: [0, 0, 40, 0] }), wall("r2", 40, { c: [60, 0, 100, 0] })], tiles: [] });
  assert.deepEqual(plan.operations[0], { action: "delete", documentName: "Wall", ids: ["r1", "r2"] });
  assert.equal(plan.operations[1].action, "create"); assert.equal(plan.operations[1].keepId, true); assert.equal(plan.operations[1].data[0]._id, "w1");
});

test("an unchanged scene needs nothing (timestamps aside)", () => {
  const record = sceneSnapshot({ id: "s1", walls: [wall("w1", 40)], tiles: [scar("t1", "w1")], flags: { [ID]: { heat: { current: 1 } } } });
  const plan = rollbackPlan(record, { walls: [wall("w1", 40)], tiles: [scar("t1", "w1")], flags: { [ID]: { heat: { current: 1 } } } });
  assert.equal(plan.changed, false); assert.deepEqual(plan.operations, []);
});

/* Clues ------------------------------------------------------------------------------------------- */

const clues = [
  { id: "a", x: 100, y: 100, layer: "audio", radius: 50, label: "leak", text: "secret" },
  { id: "b", x: 130, y: 100, layer: "thermal", radius: 50 },
  { id: "c", x: 500, y: 500, layer: "visual", radius: 50, found: true, foundBy: "p1", label: "Casing", text: "9mm" }
];

test("unfound clues never carry their words in public data", () => {
  assert.equal(normalizeClue(clues[0]).label, ""); assert.equal(normalizeClue(clues[0]).text, "");
  assert.equal(normalizeClue(clues[2]).label, "Casing");
  assert.equal(normalizeClue({ id: "x", x: "nope", y: 1 }), null);
  assert.equal(normalizeClue({ id: "x", x: 1, y: 1, layer: "xray" }).layer, "visual");
});

test("a scan reveals the nearest clue on the scanner's layer, and reports traces on other layers", () => {
  assert.equal(scanClues(clues, { x: 110, y: 100 }, "audio").clue.id, "a");
  assert.deepEqual(scanClues(clues, { x: 110, y: 100 }, "visual"), { clue: null, near: "audio" });
  assert.equal(scanClues(clues, { x: 900, y: 900 }, "audio"), null);
  assert.equal(scanClues(clues, { x: 500, y: 500 }, "visual"), null, "found clues are not found twice");
});

test("revealing copies the private words; resetting hides them again", () => {
  const revealed = revealClue(clues, "a", { label: "Gas leak", text: "Hissing behind the wall" }, "p1", 77);
  const clue = revealed.find(entry => entry.id === "a");
  assert.deepEqual([clue.found, clue.foundBy, clue.foundAt, clue.label, clue.text], [true, "p1", 77, "Gas leak", "Hissing behind the wall"]);
  assert.ok(resetClues(revealed).every(entry => !entry.found && !entry.label));
});

test("participants see traces on their layer and every found clue; GMs see all", () => {
  assert.deepEqual(visibleClues(clues, { layer: "audio" }).map(entry => entry.id), ["a", "c"]);
  assert.deepEqual(visibleClues(clues, { layer: "thermal" }).map(entry => entry.id), ["b", "c"]);
  assert.equal(visibleClues(clues, { layer: "visual", isGM: true }).length, 3);
});

/* Mechanical echoes ------------------------------------------------------------------------------- */

test("echo effects carry Ready Set Midi flags for their duration", () => {
  const cue = { id: "c1", kind: "panic", endsAt: 18000, mechanics: true };
  const effect = echoEffectData(cue, { name: "BD echo: Panic", now: 10000 });
  assert.deepEqual(effect.system.changes, [{ key: "flags.midi-qol.disadvantage.ability.all", type: "override", value: "1" }]);
  assert.deepEqual(effect.duration, { value: 8, units: "seconds" });
  assert.equal(effect.flags[ID].braindanceEcho.cueId, "c1");
  const overload = { ...cue, kind: "overload" };
  assert.deepEqual(echoEffectData(overload, { now: 10000, implantId: "eye" }).system.changes, []);
  assert.equal(echoEffectData(overload, { now: 10000 }).system.changes.length, 2);
});

test("overload takes a working active implant offline first; interference with mechanics blocks scans", () => {
  assert.equal(overloadTarget([{ id: "a", enabled: false, active: true }, { id: "b", enabled: true, active: false }, { id: "c", enabled: true, active: true }]).id, "c");
  assert.equal(overloadTarget([{ id: "b", enabled: true, active: false }]).id, "b");
  assert.equal(overloadTarget([]), null);
  assert.equal(scanBlocked({ kind: "interference", mechanics: true, endsAt: 20 }, 10), true);
  assert.equal(scanBlocked({ kind: "interference", mechanics: false, endsAt: 20 }, 10), false);
  assert.equal(scanBlocked({ kind: "panic", mechanics: true, endsAt: 20 }, 10), false);
});

/* Roll Tracker credit ----------------------------------------------------------------------------- */

test("a roll made in a memory form counts for the real character, tagged as a memory roll", () => {
  const message = { id: "m1", type: "check", timestamp: 1, author: "p1", speaker: { actor: "form1" }, whisper: [], blind: false,
    system: { ability: "dex" }, flags: { [ID]: { braindance: { sessionId: "s", originalId: "hero" } } },
    rolls: [{ kind: "d20", options: {}, total: 14, dice: [{ faces: 20, results: [{ v: 12, a: true }] }] }] };
  const seen = [];
  const records = extractRecords(message, { userFor: (actor, author) => { seen.push(actor); return actor === "hero" ? "player" : author; } });
  assert.deepEqual(seen, ["hero"]);
  assert.equal(records[0].a, "hero"); assert.equal(records[0].u, "player"); assert.equal(records[0].q, 1);
  assert.equal(summarize(records).memory, 1);
  const plain = extractRecords({ ...message, flags: {} });
  assert.equal(plain[0].a, "form1"); assert.equal(plain[0].q, undefined); assert.equal(summarize(plain).memory, 0);
});
