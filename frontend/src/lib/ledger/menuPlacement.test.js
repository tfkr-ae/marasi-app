import { test } from "node:test";
import assert from "node:assert/strict";
import { placeMenu, placeSubmenu } from "./menuPlacement.js";

const viewport = { width: 1600, height: 900 };
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const parent = rect(1000, 100, 288, 400);
const row = (top) => rect(1000, top, 288, 26);
// A panel's border plus padding at the Default text size: 1 px + 0.25rem.
const inset = { top: 5, bottom: 5 };

test("a submenu sits flush against its parent's right edge, its first item level with the row", () => {
  const place = placeSubmenu({ row: row(160), parent, width: 288, height: 120, viewport, inset });
  assert.deepEqual(place, { left: 1287, top: 155, maxHeight: 120, leftward: false });
});

test("it opens left, flush, when the levels below it don't fit on the right", () => {
  const roomForOne = { width: 1600, height: 900 };
  const place = placeSubmenu({ row: row(160), parent: rect(1000, 100, 288, 400), width: 288, height: 120, viewport: roomForOne, levels: 2, inset });
  assert.equal(place.leftward, true);
  assert.equal(place.left, 1000 + 1 - 288);
});

test("a deeper level keeps its parent's side", () => {
  const place = placeSubmenu({ row: row(160), parent: rect(500, 100, 288, 400), width: 288, height: 120, viewport, parentLeftward: true, inset });
  assert.equal(place.leftward, true);
  assert.equal(place.left, 500 + 1 - 288);
});

test("near the bottom it runs up from the row, its last item level with it", () => {
  const place = placeSubmenu({ row: row(800), parent, width: 288, height: 200, viewport, inset });
  assert.equal(place.top, 800 + 26 + 5 - 200);
  assert.equal(place.maxHeight, 200);
});

test("when it fits neither way it takes the roomier side and scrolls", () => {
  const below = placeSubmenu({ row: row(300), parent, width: 288, height: 1000, viewport, inset });
  assert.deepEqual([below.top, below.maxHeight], [295, 900 - 4 - 295]);
  const above = placeSubmenu({ row: row(700), parent, width: 288, height: 1000, viewport, inset });
  assert.deepEqual([above.top, above.maxHeight], [4, 700 + 26 + 5 - 4]);
});

test("the measured inset keeps the first or last item level at any text size", () => {
  // X-Large: 1 px border + 0.25rem of 20 px padding.
  const down = placeSubmenu({ row: row(160), parent, width: 288, height: 120, viewport, inset: { top: 6, bottom: 6 } });
  assert.equal(down.top, 160 - 6);
  // Small: 1 px border + 0.25rem of 14.4 px padding.
  const up = placeSubmenu({ row: row(800), parent, width: 288, height: 200, viewport, inset: { top: 4.6, bottom: 4.6 } });
  assert.equal(up.top, 800 + 26 + 4.6 - 200);
});

test("the menu opens at the pointer, above it when it doesn't fit below, left of it at the right edge", () => {
  assert.deepEqual(placeMenu({ x: 500, y: 100, width: 288, height: 400, viewport }), { left: 500, top: 100 });
  assert.deepEqual(placeMenu({ x: 500, y: 800, width: 288, height: 400, viewport }), { left: 500, top: 400 });
  assert.deepEqual(placeMenu({ x: 1500, y: 100, width: 288, height: 400, viewport }), { left: 1212, top: 100 });
  assert.deepEqual(placeMenu({ x: 500, y: 300, width: 288, height: 850, viewport }), { left: 500, top: 46 });
});
