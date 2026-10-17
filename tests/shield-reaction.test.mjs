import test from "node:test";
import assert from "node:assert/strict";
import { ShieldManager } from "../scripts/hardwipe-shields.js";

// Shield Block spends the reaction the Turn panel shows. A drone acts first (turn 0), then the character (turn 1).
const MARKER = "dnd5ereaction000";
const PARRY_ON_DRONE_TURN = { combat: "c1", round: 1, turn: 0, action: false, bonus: false, attacks: 0, dash: null, reaction: { round: 1, turn: 0 } };

function character({ ledger = null } = {}) {
  const effects = new Map();
  return {
    uuid: "Actor.hero", type: "character",
    effects: { get: id => effects.get(id), find: test => [...effects.values()].find(test) },
    flags: { "midi-qol": { actions: { reactionsMax: 1 } } },
    getFlag: (scope, key) => (scope === "hardwipe-ruleset" && key === "turnLedger" ? ledger : undefined),
    // What Ready Set Midi's setReactionUsed leaves: its marker, whose change sets reactionsUsed.
    mark() {
      effects.set(MARKER, { id: MARKER, statuses: new Set(["reaction"]), disabled: false, duration: {} });
      this.flags["midi-qol"].actions.reactionsUsed = 1;
    }
  };
}

function stage(actor, { enforceReactions, combat = "started" }) {
  const calls = [];
  const drone = { actor: { uuid: "Actor.drone" } };
  const own = { actor };
  const encounter = combat ? { id: "c1", started: combat === "started", round: 1, turn: 0, turns: [drone, own], combatants: [drone, own], combatant: drone } : null;
  globalThis.foundry = { utils: { getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object) } };
  globalThis.game = { modules: new Map([["ready-set-midi", { active: true }]]), combat: encounter, combats: encounter ? [encounter] : [] };
  globalThis.MidiQOL = {
    configSettings: () => ({ enforceReactions }),
    hasUsedReaction: a => (a.flags["midi-qol"].actions.reactionsUsed ?? 0) >= (a.flags["midi-qol"].actions.reactionsMax ?? 1),
    setReactionUsed: async (a, active, options) => { calls.push({ active, ...options }); a.mark(); }
  };
  return calls;
}

test("with Midi's Enforce Reactions on Do not check, a reaction in Hardwipe's ledger stops Shield Block", async () => {
  const actor = character({ ledger: PARRY_ON_DRONE_TURN });
  const calls = stage(actor, { enforceReactions: "none" });
  assert.equal(MidiQOL.hasUsedReaction(actor), false); // Midi alone would have allowed it.
  assert.equal(ShieldManager._hasReaction(actor), false);
  assert.equal(await ShieldManager._consumeReaction(actor), false);
  assert.deepEqual(calls, []);
  const fresh = character();
  stage(fresh, { enforceReactions: "none" });
  assert.equal(ShieldManager._hasReaction(fresh), true);
});

test("Shield Block spends the reaction through Midi's forced marker, which the panel reads as spent in either mode", async () => {
  for (const enforceReactions of ["none", "displayOnly"]) {
    const actor = character();
    const calls = stage(actor, { enforceReactions });
    assert.equal(ShieldManager._hasReaction(actor), true, enforceReactions);
    assert.equal(await ShieldManager._consumeReaction(actor), true, enforceReactions);
    assert.deepEqual(calls, [{ active: true, force: true }], enforceReactions);
    assert.equal(ShieldManager._hasReaction(actor), false, enforceReactions);
  }
});

test("while Midi tracks reactions its marker decides, as on the panel", () => {
  const actor = character({ ledger: PARRY_ON_DRONE_TURN });
  stage(actor, { enforceReactions: "displayOnly" });
  assert.equal(ShieldManager._hasReaction(actor), true);
  actor.mark();
  assert.equal(ShieldManager._hasReaction(actor), false);
});

test("outside a started combat Midi's own count decides", () => {
  for (const combat of [null, "staged"]) {
    const actor = character({ ledger: PARRY_ON_DRONE_TURN });
    stage(actor, { enforceReactions: "none", combat });
    assert.equal(ShieldManager._hasReaction(actor), true, String(combat));
    actor.mark();
    assert.equal(ShieldManager._hasReaction(actor), false, String(combat));
  }
});
