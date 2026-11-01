import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportCards, normalizeCard, outsideSites, parseCards, placesStatus, renameAnimations, renderTemplate, safeAttribute, safeDeclaration, safeURL, studioId
} from "../scripts/hardwipe-card-studio.js";
import { cardSpec, heldElsewhere, rootClasses } from "../scripts/hardwipe-legendary.js";

test("a card may use this Foundry's files, fragments and https; nothing else", () => {
  for (const ok of ["worlds/x/logo.webp", "modules/m/a.gif", "#grad", "https://i.imgur.com/a.gif", "", "icons/svg/sword.svg"]) assert.equal(safeURL(ok), true, ok);
  for (const bad of ["http://x.com/a.png", "javascript:alert(1)", "//x.com/a.png", "ftp://x/y", "vbscript:x", "file:///c:/x"]) assert.equal(safeURL(bad), false, bad);
  assert.equal(safeURL("data:image/gif;base64,R0lGOD", { image: true }), true);
  assert.equal(safeURL("data:image/gif;base64,R0lGOD"), false);
  assert.equal(safeURL("data:text/html,<script>", { image: true }), false);
});

test("CSS keeps its look but nothing fixed over the screen, no other schemes, no script hooks", () => {
  assert.equal(safeDeclaration("position", "fixed"), false);
  assert.equal(safeDeclaration("position", "absolute"), true);
  assert.equal(safeDeclaration("background-image", 'url("https://media.giphy.com/x.gif")'), true);
  assert.equal(safeDeclaration("background-image", 'url("worlds/x/a.png")'), true);
  assert.equal(safeDeclaration("background-image", 'url("http://x.com/a.png")'), false);
  assert.equal(safeDeclaration("background-image", "url(javascript:alert(1))"), false);
  assert.equal(safeDeclaration("background-image", 'image-set("//x.com/a.png" 1x)'), false);
  assert.equal(safeDeclaration("width", "expression(alert(1))"), false);
  assert.equal(safeDeclaration("-moz-binding", "url(x.xml#a)"), false);
  assert.equal(safeDeclaration("color", "#ff0"), true);
});

test("attributes: no handlers; media and links from safe addresses; links inside SVG stay inside the card", () => {
  assert.equal(safeAttribute("div", "onclick", "x()"), false);
  assert.equal(safeAttribute("img", "onerror", "x()"), false);
  assert.equal(safeAttribute("img", "src", "https://i.imgur.com/a.gif"), true);
  assert.equal(safeAttribute("img", "src", "javascript:alert(1)"), false);
  assert.equal(safeAttribute("video", "src", "worlds/x/loop.webm"), true);
  assert.equal(safeAttribute("video", "poster", "https://x.com/p.jpg"), true);
  assert.equal(safeAttribute("div", "src", "worlds/x.png"), false);
  assert.equal(safeAttribute("a", "href", "https://cyberpunk.fandom.com/wiki/Skippy"), true);
  assert.equal(safeAttribute("a", "href", "javascript:alert(1)"), false);
  assert.equal(safeAttribute("a", "href", "data:text/html,x"), false);
  assert.equal(safeAttribute("use", "xlink:href", "#shape"), true);
  assert.equal(safeAttribute("use", "href", "https://x.com/sprite.svg#a"), false);
  assert.equal(safeAttribute("rect", "fill", "url(#grad)"), true);
  assert.equal(safeAttribute("rect", "fill", "url(https://x.com/a)"), false);
  assert.equal(safeAttribute("div", "data-mood", "grim"), true);
  assert.equal(safeAttribute("div", "class", "plate"), true);
  assert.equal(safeAttribute("div", "formaction", "x"), false);
});

test("templates: values, sections where a value is set, inverted sections, unknown tokens empty", () => {
  const values = { name: "Plan B", logo: "", line: "Paid in full", hit: "1", miss: "" };
  assert.equal(renderTemplate("<b>{{name}}</b>{{ nope }}", values), "<b>Plan B</b>");
  assert.equal(renderTemplate("{{#logo}}<img src='{{logo}}'>{{/logo}}{{^logo}}DD{{/logo}}", values), "DD");
  assert.equal(renderTemplate("{{#hit}}Nailed it{{/hit}}{{#miss}}No{{/miss}} · {{line}}", values), "Nailed it · Paid in full");
  assert.equal(renderTemplate("{{#logo}}x{{/logo}}", { logo: "worlds/l.png" }), "x");
});

