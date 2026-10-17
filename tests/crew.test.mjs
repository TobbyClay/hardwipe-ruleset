import test from "node:test";
import assert from "node:assert/strict";
import {
  CREW_FEATURE_TYPE, DEFAULT_CREW_TYPES, crewData, crewRule, expiresAt, isPrimed, normalizeCrewTypes, plainDescription, ruleFor,
  setupActivityId
} from "../scripts/hardwipe-crew.js";

const effect = (crew, extra = {}) => ({ flags: { "hardwipe-ruleset": { crew } }, disabled: false, duration: {}, ...extra });
const feat = (value, subtype, type = "feat") => ({ type, system: { type: { value, subtype } } });
const stamp = (round, turn, combat = "c1") => ({ combat, round, turn });
const now = (round, turn, ownersTurn, combat = "c1") => ({ combat, round, turn, ownersTurn });
const types = normalizeCrewTypes([
  { id: "strike", name: "Strike", payoff: "attack", fires: "owner", lasts: "turn" },
  { id: "spot", name: "Spotter", payoff: "attack", fires: "crew", lasts: "round" },
  { id: "kit", name: "Kit", payoff: "activity", fires: "crew", lasts: "used" }
]);

test("the GM's types are cleaned: names required, rules limited to known values, ids safe and unique", () => {
  const list = normalizeCrewTypes([
    { name: "  Breach Team  ", payoff: "attack", fires: "crew", lasts: "round" },
    { id: "Breach Team", name: "Breach (again)", payoff: "teleport", fires: "anyone", lasts: "forever" },
    { name: "" },
    null,
    { id: "!!", name: "Señal" }
  ]);
  assert.deepEqual(list, [
    { id: "breach-team", name: "Breach Team", payoff: "attack", fires: "crew", lasts: "round" },
    { id: "breach-team-2", name: "Breach (again)", payoff: "attack", fires: "owner", lasts: "turn" },
    { id: "senal", name: "Señal", payoff: "attack", fires: "owner", lasts: "turn" }
  ]);
  assert.deepEqual(normalizeCrewTypes("nope"), []);
  assert.equal(normalizeCrewTypes(Array.from({ length: 40 }, (_, n) => ({ name: `T${n}` }))).length, 24);
  assert.deepEqual(DEFAULT_CREW_TYPES.map(type => type.id), ["strike", "support", "signal"]);
});

test("a feature is a crew maneuver only when its Feature Type is Crew Maneuver; its subtype picks the rule", () => {
  assert.equal(crewRule(feat("feat", "general"), types), null);
  assert.equal(crewRule(feat(CREW_FEATURE_TYPE, "strike", "weapon"), types), null);
  assert.deepEqual(crewRule(feat(CREW_FEATURE_TYPE, "strike"), types),
    { id: "strike", name: "Strike", payoff: "attack", fires: "owner", lasts: "turn", known: true });
  assert.equal(crewRule(feat(CREW_FEATURE_TYPE, "spot"), types).fires, "crew");
});

test("an activity payoff is always fired by its owner; a missing type is a card fired by its owner", () => {
  assert.equal(ruleFor("kit", types).fires, "owner");
  assert.deepEqual(ruleFor("deleted", types), { id: "deleted", name: "", payoff: "card", fires: "owner", lasts: "turn", known: false });
  assert.equal(ruleFor("", types).known, false);
});

test("the first activity by sort order sets a maneuver up", () => {
  assert.equal(setupActivityId([{ id: "b", sort: 200 }, { id: "a", sort: 100 }]), "a");
  assert.equal(setupActivityId([{ id: "only" }]), "only");
  assert.equal(setupActivityId([]), null);
  assert.equal(setupActivityId(undefined), null);
});

test("only an effect naming the feature it came from is a crew effect", () => {
  assert.deepEqual(crewData(effect({ item: "abc", type: "strike" })), { item: "abc", type: "strike" });
  assert.equal(crewData(effect({ item: "" })), null);
  assert.equal(crewData(effect({ id: "entry-stack" })), null);
  assert.equal(crewData(null), null);
});

test("a disabled or expired crew effect is not armed", () => {
  assert.equal(isPrimed(effect({ item: "abc" })), true);
  assert.equal(isPrimed(effect({ item: "abc" }, { disabled: true })), false);
  assert.equal(isPrimed(effect({ item: "abc" }, { duration: { expired: true } })), false);
});

