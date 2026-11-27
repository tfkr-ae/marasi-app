import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_RAIL_PAGES,
  DEFAULT_RAIL_ORDER,
  HOME_RAIL_PAGE,
  dropSlotFromMidpoints,
  isDefaultRailOrder,
  projectBottomBar,
  railSlotDefaultKey,
  reorderRailOrder,
  resolveRailOrder,
  resolveRailPages,
  targetIndexFromDropSlot,
} from "./railOrder.js";

test("canonical built-in rail pages define the 10 reorderable pages below Home", () => {
  assert.equal(HOME_RAIL_PAGE.id, "home");
  assert.equal(HOME_RAIL_PAGE.route, "/");
  assert.deepEqual(DEFAULT_RAIL_ORDER, [
    "ledger",
    "compass",
    "checkpoint",
    "launchpad",
    "armory",
    "logbook",
    "workshop",
    "cyberchef",
    "excalidraw",
    "interact",
  ]);
  const byId = Object.fromEntries(BUILTIN_RAIL_PAGES.map((p) => [p.id, p]));
  assert.equal(byId.cyberchef.fallbackShortcut, "shift+y");
  assert.equal(byId.excalidraw.fallbackShortcut, "shift+j");
  assert.equal(byId.interact.label, "Interactsh");
  assert.equal(byId.interact.actionId, "global.go-interact");
  assert.equal(byId.interact.fallbackShortcut, undefined);
});

test("resolveRailOrder returns default order when saved list is empty or missing", () => {
  assert.deepEqual(resolveRailOrder(), DEFAULT_RAIL_ORDER);
  assert.deepEqual(resolveRailOrder(null), DEFAULT_RAIL_ORDER);
  assert.deepEqual(resolveRailOrder([]), DEFAULT_RAIL_ORDER);
});

test("resolveRailOrder preserves custom order, normalizes ids, ignores unknown ids, and deduplicates keeping first occurrence", () => {
  const saved = [
    "  Launchpad ",
    "removed-page",
    "CYBERCHEF",
    "ledger",
    "launchpad",
    "interact",
    "excalidraw",
    "unknown",
    "logbook",
    "checkpoint",
    "armory",
    "compass",
    "workshop",
    "ledger",
  ];
  assert.deepEqual(resolveRailOrder(saved), [
    "launchpad",
    "cyberchef",
    "ledger",
    "interact",
    "excalidraw",
    "logbook",
    "checkpoint",
    "armory",
    "compass",
    "workshop",
  ]);
});

test("resolveRailOrder inserts newly added canonical pages at their canonical default index rather than at the end", () => {
  // Simulate an older saved custom order that did not yet know about `newtool`
  // added at canonical index 2, plus a trailing `afterall` at index 5.
  const canonical = [
    { id: "alpha" },
    { id: "beta" },
    { id: "newtool" },
    { id: "gamma" },
    { id: "delta" },
  ];
  const saved = ["delta", "gamma", "beta", "alpha"];
  assert.deepEqual(resolveRailOrder(saved, canonical), [
    "delta",
    "gamma",
    "newtool",
    "beta",
    "alpha",
  ]);
});

test("resolveRailOrder clamps canonical insertion index when saved list is shorter than canonical index", () => {
  const canonical = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ];
  // Only "d" was saved; missing a (0), b (1), c (2) insert at their canonical positions.
  assert.deepEqual(resolveRailOrder(["d"], canonical), ["a", "b", "c", "d"]);

  // Saved has only 1 known item and a missing item whose canonical index (3) exceeds current length (1).
  const saved = ["a"];
  assert.deepEqual(resolveRailOrder(saved, canonical), ["a", "b", "c", "d"]);
});

test("isDefaultRailOrder detects default vs customized orders", () => {
  assert.equal(isDefaultRailOrder([]), true);
  assert.equal(isDefaultRailOrder(null), true);
  assert.equal(isDefaultRailOrder(DEFAULT_RAIL_ORDER), true);
  assert.equal(
    isDefaultRailOrder([
      "compass",
      "ledger",
      "checkpoint",
      "launchpad",
      "armory",
      "logbook",
      "workshop",
      "cyberchef",
      "excalidraw",
      "interact",
    ]),
    false,
  );
});

