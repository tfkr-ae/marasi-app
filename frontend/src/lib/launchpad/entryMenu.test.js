import { test } from "node:test";
import assert from "node:assert/strict";
import { entryMenuFor } from "./entryMenu.js";
import { menuAction } from "../ledger/rowMenu.js";

const entry = (id, extra = {}) => ({ ID: id, Method: "GET", Host: "acme.test", Path: `/${id}`, StatusCode: 200, ...extra });

const launchpads = [
  { ID: "L1", Name: "Login", EntryCount: 5 },
  { ID: "L2", Name: "Admin", EntryCount: 2 },
  { ID: "L3", Name: "Search", EntryCount: 0 },
];

// Login holds a…e in entry order; the menu is for the entries in `ids`.
function menu(ids, extra = {}) {
  return entryMenuFor({
    launchpadId: "L1",
    entries: ["a", "b", "c", "d", "e"].map((id) => entry(id)),
    ids,
    launchpads,
    entriesByLaunchpad: {},
    ...extra,
  });
}

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

test("Move to launchpad lists the other launchpads with their counts and adds at the end", () => {
  const move = item(menu(["b"]), "move");
  assert.equal(move.label, "Move to launchpad");
  assert.equal(move.disabled, undefined);
  assert.deepEqual(move.sub[0], { heading: "Adds at the end" });
  assert.deepEqual(
    move.sub.slice(1).map((it) => [it.label, it.count]),
    [["Admin", 2], ["Search", 0]],
  );
  assert.deepEqual(item(move.sub, "mv-L2").action, { type: "move", targetId: "L2", name: "Admin" });
  assert.equal(item(menu(["b", "c"]), "move").label, "Move 2 to launchpad");
});

test("a launchpad that already holds one of the pairs is greyed with how many", () => {
  const move = item(
    menu(["a", "b", "c"], { entriesByLaunchpad: { L2: [entry("b"), entry("c"), entry("x")], L3: [] } }),
    "move",
  );
  assert.equal(item(move.sub, "mv-L2").disabled, true);
  assert.equal(item(move.sub, "mv-L2").hint, "2 already in Admin");
  // An empty launchpad, or one whose entries are not loaded, takes them.
  assert.ok(!item(move.sub, "mv-L3").disabled);
});

test("Move to launchpad is greyed while an entry's launch is pending", () => {
  const move = item(menu(["b", "c"], { pendingIds: ["b", "x"] }), "move");
  assert.equal(move.disabled, true);
  assert.equal(move.hint, "1 launching");
  assert.ok(!item(menu(["c"], { pendingIds: ["b"] }), "move").disabled);
});

test("grouped by status or searching, moving to the end of another launchpad still works", () => {
  for (const extra of [{ grouped: true }, { searching: true }]) {
    const move = item(menu(["b"], extra), "move");
    assert.ok(!move.disabled);
    assert.ok(!item(move.sub, "mv-L2").disabled);
  }
});

// The `before` an Order item sends, or its hint when greyed.
function order(ids, id, extra) {
  const it = item(menu(ids, extra), id);
  return it.disabled ? it.hint : it.action.before;
}

test("Move up and down hop the block over the nearest unselected entry", () => {
  // a b c d e, with b and d picked.
  assert.equal(order(["b", "d"], "up"), "a"); // b d a c e
  assert.equal(order(["b", "d"], "down"), null); // a c e b d
  assert.equal(order(["c"], "down"), "e"); // a b d c e
  assert.equal(order(["a", "c"], "up"), "Already first");
  assert.equal(order(["c", "e"], "down"), "Already last");
});

test("Move to top and bottom place the block first or last unless it already is", () => {
  assert.equal(order(["b", "d"], "top"), "a");
  assert.equal(order(["b", "d"], "bottom"), null);
  assert.equal(order(["b", "a"], "top"), "Already first");
  assert.equal(order(["e", "d"], "bottom"), "Already last");
  // Picked a and c: not yet together at the top.
  assert.equal(order(["a", "c"], "top"), "b");
});

test("the Order items are greyed while grouped by status or searching, and run as shortcuts", () => {
  assert.equal(order(["c"], "up", { grouped: true }), "Grouped by status");
  assert.equal(order(["c"], "bottom", { searching: true }), "Searching");
  const items = menu(["c"]);
  assert.deepEqual(item(items, "top").action, { type: "reorder", before: "a" });
  assert.deepEqual(menuAction(items, "launchpad.tree.move-entries-up"), {
    action: { type: "reorder", before: "b" },
    disabled: false,
    hint: undefined,
  });
  assert.deepEqual(
    ["top", "up", "down", "bottom"].map((id) => item(items, id).actionId),
    [
      "launchpad.tree.move-entries-top",
      "launchpad.tree.move-entries-up",
      "launchpad.tree.move-entries-down",
      "launchpad.tree.move-entries-bottom",
    ],
  );
});

test("Remove from launchpad comes last, as a danger, greyed while an entry is launching from here", () => {
  const items = menu(["b", "c"]);
  assert.equal(items.at(-2), "sep");
  assert.deepEqual(items.at(-1), {
    id: "remove",
    label: "Remove 2 from launchpad",
    icon: "unlink",
    danger: true,
    action: { type: "remove" },
  });
  assert.equal(item(menu(["b"]), "remove").label, "Remove from launchpad");
  const launching = item(menu(["b", "c"], { pendingIds: ["c", "x"] }), "remove");
  assert.equal(launching.disabled, true);
  assert.equal(launching.hint, "1 launching");
});