test("'until their next turn' ends at the owner's next turn after the setup", () => {
  const set = stamp(1, 2);
  assert.equal(expiresAt("turn", set, now(1, 3, false)), false);
  assert.equal(expiresAt("turn", set, now(1, 2, true)), false);
  assert.equal(expiresAt("turn", set, now(2, 2, true)), true);
  assert.equal(expiresAt("turn", set, now(1, 1, true)), false);
  // Set up before the fight, or in another fight: the owner's first turn in this one.
  assert.equal(expiresAt("turn", null, now(1, 0, false)), false);
  assert.equal(expiresAt("turn", null, now(1, 1, true)), true);
  assert.equal(expiresAt("turn", stamp(4, 1, "old"), now(1, 1, true)), true);
});

test("'until the end of the round' ends once the round it was set up in is over", () => {
  assert.equal(expiresAt("round", stamp(2, 1), now(2, 2, false)), false);
  assert.equal(expiresAt("round", stamp(2, 1), now(3, 0, false)), true);
  // Before the fight: the first round.
  assert.equal(expiresAt("round", null, now(1, 2, true)), false);
  assert.equal(expiresAt("round", null, now(2, 0, false)), true);
});

test("'until used' never expires, and nothing expires outside combat", () => {
  assert.equal(expiresAt("used", stamp(1, 0), now(9, 0, true)), false);
  assert.equal(expiresAt("turn", stamp(1, 2), null), false);
  assert.equal(expiresAt("round", null, { combat: null }), false);
});

test("the feature's description reads as one plain line, without GM secrets", () => {
  assert.equal(plainDescription("<p><strong>Crew maneuver.</strong> Stack up beside a door.</p><p>When an ally opens it, fire.</p>"),
    "Crew maneuver. Stack up beside a door. When an ally opens it, fire.");
  assert.equal(plainDescription("Shoot &amp; scoot<br>now&nbsp;&lt;fast&gt;"), "Shoot & scoot now <fast>");
  assert.equal(plainDescription("See @UUID[Compendium.x.y.Item.z]{Breach Charge} and @Check[dex]."), "See Breach Charge and dex.");
  assert.equal(plainDescription("Deal [[/r 2d6]] damage."), "Deal 2d6 damage.");
  assert.equal(plainDescription('<p>Breach the door.</p><section class="secret" id="secret-1"><p>The guard has a dead-man switch.</p></section><p>Fire.</p>'),
    "Breach the door. Fire.");
  assert.equal(plainDescription('<section class="secretive-note">Kept.</section>'), "Kept.");
  assert.equal(plainDescription(null), "");
});

test("no language key is both a string and the start of another key (Foundry nests them and drops the whole file)", async () => {
  const { readFile } = await import("node:fs/promises");
  const keys = Object.keys(JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8")));
  const all = new Set(keys);
  assert.deepEqual(keys.filter(key => [...all].some(other => other.startsWith(`${key}.`))), []);
});

test("the CREW card: one camera for its owner, two staggered for a crewmate, a kill-feed line as the option, all escaped", async () => {
  const { crewCardMarkup } = await import("../scripts/hardwipe-crew.js");
  globalThis.foundry ??= { utils: { escapeHTML: text => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) } };
  const words = { maneuver: "Entry Stack", type: "Strike", line: "Mags triggers Entry Stack.", user: "triggered by GM", link: "crew // link",
    executed: "Executed", combo: "Crew combo ×1", clock: "R2 · T1" };
  const mags = { name: "Mags", img: "mags.webp" };
  const juno = { name: "<b>Juno</b>", img: "juno.webp" };
  const solo = crewCardMarkup("cam", { ...words, setter: mags, firer: null });
  assert.match(solo, /class="hardwipe-crewcard is-cam"/);
  assert.equal(solo.match(/class="hwcc-feed"/g).length, 1);
  const duo = crewCardMarkup("cam", { ...words, setter: juno, firer: mags });
  assert.match(duo, /is-cam is-duo/);
  assert.equal(duo.match(/class="hwcc-feed"/g).length, 2);
  assert.match(duo, /cam 01 · &lt;b&gt;Juno&lt;\/b&gt;/);
  assert.doesNotMatch(duo, /<b>Juno<\/b>/);
  const feed = crewCardMarkup("feed", { ...words, setter: juno, firer: mags });
  assert.match(feed, /is-feed/);
  assert.match(feed, /&lt;b&gt;Juno&lt;\/b&gt;<br>\+ Mags/);
  assert.match(feed, /hwcc-stamp">Executed/);
});
