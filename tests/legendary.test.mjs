import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_IDS, cardDesign, flaggedDesign, legendaryHeadHTML, rarityFloor, reachesFloor, serialOf } from "../scripts/hardwipe-legendary.js";

globalThis.foundry ??= { utils: { escapeHTML: text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") } };
globalThis.game ??= { i18n: { localize: key => key } };

const DND5E = { common: "Common", uncommon: "Uncommon", rare: "Rare", veryRare: "Very Rare", legendary: "Legendary", artifact: "Artifact" };
// Custom D&D gives new tiers random keys; the GM orders them in its list.
const STREET = { k1GonkAaaaaaaaaa: "Gonk", k2StreetAaaaaaaa: "Street", k3NovaAaaaaaaaaa: "Nova", k4PreemAaaaaaaaa: "Preem", k5IconicAaaaaaaa: "Iconic" };
const flag = preset => ({ "hardwipe-ruleset": { cardIdentity: { schema: 1, mode: "preset", preset } } });
const weapon = (rarity, extra = {}) => ({ type: "weapon", system: { rarity, identified: true }, flags: flag("neon"), ...extra });

test("the floor is the chosen tier while it exists, else the top tier", () => {
  assert.equal(rarityFloor(DND5E, ""), "artifact");
  assert.equal(rarityFloor(DND5E, "veryRare"), "veryRare");
  assert.equal(rarityFloor(DND5E, "deleted"), "artifact");
  assert.equal(rarityFloor(STREET, ""), "k5IconicAaaaaaaa");
  assert.equal(rarityFloor(STREET, "k4PreemAaaaaaaaa"), "k4PreemAaaaaaaaa");
  assert.equal(rarityFloor({}, ""), "");
});

test("a rarity qualifies at or above the floor, in the list's order; no rarity never does", () => {
  assert.equal(reachesFloor("artifact", DND5E, ""), true);
  assert.equal(reachesFloor("legendary", DND5E, ""), false);
  assert.equal(reachesFloor("legendary", DND5E, "legendary"), true);
  assert.equal(reachesFloor("artifact", DND5E, "legendary"), true);
  assert.equal(reachesFloor("veryRare", DND5E, "legendary"), false);
  assert.equal(reachesFloor("", DND5E, ""), false);
  assert.equal(reachesFloor("k5IconicAaaaaaaa", STREET, ""), true);
  assert.equal(reachesFloor("k4PreemAaaaaaaaa", STREET, ""), false);
  assert.equal(reachesFloor("k4PreemAaaaaaaaa", STREET, "k4PreemAaaaaaaaa"), true);
  assert.equal(reachesFloor("k3NovaAaaaaaaaaa", STREET, "k4PreemAaaaaaaaa"), false);
  // A rarity the list no longer has (a tier deleted in Custom D&D) qualifies for nothing.
  assert.equal(reachesFloor("legendary", STREET, ""), false);
  // SC Item Rarity Colors can keep D&D5e's tiers ahead of Custom D&D's: the top tier is still the street's.
  const merged = { ...DND5E, ...STREET };
  assert.equal(reachesFloor("k5IconicAaaaaaaa", merged, ""), true);
  assert.equal(reachesFloor("k1GonkAaaaaaaaaa", merged, ""), false);
  assert.equal(reachesFloor("k1GonkAaaaaaaaaa", merged, "k4PreemAaaaaaaaa"), false);
});

test("only a schema 1 preset naming a design selects it", () => {
  assert.equal(flaggedDesign({ schema: 1, mode: "preset", preset: "engraved" }), "engraved");
  assert.equal(flaggedDesign({ schema: 1, mode: "default" }), "");
  assert.equal(flaggedDesign({ schema: 2, mode: "preset", preset: "engraved" }), "");
  assert.equal(flaggedDesign({ schema: 1, mode: "preset", preset: "gone" }), "");
  assert.equal(flaggedDesign({ schema: 1, mode: "preset", preset: "constructor" }), "");
  assert.equal(flaggedDesign(null), "");
});

test("a design shows on a rare enough weapon; a player sees an unidentified weapon's plain card", () => {
  const options = { table: STREET, chosen: "k4PreemAaaaaaaaa", isGM: false };
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa"), options), "neon");
  assert.equal(cardDesign(weapon("k4PreemAaaaaaaaa"), options), "neon");
  assert.equal(cardDesign(weapon("k3NovaAaaaaaaaaa"), options), "");
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa", { type: "equipment" }), options), "");
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa", { flags: {} }), options), "");
  const unidentified = weapon("k5IconicAaaaaaaa", { system: { rarity: "k5IconicAaaaaaaa", identified: false } });
  assert.equal(cardDesign(unidentified, options), "");
  assert.equal(cardDesign(unidentified, { ...options, isGM: true }), "neon");
});

test("every design keeps the card's working parts: status, crown, kind, chips, verdict, targets, brief, meta", () => {
  const parts = {
    tone: "critical", name: "Saint&#39;s Due", type: "Martial Ranged", rarity: "Iconic", status: "AWAITING GM",
    kind: "<i data-part=kind></i>", props: "<i data-part=props></i>", verdict: "<i data-part=verdict></i>", targets: "<i data-part=targets></i>",
    brief: "<i data-part=brief></i>", meta: "<i data-part=meta></i>", control: "<i data-part=control></i>"
  };
  const item = { uuid: "Actor.a.Item.b", img: "icons/weapons/guns/gun-pistol.webp", flags: { "hardwipe-ruleset": { manufacturer: "Malorian <Arms>" } } };
  assert.ok(DESIGN_IDS.length >= 4);
  for (const id of DESIGN_IDS) {
    const html = legendaryHeadHTML(id, parts, item);
    assert.match(html, /^<div class="hardwipe-attack-head hardwipe-weapon-head hwl-head is-critical">/, id);
    for (const part of ["kind", "props", "verdict", "targets", "brief", "meta", "control"]) assert.ok(html.includes(`data-part=${part}`), `${id} keeps ${part}`);
    assert.ok(html.includes('class="hardwipe-attack-status">AWAITING GM<'), `${id} keeps the status`);
    assert.ok(html.includes('class="hardwipe-chat-title hwl-title">Saint&#39;s Due<'), `${id} titles the weapon`);
    assert.ok(!html.includes("Malorian <Arms>"), `${id} escapes the maker`);
    assert.ok(!html.includes("data-text"), `${id} leaves the base card's glitch off`);
    // The parts come in the base card's order.
    const order = ["kind", "props", "verdict", "targets", "brief", "meta"].map(part => html.indexOf(`data-part=${part}`));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${id} keeps the order`);
  }
});

test("a weapon's serial is four digits and the same everywhere", () => {
  assert.match(serialOf("Actor.a.Item.b"), /^\d{4}$/);
  assert.equal(serialOf("Actor.a.Item.b"), serialOf("Actor.a.Item.b"));
  assert.notEqual(serialOf("Actor.a.Item.b"), serialOf("Actor.a.Item.c"));
});
