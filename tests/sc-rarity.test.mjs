import test from "node:test";
import assert from "node:assert/strict";
import { scRarityKey } from "../scripts/hardwipe-attack-cards.js";

const item = (rarity, identified = true) => ({ system: { rarity, identified } });

test("cards use SC's class key for the item's rarity; blank rarity is Common", () => {
  assert.equal(scRarityKey(item("veryRare")), "veryrare");
  assert.equal(scRarityKey(item("Very Rare")), "veryrare");
  assert.equal(scRarityKey(item({ value: "legendary" })), "legendary");
  assert.equal(scRarityKey(item("")), "common");
  assert.equal(scRarityKey(null), "common");
});

test("an unidentified item shows SC's Unidentified style to the viewers SC names, and its real rarity to the rest", () => {
  const hidden = item("legendary", false);
  // SC's default: players see the Unidentified style, the GM sees the real rarity.
  assert.equal(scRarityKey(hidden, { viewers: "players", isGM: false }), "scircunidentifiedstyle");
  assert.equal(scRarityKey(hidden, { viewers: "players", isGM: true }), "legendary");
  assert.equal(scRarityKey(hidden, { viewers: "everyone", isGM: true }), "scircunidentifiedstyle");
  assert.equal(scRarityKey(hidden, { viewers: "nobody", isGM: false }), "legendary");
  // Older SC has no Unidentified style: the real rarity shows.
  assert.equal(scRarityKey(hidden), "legendary");
  // Identified items never take it.
  assert.equal(scRarityKey(item("rare"), { viewers: "everyone" }), "rare");
});
