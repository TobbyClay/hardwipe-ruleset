import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatsLabel } from "../scripts/hardwipe-state.js";

test("a default activity name gives way to the attack tag; a named activity stays", () => {
  assert.equal(repeatsLabel("Attack", "Heavy Pistol", "Ranged Attack"), true);
  assert.equal(repeatsLabel("attack", "Heavy Pistol", "Cyber Attack"), true);
  assert.equal(repeatsLabel("Heavy Pistol", "Heavy Pistol", "Ranged Attack"), true);
  assert.equal(repeatsLabel("", "Heavy Pistol", "Ranged Attack"), true);
  assert.equal(repeatsLabel("Burst Fire", "Heavy Pistol", "Ranged Attack"), false);
  assert.equal(repeatsLabel("Pistol Whip", "Heavy Pistol", "Melee Attack"), false);
});