test("Move to launchpad is greyed when there is no other launchpad", () => {
  const move = item(menu(["a"], { launchpads: [launchpads[0]] }), "move");
  assert.equal(move.disabled, true);
  assert.equal(move.hint, "No other launchpads");
});

test("Copy browser view URL is for one entry with a response that is not a WebSocket upgrade", () => {
  assert.deepEqual(item(menu(["b"]), "browser-view").action, { type: "browser-view", id: "b" });
  assert.equal(item(menu(["b"]), "browser-view").disabled, undefined);
  assert.equal(item(menu(["b", "c"]), "browser-view").hint, "One entry at a time");
  const status = (code) =>
    item(menu(["a"], { entries: [entry("a", { StatusCode: code })] }), "browser-view");
  assert.equal(status(0).disabled, true);
  assert.equal(status(0).hint, "No response yet");
  assert.equal(status(101).hint, "Not for a WebSocket upgrade");
});

// Findings and test cases, each with the pair IDs it links as Requests.
const findings = [
  { ID: 1, Title: "Login bypass", Severity: "High", Requests: ["a", "b"] },
  { ID: 2, Title: "Open redirect", Severity: "Low", Requests: ["b"] },
  { ID: 3, Title: "", Severity: "Info", Requests: [] },
];
const testCases = [{ ID: 7, Title: "Auth checks", Requests: ["c"] }];

// The ids of the menu's top-level items and dividers, in order.
const shape = (items) => items.map((it) => (it === "sep" ? "sep" : it.heading ? `#${it.heading}` : it.id));

test("Finding and Test case sit between Copy browser view URL and Remove", () => {
  assert.deepEqual(shape(menu(["b"], { findings, testCases })), [
    "move", "#Order", "top", "up", "down", "bottom", "sep",
    "browser-view", "sep", "finding", "testcase", "sep", "remove",
  ]);
  assert.equal(item(menu(["b"]), "finding").label, "Finding");
  assert.equal(item(menu(["b"]), "testcase").label, "Test case");
});

test("New is worded for one entry or several and carries its action", () => {
  assert.equal(item(menu(["b"]), "f-new").label, "New finding from this request");
  assert.equal(item(menu(["b", "c", "d"]), "f-new").label, "New finding with 3 requests");
  assert.equal(item(menu(["b"]), "t-new").label, "New test case from this request");
  assert.equal(item(menu(["b", "c"]), "t-new").label, "New test case with 2 requests");
  assert.deepEqual(item(menu(["b"]), "f-new").action, { type: "new-finding" });
  assert.deepEqual(item(menu(["b"]), "t-new").action, { type: "new-test-case" });
  assert.ok(!item(menu(["b"]), "f-new").disabled);
});

test("Link to lists every finding with its severity, checked, mixed or unlinked", () => {
  const items = menu(["a", "b"], { findings, testCases });
  const link = item(items, "f-link");
  assert.equal(link.label, "Link to finding");
  assert.ok(!link.disabled);
  assert.deepEqual(
    link.sub.map((it) => [it.label, it.severity, it.checked, Boolean(it.disabled)]),
    [
      ["Login bypass", "High", true, true],
      ["Open redirect", "Low", "mixed", false],
      ["Untitled finding", "Info", false, false],
    ],
  );
  assert.equal(item(items, "f-1").hint, "Already linked");
  assert.deepEqual(item(items, "f-2").action, { type: "link-finding", id: 2, title: "Open redirect" });
  assert.deepEqual(item(items, "t-7").action, { type: "link-test-case", id: 7, title: "Auth checks" });
});

test("Link to is greyed with no records yet", () => {
  const items = menu(["a"]);
  assert.equal(item(items, "f-link").disabled, true);
  assert.equal(item(items, "f-link").hint, "No findings yet");
  assert.equal(item(items, "t-link").disabled, true);
  assert.equal(item(items, "t-link").hint, "No test cases yet");
});

test("Unlink from lists only the records a picked entry is linked to, and is gone when none is", () => {
  const items = menu(["b"], { findings, testCases });
  assert.deepEqual(item(items, "f-unlink").sub.map((it) => it.label), ["Login bypass", "Open redirect"]);
  assert.deepEqual(item(items, "fu-2").action, { type: "unlink-finding", id: 2, title: "Open redirect" });
  assert.equal(item(items, "t-unlink"), null);
  assert.equal(item(menu(["e"], { findings, testCases }), "f-unlink"), null);
  assert.deepEqual(item(menu(["c"], { findings, testCases }), "tu-7").action, {
    type: "unlink-test-case",
    id: 7,
    title: "Auth checks",
  });
});

test("an entry whose launch is pending can still be linked or used for a new record", () => {
  const items = menu(["b", "e"], { findings, testCases, pendingIds: ["e"] });
  for (const id of ["finding", "testcase", "f-new", "f-link", "f-2", "f-unlink", "fu-1", "t-new", "t-link", "t-7"]) {
    assert.ok(!item(items, id).disabled, id);
  }
});

test("New finding and New test case show their shortcut keys and run as shortcuts", () => {
  const items = menu(["b", "c"]);
  assert.equal(item(items, "f-new").actionId, "launchpad.tree.create-finding");
  assert.equal(item(items, "t-new").actionId, "launchpad.tree.create-test-case");
  assert.deepEqual(menuAction(items, "launchpad.tree.create-finding"), {
    action: { type: "new-finding" },
    disabled: false,
    hint: undefined,
  });
  assert.deepEqual(menuAction(items, "launchpad.tree.create-test-case").action, { type: "new-test-case" });
});
