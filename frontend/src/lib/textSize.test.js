import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  textSizeFrom,
  largerTextSize,
  smallerTextSize,
  rootFontSize,
  ledgerRowHeight,
} from "./textSize.js";

test("the four Text sizes go from Small to X-Large", () => {
  assert.deepEqual(
    TEXT_SIZES.map(({ id, label, scale }) => [id, label, scale]),
    [
      ["small", "Small", 0.9],
      ["default", "Default", 1],
      ["large", "Large", 1.125],
      ["xlarge", "X-Large", 1.25],
    ],
  );
});

test("a saved Text size reads back as that size", () => {
  for (const id of ["small", "default", "large", "xlarge"]) {
    assert.equal(textSizeFrom(id).id, id);
  }
});

test("an unknown, empty or missing saved Text size reads as Default", () => {
  for (const saved of ["huge", "Large", "", null, undefined, 1.25]) {
    assert.equal(textSizeFrom(saved).id, "default", `saved ${JSON.stringify(saved)}`);
  }
});

test("stepping up goes one size larger and stops at X-Large", () => {
  const up = (id) => largerTextSize(textSizeFrom(id)).id;
  assert.equal(up("small"), "default");
  assert.equal(up("default"), "large");
  assert.equal(up("large"), "xlarge");
  assert.equal(up("xlarge"), "xlarge");
});

test("stepping down goes one size smaller and stops at Small", () => {
  const down = (id) => smallerTextSize(textSizeFrom(id)).id;
  assert.equal(down("xlarge"), "large");
  assert.equal(down("large"), "default");
  assert.equal(down("default"), "small");
  assert.equal(down("small"), "small");
});

test("reset goes back to Default from any size", () => {
  assert.equal(DEFAULT_TEXT_SIZE.id, "default");
  assert.equal(DEFAULT_TEXT_SIZE.scale, 1);
});

test("the root font size is 16px times the size's scale", () => {
  assert.deepEqual(
    TEXT_SIZES.map((size) => rootFontSize(size)),
    ["14.4px", "16px", "18px", "20px"],
  );
});

test("a Ledger row is 22px at Default and a whole pixel count at every size", () => {
  assert.equal(ledgerRowHeight(textSizeFrom("default")), 22);
  assert.deepEqual(
    TEXT_SIZES.map((size) => ledgerRowHeight(size)),
    [20, 22, 25, 28],
  );
  for (const size of TEXT_SIZES) {
    assert.ok(Number.isInteger(ledgerRowHeight(size)), size.id);
  }
});
