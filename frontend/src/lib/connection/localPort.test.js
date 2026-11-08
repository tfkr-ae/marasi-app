import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePort, portText } from "./localPort.js";

test("a blank port is any free port, and a whole number 1–65535 is that port", () => {
  assert.equal(parsePort(""), 0);
  assert.equal(parsePort("  "), 0);
  assert.equal(parsePort(" 8181 "), 8181);
  assert.equal(parsePort("65535"), 65535);
});

test("anything else isn't a port", () => {
  for (const text of ["0", "65536", "-1", "80.5", "abc", "8o8o"]) {
    assert.equal(parsePort(text), null, text);
  }
});

test("a saved port reads as itself, and none as any free port", () => {
  assert.equal(portText(8181), "8181");
  assert.equal(portText(0), "");
  assert.equal(portText(undefined), "");
});
