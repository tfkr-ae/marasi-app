import { test } from "node:test";
import assert from "node:assert/strict";
import { androidBack } from "./androidBack.js";

function setup({ sheet = false, historyIndex = 0, path = "/" } = {}) {
  const calls = [];
  const handled = androidBack({
    closeTop: () => (calls.push("close"), sheet),
    historyIndex,
    path,
    back: () => calls.push("back"),
    home: () => calls.push("home"),
  });
  return { handled, calls };
}

test("Back closes an open sheet before anything else", () => {
  assert.deepEqual(setup({ sheet: true, historyIndex: 3, path: "/ledger" }), { handled: true, calls: ["close"] });
});

test("with no sheet, Back goes back a page", () => {
  assert.deepEqual(setup({ historyIndex: 2, path: "/ledger" }), { handled: true, calls: ["close", "back"] });
});

test("on the first page shown, Back goes Home", () => {
  assert.deepEqual(setup({ path: "/logbook" }), { handled: true, calls: ["close", "home"] });
});

test("from Home with nowhere to go back to, Back leaves it to Android", () => {
  assert.deepEqual(setup(), { handled: false, calls: ["close"] });
});
