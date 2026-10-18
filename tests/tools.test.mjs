import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScale, toolFamily } from "../scripts/hardwipe-tool-cards.js";

test("a tool's family comes from its base item or type, else Breach; a GM flag wins", () => {
  assert.equal(toolFamily({ baseItem: "thief" }), "breach");
  assert.equal(toolFamily({ type: "thief" }), "breach");
  assert.equal(toolFamily({ baseItem: "disg" }), "spoof");
  assert.equal(toolFamily({ baseItem: "forg" }), "spoof");
  assert.equal(toolFamily({ baseItem: "pois" }), "synth");
  assert.equal(toolFamily({ type: "art", baseItem: "alchemist" }), "synth");
  assert.equal(toolFamily({ type: "art", baseItem: "smith" }), "fab");
  assert.equal(toolFamily({ type: "art" }), "fab");
  assert.equal(toolFamily({ baseItem: "navg" }), "nav");
  assert.equal(toolFamily({ type: "music", baseItem: "lute" }), "signal");
  assert.equal(toolFamily({ type: "game", baseItem: "dice" }), "signal");
  assert.equal(toolFamily({}), "breach");
  assert.equal(toolFamily({ baseItem: "thief", flag: "synth" }), "synth");
  assert.equal(toolFamily({ baseItem: "thief", flag: "nonsense" }), "breach");
});

test("with a DC a check is a success or a failure, filling by total / DC", () => {
  assert.deepEqual(checkScale({ total: 18, natural: 13, dc: 15 }).verdict, true);
  assert.equal(checkScale({ total: 9, natural: 4, dc: 15 }).verdict, false);
  assert.equal(checkScale({ total: 9, natural: 4, dc: 15 }).ratio, 9 / 15);
  assert.equal(checkScale({ total: 30, natural: 20, dc: 15 }).ratio, 1);
});

test("without a DC a check fills by where it falls in this roll's range, and names the standard DC it beats", () => {
  const s = checkScale({ total: 18, natural: 13 });
  assert.equal(s.verdict, null);
  assert.equal(s.min, 6);
  assert.equal(s.max, 25);
  assert.equal(s.ratio, (18 - 6) / 19);
  assert.deepEqual(s.ladder, { dc: 15, key: "Medium" });
  assert.deepEqual(checkScale({ total: 21, natural: 17 }).ladder, { dc: 20, key: "Hard" });
  assert.equal(checkScale({ total: 4, natural: 2 }).ladder, null);
  assert.equal(checkScale({ total: 6, natural: 1 }).ratio, 0);
  assert.equal(checkScale({ total: 25, natural: 20 }).ratio, 1);
});
