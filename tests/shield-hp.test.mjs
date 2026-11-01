import test from "node:test";
import assert from "node:assert/strict";
import { ShieldManager } from "../scripts/hardwipe-shields.js";

const item = flag => ({
  documentName: "Item", type: "equipment", system: { type: { value: "shield" }, equipped: true },
  getFlag: (scope, key) => (scope === "hardwipe-ruleset" && key === "shield" ? flag : undefined)
});
const read = flag => { const { hp, max, broken } = ShieldManager._getState(item(flag)); return { hp, max, broken }; };

test("shield HP is clamped to the item's own maximum: 10 unless the GM set one, never above 99", () => {
  assert.deepEqual(read({ hp: 7 }), { hp: 7, max: 10, broken: false });
  assert.deepEqual(read({ hp: 25, max: 40 }), { hp: 25, max: 40, broken: false });
  assert.deepEqual(read({ hp: 50, max: 40 }), { hp: 40, max: 40, broken: false });
  assert.deepEqual(read({ hp: 0, max: 15 }), { hp: 0, max: 15, broken: true });
  assert.deepEqual(read({ max: 15 }), { hp: 15, max: 15, broken: false });
  assert.equal(read({ hp: 3, max: 0 }).max, 10);
  assert.equal(read({ hp: 3, max: "abc" }).max, 10);
  assert.equal(read({ hp: 3, max: 500 }).max, 99);
  assert.deepEqual(read(undefined), { hp: 10, max: 10, broken: false });
});
