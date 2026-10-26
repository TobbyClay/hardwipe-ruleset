import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_IDS, SIGNATURE_IDS, cardDesign, cardSpec, cleanLogo, cleanOwn, heldElsewhere, legendaryHeadHTML, rarityFloor, reachesFloor, rootClasses, serialOf
} from "../scripts/hardwipe-legendary.js";

globalThis.foundry ??= { utils: { escapeHTML: text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") } };
globalThis.game ??= { i18n: { localize: key => key } };

const DND5E = { common: "Common", uncommon: "Uncommon", rare: "Rare", veryRare: "Very Rare", legendary: "Legendary", artifact: "Artifact" };
// Custom D&D gives new tiers random keys; the GM orders them in its list.
const STREET = { k1GonkAaaaaaaaaa: "Gonk", k2StreetAaaaaaaa: "Street", k3NovaAaaaaaaaaa: "Nova", k4PreemAaaaaaaaa: "Preem", k5IconicAaaaaaaa: "Iconic" };
const own = (extra = {}) => ({ "hardwipe-ruleset": { cardIdentity: { schema: 1, mode: "own", own: { base: "neon", ...extra } } } });
const signature = id => ({ "hardwipe-ruleset": { cardIdentity: { schema: 1, mode: "signature", signature: id } } });
const weapon = (rarity, extra = {}) => ({ type: "weapon", system: { rarity, identified: true }, flags: own(), ...extra });
const PARTS = {
  tone: "critical", name: "Saint&#39;s Due", type: "Martial Ranged", rarity: "Iconic", status: "AWAITING GM",
  kind: "<i data-part=kind></i>", props: "<i data-part=props></i>", verdict: "<i data-part=verdict></i>", targets: "<i data-part=targets></i>",
  brief: "<i data-part=brief></i>", meta: "<i data-part=meta></i>", control: "<i data-part=control></i>"
};
const ITEM = { uuid: "Actor.a.Item.b", img: "icons/weapons/guns/gun-pistol.webp", flags: { "hardwipe-ruleset": { manufacturer: "Malorian <Arms>" } } };

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
  assert.equal(reachesFloor("veryRare", DND5E, "legendary"), false);
  assert.equal(reachesFloor("", DND5E, ""), false);
  assert.equal(reachesFloor("k5IconicAaaaaaaa", STREET, ""), true);
  assert.equal(reachesFloor("k4PreemAaaaaaaaa", STREET, "k4PreemAaaaaaaaa"), true);
  assert.equal(reachesFloor("k3NovaAaaaaaaaaa", STREET, "k4PreemAaaaaaaaa"), false);
  // A rarity the list no longer has (a tier deleted in Custom D&D) qualifies for nothing.
  assert.equal(reachesFloor("legendary", STREET, ""), false);
  // SC Item Rarity Colors can keep D&D5e's tiers ahead of Custom D&D's: the top tier is still the street's.
  const merged = { ...DND5E, ...STREET };
  assert.equal(reachesFloor("k5IconicAaaaaaaa", merged, ""), true);
  assert.equal(reachesFloor("k1GonkAaaaaaaaaa", merged, ""), false);
});

test("a flag asks for the weapon's own card or a signature card; anything else is the plain card", () => {
  assert.deepEqual(cardSpec(signature("exhibit-c")["hardwipe-ruleset"].cardIdentity), { kind: "signature", id: "exhibit-c" });
  assert.equal(cardSpec(own()["hardwipe-ruleset"].cardIdentity).own.base, "neon");
  assert.equal(cardSpec({ schema: 1, mode: "default", own: { base: "neon" } }), null);
  assert.equal(cardSpec({ schema: 2, mode: "own", own: { base: "neon" } }), null);
  assert.equal(cardSpec({ schema: 1, mode: "own", own: { base: "gone" } }), null);
  assert.equal(cardSpec({ schema: 1, mode: "signature", signature: "constructor" }), null);
  assert.equal(cardSpec(null), null);
});

