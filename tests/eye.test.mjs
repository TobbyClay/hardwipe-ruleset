import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIANTS, dotMatrix, eyeLayout, hashSeed, lineParts, seededRandom, variantFor } from "../scripts/hardwipe-eye.js";

test("a message id always seeds the same eyes, and different ids seed different ones", () => {
  assert.equal(hashSeed("abc123"), hashSeed("abc123"));
  assert.notEqual(hashSeed("abc123"), hashSeed("abc124"));
  const a = seededRandom(42), b = seededRandom(42);
  const run = Array.from({ length: 5 }, () => a());
  assert.deepEqual(run, Array.from({ length: 5 }, () => b()));
  assert.ok(run.every(n => n >= 0 && n < 1));
});

test("a swarm opens one huge eye first, then small ones that never overlap", () => {
  const eyes = eyeLayout(hashSeed("msg-1"));
  assert.ok(eyes[0].main);
  assert.equal(eyes[0].w, 156);
  assert.ok(eyes.length > 20);
  const boxes = eyes.map(eye => [eye.x, eye.y, eye.w, eye.w * 0.6]);
  for (let i = 1; i < boxes.length; i++) for (let j = 0; j < i; j++) {
    const [ax, ay, aw, ah] = boxes[i], [bx, by, bw, bh] = boxes[j];
    // Positions are rounded to whole pixels, so allow a pixel of slack.
    assert.ok(!(ax < bx + bw - 1 && ax + aw - 1 > bx && ay < by + bh - 1 && ay + ah - 1 > by), `eyes ${i} and ${j} overlap`);
  }
  assert.deepEqual(eyeLayout(hashSeed("msg-1")), eyes);
});

test("the GM's variant wins; without one, the seed picks one of the nine", () => {
  assert.equal(VARIANTS.length, 9);
  assert.equal(variantFor("halo", 5), "halo");
  assert.equal(variantFor("", 0), VARIANTS[0]);
  assert.equal(variantFor("nonsense", 10), VARIANTS[1]);
});

test("the first O of the line opens into an eye", () => {
  assert.deepEqual(lineParts("WE SEE YOU"), { before: "WE SEE Y", after: "U", eye: true });
  assert.deepEqual(lineParts("LET US IN"), { before: "LET US IN", after: "", eye: false });
});

test("a line spelled in eyes wraps by word and lights the right dots", () => {
  const one = dotMatrix("I", 6);
  // The I: a top and bottom bar of three dots and a stem of five.
  assert.equal(one.dots.length, 11);
  assert.equal(one.cols, 5);
  assert.equal(one.rows, 7);
  const two = dotMatrix("LET US IN", 6);
  assert.equal(two.rows, 15); // "LET US" / "IN"
  assert.equal(two.cols, 6 * 6 - 1);
  assert.ok(two.dots.every(dot => dot.col >= 0 && dot.col < two.cols && dot.row >= 0 && dot.row < two.rows));
});
