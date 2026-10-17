import test from "node:test";
import assert from "node:assert/strict";
import { crewData, crewSettings, expiresAtTurnStart, isPrimed, plainDescription } from "../scripts/hardwipe-crew.js";

const effect = (crew, extra = {}) => ({ flags: { "hardwipe-ruleset": { crew } }, disabled: false, duration: {}, ...extra });
const feat = (crew, type = "feat") => ({ type, flags: { "hardwipe-ruleset": { crew } } });
const stamp = (round, turn, combat = "c1") => ({ combat, round, turn });

test("a feat is a crew maneuver only when its switch is on; the payoff defaults to an attack", () => {
  assert.deepEqual(crewSettings(feat({ enabled: true })), { payoff: "attack" });
  assert.deepEqual(crewSettings(feat({ enabled: true, payoff: "card" })), { payoff: "card" });
  assert.deepEqual(crewSettings(feat({ enabled: true, payoff: "nonsense" })), { payoff: "attack" });
  assert.equal(crewSettings(feat({ enabled: false, payoff: "card" })), null);
  assert.equal(crewSettings(feat(undefined)), null);
  assert.equal(crewSettings(feat({ enabled: true }, "weapon")), null);
});

test("only an effect naming the feature it came from is a crew effect", () => {
  assert.deepEqual(crewData(effect({ item: "abc" })), { item: "abc" });
  assert.equal(crewData(effect({ item: "" })), null);
  assert.equal(crewData(effect({ id: "entry-stack" })), null);
  assert.equal(crewData(effect(null)), null);
  assert.equal(crewData(null), null);
});

test("a disabled or expired crew effect is not primed", () => {
  assert.equal(isPrimed(effect({ item: "abc" })), true);
  assert.equal(isPrimed(effect({ item: "abc" }, { disabled: true })), false);
  assert.equal(isPrimed(effect({ item: "abc" }, { duration: { expired: true } })), false);
  assert.equal(isPrimed({ disabled: false, duration: {} }), false);
});

test("the feature's description reads as one plain line", () => {
  assert.equal(plainDescription("<p><strong>Crew maneuver.</strong> Stack up beside a door.</p><p>When an ally opens it, fire.</p>"),
    "Crew maneuver. Stack up beside a door. When an ally opens it, fire.");
  assert.equal(plainDescription("Shoot &amp; scoot<br>now&nbsp;&lt;fast&gt;"), "Shoot & scoot now <fast>");
  assert.equal(plainDescription("See @UUID[Compendium.x.y.Item.z]{Breach Charge} and @Check[dex]."), "See Breach Charge and dex.");
  assert.equal(plainDescription("Deal [[/r 2d6]] damage."), "Deal 2d6 damage.");
  assert.equal(plainDescription('<p>Breach the door.</p><section class="secret" id="secret-1"><p>The guard has a dead-man switch.</p></section><p>Fire.</p>'),
    "Breach the door. Fire.");
  assert.equal(plainDescription('<section class="secretive-note">Kept.</section>'), "Kept.");
  assert.equal(plainDescription(""), "");
  assert.equal(plainDescription(null), "");
});

test("set up in this combat, a stack lasts until the owner's next turn starts", () => {
  const set = stamp(1, 2);
  assert.equal(expiresAtTurnStart(set, stamp(1, 2)), false);
  assert.equal(expiresAtTurnStart(set, stamp(2, 2)), true);
  assert.equal(expiresAtTurnStart(set, stamp(1, 1)), false);
});

test("a stack set up before the fight, or in another fight, goes on the owner's first turn in this one", () => {
  assert.equal(expiresAtTurnStart(null, stamp(1, 0)), true);
  assert.equal(expiresAtTurnStart({ combat: null }, stamp(1, 3)), true);
  assert.equal(expiresAtTurnStart(stamp(4, 1, "old"), stamp(1, 1)), true);
});

test("no combat turn, no expiry", () => {
  assert.equal(expiresAtTurnStart(stamp(1, 2), null), false);
  assert.equal(expiresAtTurnStart(null, { combat: null }), false);
});

test("no language key is both a string and the start of another key (Foundry nests them and drops the whole file)", async () => {
  const { readFile } = await import("node:fs/promises");
  const keys = Object.keys(JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8")));
  const all = new Set(keys);
  assert.deepEqual(keys.filter(key => [...all].some(other => other.startsWith(`${key}.`))), []);
});