test("a weapon's own card is cleaned: colours, type, hue and lines out of bounds fall back to the design's", () => {
  const clean = cleanOwn({ base: "ink", color: "red", font: "comic", hue: 999, artOpacity: 3, kicker: "x".repeat(200), quote: "  wry  " });
  assert.equal(clean.color, "");
  assert.equal(clean.font, "");
  assert.equal(clean.hue, 180);
  assert.equal(clean.artOpacity, 10);
  assert.equal(clean.kicker.length, 48);
  assert.equal(clean.quote, "wry");
  assert.deepEqual(cleanOwn({ base: "ink", color: "#A1B2C3", font: "serif", hue: "-40" }), { ...cleanOwn({ base: "ink" }), color: "#a1b2c3", font: "serif", hue: -40 });
  assert.equal(cleanOwn({}).artOpacity, 35);
});

test("a card shows on a rare enough weapon; a player sees an unidentified weapon's plain card", () => {
  const options = { table: STREET, chosen: "k4PreemAaaaaaaaa", isGM: false };
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa"), options)?.kind, "own");
  assert.equal(cardDesign(weapon("k4PreemAaaaaaaaa", { flags: signature("skippy") }), options)?.id, "skippy");
  assert.equal(cardDesign(weapon("k3NovaAaaaaaaaaa"), options), null);
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa", { type: "equipment" }), options), null);
  assert.equal(cardDesign(weapon("k5IconicAaaaaaaa", { flags: {} }), options), null);
  const unidentified = weapon("k5IconicAaaaaaaa", { system: { rarity: "k5IconicAaaaaaaa", identified: false } });
  assert.equal(cardDesign(unidentified, options), null);
  assert.equal(cardDesign(unidentified, { ...options, isGM: true })?.kind, "own");
});

test("a signature card is on one weapon at a time", () => {
  const items = [{ uuid: "A", flags: signature("guts") }, { uuid: "B", flags: signature("guts") }, { uuid: "C", flags: signature("skippy") }, { uuid: "D", flags: own() }];
  assert.deepEqual(heldElsewhere(items, "guts", "A").map(item => item.uuid), ["B"]);
  assert.deepEqual(heldElsewhere(items, "guts", "Z").map(item => item.uuid), ["A", "B"]);
  assert.deepEqual(heldElsewhere(items, "exhibit-c", "A"), []);
});

