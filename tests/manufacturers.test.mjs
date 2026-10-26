import { test } from "node:test";
import assert from "node:assert/strict";
import { MAKERS, STYLED, brandSlug, circuitHand, makerKey } from "../scripts/hardwipe-manufacturers.js";

test("a maker's name matches its style however it's written", () => {
  assert.equal(brandSlug("Kang Tao"), "kang-tao");
  assert.equal(brandSlug("kang-tao"), "kang-tao");
  assert.equal(brandSlug("  ARASAKA  "), "arasaka");
  assert.equal(brandSlug("Arasaka Corporation"), "arasaka");
  assert.equal(brandSlug("Tsunami Defense Systems"), "tsunami");
  assert.equal(brandSlug("Constitution Arms"), "constitutional");
  assert.equal(brandSlug("Tekhtronika"), "techtronika");
  assert.equal(brandSlug("ТЕХТРОНИКА"), "techtronika");
  assert.equal(brandSlug("Malorian Firearms"), "malorian");
  assert.equal(makerKey("Fabrique Européenne"), "fabriqueeuropeenne");
});

test("only question marks is the unknown maker; anything unstyled or empty gets no style", () => {
  assert.equal(brandSlug("????"), "unknown");
  assert.equal(brandSlug("?"), "unknown");
  assert.equal(brandSlug("Sternmeyer"), "");
  assert.equal(brandSlug(""), "");
  assert.equal(brandSlug(undefined), "");
  assert.equal(brandSlug("What?"), "");
});

test("eleven styles, each reachable from a suggested name", () => {
  assert.equal(STYLED.length, 11);
  const reached = new Set(MAKERS.map(brandSlug).filter(Boolean));
  assert.deepEqual([...reached].sort(), [...STYLED].sort());
  assert.equal(new Set(MAKERS).size, MAKERS.length);
});

test("PALE's circuit hand: fourteen traces from a fourteen-line bus to five fingertips", () => {
  const hand = circuitHand();
  assert.equal(hand.traces.length, 14);
  assert.equal(hand.bus.length, 14);
  assert.equal(hand.tips.length, 5);
  // Every trace leaves the palm, runs left, and ends at the left of where it started.
  for (const points of hand.traces) {
    assert.equal(points.length, 4);
    assert.ok(points[3][0] < points[0][0]);
  }
});
