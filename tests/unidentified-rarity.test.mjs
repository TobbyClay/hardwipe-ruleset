import test from "node:test";
import assert from "node:assert/strict";
import { shownRarity } from "../scripts/hardwipe-attack-cards.js";

const item = (rarity, identified) => ({ system: { rarity, identified } });

test("card text names an unidentified item's rarity to the GM only, as dnd5e's sheets do", () => {
  const hidden = item("veryRare", false);
  assert.equal(shownRarity(hidden, { isGM: false }), "");
  assert.equal(shownRarity(hidden), "");
  assert.equal(shownRarity(hidden, { isGM: true }), "veryRare");
});

test("identified items, and items that can't be identified, keep their rarity for everyone", () => {
  assert.equal(shownRarity(item("rare", true), { isGM: false }), "rare");
  assert.equal(shownRarity(item("rare", true), { isGM: true }), "rare");
  // Feats and other items without the identified field.
  assert.equal(shownRarity(item("legendary", undefined), { isGM: false }), "legendary");
  assert.equal(shownRarity(item("", true)), "");
  assert.equal(shownRarity(null), "");
});