test("every base and signature card keeps the card's working parts: status, crown, kind, chips, verdict, targets, brief, meta", () => {
  assert.equal(BASE_IDS.length, 8);
  assert.deepEqual(SIGNATURE_IDS, ["exhibit-c", "malorian-3516", "skippy", "guts"]);
  const specs = [...BASE_IDS.map(base => ({ kind: "own", own: cleanOwn({ base }) })), ...SIGNATURE_IDS.map(id => ({ kind: "signature", id }))];
  for (const spec of specs) {
    const name = spec.own?.base ?? spec.id;
    const html = legendaryHeadHTML(spec, PARTS, ITEM);
    assert.match(html, /^<div class="hardwipe-attack-head hardwipe-weapon-head hwl-head is-critical"/, name);
    for (const part of ["kind", "props", "verdict", "targets", "brief", "meta", "control"]) assert.ok(html.includes(`data-part=${part}`), `${name} keeps ${part}`);
    assert.ok(html.includes('class="hardwipe-attack-status">AWAITING GM<'), `${name} keeps the status`);
    assert.ok(html.includes('class="hardwipe-chat-title hwl-title">Saint&#39;s Due<'), `${name} titles the weapon`);
    assert.ok(!html.includes("Malorian <Arms>"), `${name} escapes the maker`);
    assert.ok(!html.includes("data-text"), `${name} leaves the base card's glitch off`);
    const order = ["kind", "props", "verdict", "targets", "brief", "meta"].map(part => html.indexOf(`data-part=${part}`));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${name} keeps the order`);
  }
});

test("a weapon's own card carries its art, lines, hue, title type and colour, escaped", () => {
  const spec = cardSpec(own({ art: 'art/x".webp', kicker: "<b>Samurai</b>", subtitle: "Tour '23", badge: "印", quote: "Never stops", hue: 40, color: "#ff0000", font: "serif", artOpacity: 60 })["hardwipe-ruleset"].cardIdentity);
  const html = legendaryHeadHTML(spec, PARTS, ITEM);
  assert.ok(html.includes('<img class="hwl-art" src="art/x&quot;.webp"'));
  assert.ok(html.includes("&lt;b&gt;Samurai&lt;/b&gt;") && !html.includes("<b>Samurai"));
  assert.ok(html.includes("Tour '23") && html.includes("Never stops"));
  assert.match(html, /class="[^"]*\bhas-hue has-color hwl-font-serif"/);
  assert.match(html, /style="--l-hue:40deg;--l-title:#ff0000;--l-art:0.6"/);
  assert.equal(rootClasses(spec), "hardwipe-legendary hwl-neon");
  assert.equal(rootClasses({ kind: "signature", id: "guts" }), "hardwipe-legendary hwl-sig hwl-sig-guts");
  assert.equal(rootClasses(null), "");
});

test("Skippy and the smart-link screen have a line for each outcome, and their ready line for anything else", () => {
  const bubble = (spec, tone) => legendaryHeadHTML(spec, { ...PARTS, tone }, ITEM);
  const screen = { kind: "own", own: cleanOwn({ base: "smartlink" }) };
  for (const tone of ["attack", "pending", "hit", "critical", "miss", "mixed", "fumble"]) {
    assert.ok(bubble(screen, tone).includes(`HARDWIPE.Legend.Smartlink.${tone}<`));
    assert.ok(bubble({ kind: "signature", id: "skippy" }, tone).includes(`>HARDWIPE.Legend.Sig.Skippy.${tone}<`));
  }
  assert.ok(bubble(screen, "unheard-of").includes("HARDWIPE.Legend.Smartlink.attack<"));
  assert.ok(bubble({ kind: "signature", id: "skippy" }, "pending").includes("hws-dots"));
  // A badge is the screen's fixed line.
  assert.ok(legendaryHeadHTML({ kind: "own", own: cleanOwn({ base: "smartlink", badge: "Hi choom" }) }, PARTS, ITEM).includes(">Hi choom<"));
});

test("a weapon's serial is four digits and the same everywhere", () => {
  assert.match(serialOf("Actor.a.Item.b"), /^\d{4}$/);
  assert.equal(serialOf("Actor.a.Item.b"), serialOf("Actor.a.Item.b"));
  assert.notEqual(serialOf("Actor.a.Item.b"), serialOf("Actor.a.Item.c"));
});

test("a signature card shows the world's own logo where it has room, escaped; without one it keeps its own lettering", () => {
  const sleeve = logo => legendaryHeadHTML({ kind: "signature", id: "malorian-3516", logo }, PARTS, ITEM);
  assert.ok(sleeve("").includes("<b>HARDWIPE.Legend.Sig.Band</b>") && !sleeve("").includes("hws-logo"));
  assert.ok(sleeve('worlds/x/samurai".webp').includes('<img class="hws-logo is-band" src="worlds/x/samurai&quot;.webp"'));
  assert.ok(!sleeve("worlds/x/samurai.webp").includes("HARDWIPE.Legend.Sig.Band"));
  for (const [id, cls] of [["exhibit-c", "is-badge"], ["skippy", "is-avatar"], ["guts", "is-sticker"]]) {
    assert.ok(legendaryHeadHTML({ kind: "signature", id, logo: "worlds/x/logo.webp" }, PARTS, ITEM).includes(`class="hws-logo ${cls}"`), id);
    assert.ok(!legendaryHeadHTML({ kind: "signature", id }, PARTS, ITEM).includes("hws-logo"), id);
  }
  // A weapon's own card has no logo slot (its art is its own image).
  assert.ok(!legendaryHeadHTML({ kind: "own", own: cleanOwn({ base: "neon" }), logo: "x.webp" }, PARTS, ITEM).includes("hws-logo"));
  assert.equal(cleanLogo("  a.webp "), "a.webp");
  assert.equal(cleanLogo("x".repeat(900)).length, 500);
});