test("a card's keyframes take its own name where its animations use them", () => {
  const names = new Map([["pulse", "hwc-c-a-pulse"]]);
  assert.equal(renameAnimations("pulse, hws-flash", names), "hwc-c-a-pulse, hws-flash");
});

test("cards are bounded, named, unique by default, with the outcomes' lines only", () => {
  const card = normalizeCard({ name: "  ", html: "x".repeat(30000), lines: { hit: " Yes ", nope: "x", miss: "" } });
  assert.equal(card.name, "Untitled card");
  assert.equal(card.unique, true);
  assert.equal(card.html.length, 20000);
  assert.deepEqual(card.lines, { hit: "Yes" });
  assert.equal(normalizeCard({ html: "", unique: false }).unique, false);
  assert.equal(normalizeCard(null), null);
  assert.equal(normalizeCard([]), null);
  assert.match(studioId("La Chingona Dórada!", "AbC123"), /^c-la-chingona-dorada-abc123$/);
  assert.equal(studioId("", ""), "c-card-0");
});

test("card files: one card or a set round-trips; anything else is refused with a reason", () => {
  const card = normalizeCard({ name: "Exhibit D", html: "<div>{{title}}</div>", css: ".x{}", lines: { hit: "Bagged." } });
  assert.deepEqual(parseCards(exportCards([card])), [card]);
  assert.deepEqual(parseCards(exportCards([card, card])), [card, card]);
  assert.deepEqual(parseCards(JSON.stringify({ name: "Bare", html: "<i></i>" })).map(c => c.name), ["Bare"]);
  assert.throws(() => parseCards("{nope"), /not JSON/);
  assert.throws(() => parseCards(JSON.stringify({ type: "hardwipe-legendary-cards", cards: "x" })), /no cards/);
  assert.throws(() => parseCards(JSON.stringify({ name: "No HTML" })), /missing its HTML/);
});

test("the studio names every outside site a card uses", () => {
  const card = { html: '<img src="https://i.imgur.com/a.gif"><a href="https://Cyberpunk.fandom.com/wiki/x">x</a>', css: 'background: url("https://media.giphy.com/b.gif")' };
  assert.deepEqual(outsideSites(card), ["cyberpunk.fandom.com", "i.imgur.com", "media.giphy.com"]);
  assert.deepEqual(outsideSites({ html: '<img src="worlds/x.png">', css: "" }), []);
});

test("studio cards on weapons: chosen by flag, one weapon at a time like signatures, their own classes", () => {
  const studio = { "c-plate-1": normalizeCard({ name: "Plate", html: "<i></i>" }) };
  const flag = id => ({ "hardwipe-ruleset": { cardIdentity: { schema: 1, mode: "studio", studio: id } } });
  assert.deepEqual(cardSpec(flag("c-plate-1")["hardwipe-ruleset"].cardIdentity, studio), { kind: "studio", id: "c-plate-1" });
  assert.equal(cardSpec(flag("c-gone")["hardwipe-ruleset"].cardIdentity, studio), null);
  assert.equal(cardSpec(flag("c-plate-1")["hardwipe-ruleset"].cardIdentity), null);
  const items = [{ uuid: "A", flags: flag("c-plate-1") }, { uuid: "B", flags: flag("c-plate-1") }];
  assert.deepEqual(heldElsewhere(items, "c-plate-1", "A", studio).map(item => item.uuid), ["B"]);
  assert.equal(rootClasses({ kind: "studio", id: "c-plate-1" }), "hardwipe-legendary hwc hwc-c-plate-1");
});

test("a card that places {{status}} keeps its own top row; one that doesn't gets Hardwipe's", () => {
  assert.equal(placesStatus({ html: '<div class="hwl-top">{{rarity}}{{ status }}</div>' }), true);
  assert.equal(placesStatus({ html: "<div>{{title}}</div>" }), false);
  assert.equal(placesStatus(null), false);
});
