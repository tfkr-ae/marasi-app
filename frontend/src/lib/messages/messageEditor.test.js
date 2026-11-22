import { test } from "node:test";
import assert from "node:assert/strict";
import { markerOffset } from "./messageEditor.js";

test("a text error's line and column (1-based, the column in bytes) mark its place in the text", () => {
  const text = '1:VARINT 1\n3:LEN {"é" x}';
  // Line 2, byte column 13: past `3:LEN {"é" ` (é is two bytes), at the x.
  assert.equal(text[markerOffset(text, 2, 13)], "x");
  assert.equal(markerOffset(text, 1, 1), 0);
});

test("a place past the end of its line or the text stays inside the text", () => {
  const text = "1:VARINT 1\n3:LEN";
  assert.equal(markerOffset(text, 1, 99), 10);
  assert.equal(markerOffset(text, 9, 1), text.length);
  assert.equal(markerOffset("", 1, 1), 0);
});
