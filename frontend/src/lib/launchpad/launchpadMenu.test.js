import { test } from "node:test";
import assert from "node:assert/strict";
import { launchpadMenuFor } from "./launchpadMenu.js";
import { DELETE_LAUNCHPAD_PENDING_HINT } from "../launchPending.js";

const entry = (id) => ({ ID: id, Method: "GET", Host: "acme.test", Path: `/${id}`, StatusCode: 200 });

// Findings and test cases, each with the pair IDs it links as Requests.
const findings = [
  { ID: 1, Title: "Login bypass", Severity: "High", Requests: ["a", "b"] },
  { ID: 2, Title: "Open redirect", Severity: "Low", Requests: ["b"] },
  { ID: 3, Title: "", Severity: "Info", Requests: [] },
];
const testCases = [{ ID: 7, Title: "Auth checks", Requests: ["c"] }];

// The item with this id, anywhere in the menu.
function item(items, id) {
  for (const it of items) {
    if (!it || it === "sep" || it.heading) continue;
    if (it.id === id) return it;
    const found = it.sub && item(it.sub, id);
    if (found) return found;
  }
  return null;
}

// The ids of the menu's top-level items and dividers, in order.
const shape = (items) => items.map((it) => (it === "sep" ? "sep" : it.heading ? `#${it.heading}` : it.id));

// The launchpad menu for Login, over all of its entries (a…e by default).
function launchpadMenu(extra = {}) {
  return launchpadMenuFor({
    entries: ["a", "b", "c", "d", "e"].map((id) => entry(id)),
    findings,
    testCases,
    ...extra,
  });
}

test("the launchpad menu holds Finding and Test case over all of its entries", () => {
  const items = launchpadMenu();
  assert.deepEqual(shape(items), ["finding", "testcase", "sep", "rename", "delete"]);
  assert.equal(item(items, "f-new").label, "New finding with 5 requests");
  assert.equal(item(items, "t-new").label, "New test case with 5 requests");
  assert.deepEqual(item(items, "f-new").action, { type: "new-finding" });
  assert.deepEqual(item(items, "f-1").action, { type: "link-finding", id: 1, title: "Login bypass" });
  assert.equal(item(launchpadMenu({ entries: [entry("a")] }), "f-new").label, "New finding from this request");
  // ⌘⇧F and ⌘⇧B act on the Entry selection, not the launchpad.
  assert.equal(item(items, "f-new").actionId, undefined);
  assert.equal(item(items, "t-new").actionId, undefined);
});

test("the launchpad menu's link states count every entry, and a pending launch disables none", () => {
  const items = launchpadMenu({ pending: true });
  // Login bypass links a and b of a…e, so it is mixed, not checked.
  assert.deepEqual(
    item(items, "f-link").sub.map((it) => [it.label, it.checked]),
    [["Login bypass", "mixed"], ["Open redirect", "mixed"], ["Untitled finding", false]],
  );
  assert.deepEqual(item(items, "f-unlink").sub.map((it) => it.label), ["Login bypass", "Open redirect"]);
  const all = launchpadMenu({ entries: [entry("a"), entry("b")] });
  assert.equal(item(all, "f-1").checked, true);
  assert.equal(item(all, "f-1").hint, "Already linked");
  assert.equal(item(launchpadMenu({ entries: [entry("e")] }), "t-unlink"), null);
  for (const id of ["finding", "testcase", "f-new", "f-link", "f-2", "t-new", "t-link", "t-7"]) {
    assert.ok(!item(items, id).disabled, id);
  }
});

test("an empty launchpad's Finding and Test case are greyed with No entries", () => {
  const items = launchpadMenu({ entries: [] });
  assert.deepEqual(shape(items), ["finding", "testcase", "sep", "rename", "delete"]);
  for (const id of ["finding", "testcase"]) {
    assert.equal(item(items, id).disabled, true, id);
    assert.equal(item(items, id).hint, "No entries", id);
  }
});

test("Rename… follows Finding and Test case after a divider, even when empty or pending", () => {
  for (const items of [launchpadMenu(), launchpadMenu({ entries: [], pending: true })]) {
    assert.deepEqual(shape(items).slice(0, 4), ["finding", "testcase", "sep", "rename"]);
    const rename = item(items, "rename");
    assert.equal(rename.label, "Rename…");
    assert.equal(rename.disabled, undefined);
    assert.deepEqual(rename.action, { type: "rename" });
  }
});

test("the launchpad menu ends with Delete launchpad, marked as danger", () => {
  const items = launchpadMenu();
  const del = items.at(-1);
  assert.equal(del.id, "delete");
  assert.equal(del.label, "Delete launchpad");
  assert.equal(del.danger, true);
  assert.ok(!del.disabled);
  assert.deepEqual(del.action, { type: "delete" });
  assert.ok(!launchpadMenu({ entries: [] }).at(-1).disabled, "an empty launchpad can be deleted");
});

test("Delete launchpad is greyed with the pending hint while a launch from it is pending", () => {
  const del = launchpadMenu({ pending: true }).at(-1);
  assert.equal(del.disabled, true);
  assert.equal(del.hint, DELETE_LAUNCHPAD_PENDING_HINT);
});
