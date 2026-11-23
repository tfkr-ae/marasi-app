import { test } from "node:test";
import assert from "node:assert/strict";
import { editorMenuFor, selectionAt, selectionHeader } from "./editorMenu.js";

const recipes = { items: [{ id: "recipe-1", name: "Recipe 1" }, { id: "recipe-2", name: "JWT" }], openId: "recipe-2" };

test("the menu offers Copy and Send to CyberChef's New recipe and recipes, the open one with ⌘E's action", () => {
  const items = editorMenuFor({ recipes });
  assert.deepEqual(items.map((item) => item.id), ["copy", "chef"]);
  const chef = items[1];
  assert.deepEqual(
    chef.sub.map((item) => (item === "sep" ? "sep" : item.label)),
    ["New recipe", "sep", "Recipe 1", "JWT"],
  );
  assert.deepEqual(chef.sub[0].action, { type: "send-to-chef", target: "new" });
  assert.deepEqual(chef.sub[3].action, { type: "send-to-chef", target: "recipe-2" });
  assert.equal(chef.sub[3].actionId, "global.send-to-cyberchef");
  assert.equal(chef.sub[2].actionId, undefined);
});

test("without CyberChef the menu is Copy alone", () => {
  assert.deepEqual(editorMenuFor({ recipes, chef: false }).map((item) => item.id), ["copy"]);
});

test("the header gives the selection's size and first line", () => {
  assert.deepEqual(selectionHeader("eyJhbGciOi"), { size: "10 characters", preview: "eyJhbGciOi" });
  assert.deepEqual(selectionHeader("a\nbc\n"), { size: "5 characters · 3 lines", preview: "a" });
  assert.equal(selectionHeader("x").size, "1 character");
});

// A stand-in for an editor element and its EditorView.
function editor({ query = false, from = 0, to = 0, doc = "" } = {}) {
  const el = {
    closest: (selector) => (selector === ".cm-editor" ? el : selector === ".ledger-query" && query ? {} : null),
    contains: () => true,
  };
  const view = { state: { selection: { main: { from, to, empty: from === to } }, sliceDoc: (a, b) => doc.slice(a, b) } };
  return { el, view, findView: () => view };
}

test("a right-click takes the editor's selection, never the query editor's, and nothing without one", () => {
  const { el, view, findView } = editor({ from: 4, to: 9, doc: "GET /login HTTP/1.1" });
  assert.deepEqual(selectionAt(el, findView), { editor: el, view, text: "/logi" });
  const query = editor({ query: true, from: 0, to: 3, doc: "host" });
  assert.equal(selectionAt(query.el, query.findView), null);
  const empty = editor({ doc: "abc" });
  assert.equal(selectionAt(empty.el, empty.findView), null);
  assert.equal(selectionAt({ closest: () => null }, () => null), null);
});

test("an editor that leaves its selection to the page gives the page's", () => {
  const { el, findView } = editor({ doc: "abc" });
  const domSelection = { isCollapsed: false, anchorNode: {}, toString: () => "bc" };
  assert.equal(selectionAt(el, findView, domSelection).text, "bc");
});