test("reorderRailOrder moves an item without mutating the source array", () => {
  const source = ["ledger", "compass", "checkpoint", "launchpad"];
  assert.deepEqual(reorderRailOrder(source, 0, 2), ["compass", "checkpoint", "ledger", "launchpad"]);
  assert.deepEqual(reorderRailOrder(source, 3, 1), ["ledger", "launchpad", "compass", "checkpoint"]);
  assert.deepEqual(reorderRailOrder(source, 2, 2), source);
  assert.deepEqual(reorderRailOrder(source, -1, 2), source);
  assert.deepEqual(reorderRailOrder(source, 0, 99), source);
  assert.deepEqual(source, ["ledger", "compass", "checkpoint", "launchpad"]);
});

test("dropSlotFromMidpoints and targetIndexFromDropSlot compute drag insertion indices", () => {
  const midpoints = [20, 60, 100, 140];
  assert.equal(dropSlotFromMidpoints(midpoints, 5), 0);
  assert.equal(dropSlotFromMidpoints(midpoints, 25), 1);
  assert.equal(dropSlotFromMidpoints(midpoints, 99), 2);
  assert.equal(dropSlotFromMidpoints(midpoints, 150), 4);

  // Dropping immediately before or after the dragged item is a no-op.
  assert.equal(targetIndexFromDropSlot(1, 1), null);
  assert.equal(targetIndexFromDropSlot(1, 2), null);
  // Moving item 1 before item 0 -> target index 0.
  assert.equal(targetIndexFromDropSlot(1, 0), 0);
  // Moving item 1 after item 2 (slot 3) -> target index 2.
  assert.equal(targetIndexFromDropSlot(1, 3), 2);
  // Moving item 0 to end (slot 4) -> target index 3.
  assert.equal(targetIndexFromDropSlot(0, 4), 3);
});

test("projectBottomBar puts Home + first 4 visible pages in primary and the rest in more", () => {
  const pages = resolveRailPages([]);
  const { primary, more } = projectBottomBar(pages, { chefShown: true });
  assert.deepEqual(
    primary.map((p) => p.id),
    ["home", "ledger", "compass", "checkpoint", "launchpad"],
  );
  assert.deepEqual(
    more.map((p) => p.id),
    ["armory", "logbook", "workshop", "cyberchef", "excalidraw", "interact"],
  );
});

test("projectBottomBar skips hidden CyberChef so 5 primary tabs stay full and omits it from more", () => {
  const custom = resolveRailPages([
    "cyberchef",
    "launchpad",
    "ledger",
    "logbook",
    "interact",
    "excalidraw",
    "checkpoint",
    "armory",
    "compass",
    "workshop",
  ]);

  const withChef = projectBottomBar(custom, { chefShown: true });
  assert.deepEqual(
    withChef.primary.map((p) => p.id),
    ["home", "cyberchef", "launchpad", "ledger", "logbook"],
  );
  assert.deepEqual(
    withChef.more.map((p) => p.id),
    ["interact", "excalidraw", "checkpoint", "armory", "compass", "workshop"],
  );

  const withoutChef = projectBottomBar(custom, { chefShown: false });
  assert.deepEqual(
    withoutChef.primary.map((p) => p.id),
    ["home", "launchpad", "ledger", "logbook", "interact"],
  );
  assert.deepEqual(
    withoutChef.more.map((p) => p.id),
    ["excalidraw", "checkpoint", "armory", "compass", "workshop"],
  );
});

test("railSlotDefaultKey returns digits 2-8 for slots 0-6, fallbackShortcut for 7+, and null otherwise", () => {
  const pages = resolveRailPages([]);
  assert.deepEqual(
    pages.map((page, index) => [page.id, railSlotDefaultKey(page, index)]),
    [
      ["ledger", "2"],
      ["compass", "3"],
      ["checkpoint", "4"],
      ["launchpad", "5"],
      ["armory", "6"],
      ["logbook", "7"],
      ["workshop", "8"],
      ["cyberchef", "shift+y"],
      ["excalidraw", "shift+j"],
      ["interact", null],
    ],
  );
});
