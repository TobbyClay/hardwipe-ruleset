import { test } from "node:test";
import assert from "node:assert/strict";
import { coupDeGraceBlocker } from "../scripts/hardwipe-coup.js";

const base = { mook: true, surprised: true, hp: 11, band: "clean" };

test("a hit on a surprised mook is a Coup de Grace while Heat is Clean or Hot, or with no mission", () => {
  assert.equal(coupDeGraceBlocker(base), "");
  assert.equal(coupDeGraceBlocker({ ...base, band: "hot" }), "");
  assert.equal(coupDeGraceBlocker({ ...base, band: "idle" }), "");
});

test("no Coup de Grace on a non-mook (Legendary Resistance or a player character), an alert target, the downed, or at Critical Heat", () => {
  assert.equal(coupDeGraceBlocker({ ...base, mook: false }), "notMook");
  assert.equal(coupDeGraceBlocker({ ...base, surprised: false }), "notSurprised");
  assert.equal(coupDeGraceBlocker({ ...base, hp: 0 }), "down");
  assert.equal(coupDeGraceBlocker({ ...base, band: "critical" }), "heat");
  assert.equal(coupDeGraceBlocker({ ...base, band: "lockdown" }), "heat");
});
