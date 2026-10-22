import { test } from "node:test";
import assert from "node:assert/strict";
import { WRAP_LINE_LIMIT, wrapsLines, wrapStartsOn } from "./lineWrap.js";

const headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n";
const small = `${headers}{"a":1}`;
// A JSON response holding a 2.5 MB base64 file: one line of 2.5 MB.
const base64File = `${headers}{"name":"file.pdf","data":"${"QUJD".repeat(625_000)}"}`;

test("an editor wraps a body's lines while Wrap lines is on", () => {
  for (const mode of ["auto", "enabled", "disabled", undefined]) {
    assert.equal(wrapsLines(small, true, mode), true, `mode ${mode}`);
    assert.equal(wrapsLines(small, false, mode), false, `mode ${mode}`);
  }
  assert.equal(wrapsLines("", true, "auto"), true);
  assert.equal(wrapsLines(undefined, true, "auto"), true);
});

test("Auto does not wrap a body with a line over the limit, as wrapping it freezes the page", () => {
  assert.equal(wrapsLines(base64File, true, "auto"), false);
  assert.equal(wrapsLines("x".repeat(WRAP_LINE_LIMIT), true, "auto"), true);
  assert.equal(wrapsLines("x".repeat(WRAP_LINE_LIMIT + 1), true, "auto"), false);
  assert.equal(wrapsLines(`short\n${"x".repeat(WRAP_LINE_LIMIT + 1)}\nshort`, true, "auto"), false, "the long line is in the middle");
  assert.equal(wrapsLines(`${"x".repeat(WRAP_LINE_LIMIT)}\n`.repeat(30), true, "auto"), true, "a large body of lines under the limit");
});

test("Enabled wraps every line; any other mode, or none before the settings load, stops at the limit", () => {
  assert.equal(wrapsLines(base64File, true, "enabled"), true);
  assert.equal(wrapsLines(base64File, true, "disabled"), false, "the toggle was turned on under Disabled");
  assert.equal(wrapsLines(base64File, true, undefined), false);
});

test("Wrap lines starts on unless the setting is Disabled", () => {
  assert.equal(wrapStartsOn("auto"), true);
  assert.equal(wrapStartsOn("enabled"), true);
  assert.equal(wrapStartsOn(undefined), true);
  assert.equal(wrapStartsOn("disabled"), false);
});
