import test from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "../../keybindings/catalog.js";
import { createKeymap } from "../../keybindings/keymap.js";
import { MACOS, WINDOWS_LINUX } from "../../keybindings/platform.js";
import { buildMenu, entryForKey, isReservedKey, searchMenu } from "./menuModel.js";

// A small catalog: a page with two groups and a loose action, and the global
// menu with two groups and a loose action.
const both = (mac, win = mac.replace(/meta/g, "ctrl")) => ({ [MACOS]: [mac], [WINDOWS_LINUX]: [win] });
const none = { [MACOS]: [], [WINDOWS_LINUX]: [] };
function act(id, label, defaults, group, context = id.split(".")[0]) {
  return { id, context, label, description: `${label} description`, keywords: "", defaults, ...(group ? { group } : {}) };
}
function group(context, id, label, letter) {
  return { context, id, label, letter, icon: "Eye", tone: "sky", description: `${label} things` };
}

const GROUPS = [
  group("global", "go", "Go to", "G"),
  group("global", "appearance", "Appearance", "A"),
  group("page", "focus", "Focus", "F"),
  group("page", "copy", "Copy", "C"),
  group("page", "lonely", "Lonely", "L"),
];
const ACTIONS = [
  act("global.open-menu", "Open Marasi Menu", both("meta+k")),
  act("global.go-home", "Marasi", both("meta+1"), "go"),
  act("global.go-settings", "Settings", both("meta+,"), "go"),
  act("global.toggle-light-mode", "Toggle Light Mode", both("meta+u"), "appearance"),
  act("global.toggle-vim", "Toggle Vim Mode", both("meta+t"), "appearance"),
  act("global.jump-to-toast", "Jump to Toast", both("meta+.")),
  act("page.focus-query", "Search", both("meta+s"), "focus"),
  act("page.focus-sitemap", "Find in Sitemap", both("meta+shift+\\"), "focus"),
  act("page.focus-alt", "Focus Alternative", both("meta+alt+j"), "focus"),
  act("page.copy-url", "Copy URL", both("meta+shift+c"), "copy"),
  act("page.copy-raw-request", "Copy Raw Request", both("meta+shift+r"), "copy"),
  act("page.copy-quit", "Copy Quietly", both("meta+q"), "copy"),
  act("page.only", "Only Child", both("meta+o"), "lonely"),
  act("page.new-note", "New Note", both("n")),
];
const CONTEXTS = [{ id: "global" }, { id: "page" }];
const catalog = createCatalog(ACTIONS, { contexts: CONTEXTS, groups: GROUPS });

const entries = (context) =>
  catalog.inContext(context).filter((a) => a.id !== "global.open-menu").map((a) => ({ actionId: a.id }));

function menuFor({ platform = MACOS, overrides = {}, page = entries("page"), letters } = {}) {
  const keymap = createKeymap(catalog, platform, overrides);
  return buildMenu({
    catalog,
    pageEntries: page,
    globalEntries: entries("global"),
    bindingsFor: keymap.bindingsFor,
    platform,
    letters,
  });
}

// The top level as [label, menu key] pairs, page section then Marasi section.
function topLevel(menu) {
  return menu.sections.map((section) => [
    section.scope,
    section.rows.map((row) => [row.kind === "group" ? row.label : row.name, row.menuKey]),
  ]);
}

// Groups are ⌥ + their letter; an action is its own key (⌘ here), or ⌥ + a
// derived letter when it has no modified binding (New Note's bare N).
test("the top level lists the page's groups and loose actions, then the Marasi section's", () => {
  assert.deepEqual(topLevel(menuFor()), [
    [
      "page",
      [
        ["Focus", "alt+f"],
        ["Copy", "alt+c"],
        ["Only Child", "meta+o"],
        ["New Note", "alt+n"],
      ],
    ],
    [
      "global",
      [
        ["Go to", "alt+g"],
        ["Appearance", "alt+a"],
        ["Jump to Toast", "meta+."],
      ],
    ],
  ]);
});

const groupNamed = (menu, label) => menu.sections.flatMap((s) => s.groups).find((g) => g.label === label);
const keysIn = (group) => group.items.map((item) => [item.name, item.menuKey]);

test("inside a group an action's menu key is its own ⌘ binding, Shift and Alt included", () => {
  assert.deepEqual(keysIn(groupNamed(menuFor(), "Focus")), [
    ["Search", "meta+s"],
    ["Find in Sitemap", "meta+shift+\\"],
    ["Focus Alternative", "meta+alt+j"],
  ]);
});

test("a rebound action's menu key follows the profile", () => {
  const menu = menuFor({ overrides: { "page.focus-sitemap": ["meta+shift+y"] } });
  assert.equal(groupNamed(menu, "Focus").items[1].menuKey, "meta+shift+y");
});

test("⌘K, ⌘Q and ⌘H are never menu keys; the fallback letter skips words the group shares", () => {
  // Copy Quietly is bound to ⌘Q, which is reserved. "Copy" is the group's
  // own word and every action's, so its ⌥ letter comes from "Quietly".
  assert.deepEqual(keysIn(groupNamed(menuFor(), "Copy")), [
    ["Copy URL", "meta+shift+c"],
    ["Copy Raw Request", "meta+shift+r"],
    ["Copy Quietly", "alt+q"],
  ]);
  const menu = menuFor({ overrides: { "global.toggle-light-mode": ["meta+k"], "global.toggle-vim": ["meta+h"] } });
  for (const g of menu.sections.flatMap((s) => s.groups)) {
    for (const item of g.items) assert.ok(!["meta+k", "meta+q", "meta+h"].includes(item.menuKey), item.name);
  }
});

// The menu leaves these to the system (Quit, Hide) and the dispatcher (the
// menu shortcut), so it never claims or remarks on them.
test("the menu shortcut, ⌘Q and ⌘H are reserved keys at every level; other ⌘ keys are not", () => {
  const menu = menuFor({ overrides: { "global.open-menu": ["meta+j"] } });
  for (const binding of ["meta+j", "meta+k", "meta+q", "meta+h"]) assert.ok(isReservedKey(menu, binding), binding);
  for (const binding of ["meta+f", "meta+z", "meta+shift+q"]) assert.ok(!isReservedKey(menu, binding), binding);
  assert.ok(isReservedKey(menuFor({ platform: WINDOWS_LINUX }), "ctrl+q"));
});

test("an action with no modified binding gets ⌥ + a letter from its distinctive words, never from filler", () => {
  const page = [{ actionId: "page.new-note", name: "To Do Note" }];
  assert.deepEqual(topLevel(menuFor({ page }))[0], ["page", [["To Do Note", "alt+d"]]]);
});

test("a profile's menu letter replaces the factory letter", () => {
  const menu = menuFor({ letters: { "page.copy": "Y" } });
  assert.equal(groupNamed(menu, "Copy").menuKey, "alt+y");
});

// A later release can give a group the letter a profile already uses (the
// "keybinding profiles override factory defaults" ADR): the profile's letter
// wins, and the factory group falls back to a derived key.
test("a profile's letter wins over a factory letter it clashes with, and the factory group gets a derived key", () => {
  const menu = menuFor({ letters: { "page.copy": "F" } });
  assert.equal(groupNamed(menu, "Copy").menuKey, "alt+f");
  assert.equal(groupNamed(menu, "Focus").menuKey, "alt+o");
  assert.equal(label(entryForKey(menu, { binding: "alt+f" })), "Copy");
});

test("on Windows and Linux actions keep their Ctrl keys and groups use Alt", () => {
  const menu = menuFor({ platform: WINDOWS_LINUX });
  assert.deepEqual(topLevel(menu)[1], [
    "global",
    [
      ["Go to", "alt+g"],
      ["Appearance", "alt+a"],
      ["Jump to Toast", "ctrl+."],
    ],
  ]);
  assert.equal(groupNamed(menu, "Focus").items[1].menuKey, "ctrl+shift+\\");
});

const label = (entry) => (entry ? (entry.kind === "group" ? entry.label : entry.name) : null);

test("a menu key at the top picks its group or action, and an unknown key picks nothing", () => {
  const menu = menuFor();
  assert.equal(label(entryForKey(menu, { binding: "alt+g" })), "Go to");
  assert.equal(label(entryForKey(menu, { binding: "meta+." })), "Jump to Toast");
  assert.equal(label(entryForKey(menu, { binding: "meta+o" })), "Only Child");
  assert.equal(entryForKey(menu, { binding: "meta+x" }), null);
  // A group's letter is ⌥, never ⌘.
  assert.equal(entryForKey(menu, { binding: "meta+g" }), null);
  // An action's own key doesn't reach into a closed group.
  assert.equal(entryForKey(menu, { binding: "meta+," }), null);
});

test("inside a group a menu key picks that group's action", () => {
  const menu = menuFor();
  assert.equal(label(entryForKey(menu, { group: "global.go", binding: "meta+," })), "Settings");
  assert.equal(label(entryForKey(menu, { group: "page.focus", binding: "meta+shift+\\" })), "Find in Sitemap");
  assert.equal(entryForKey(menu, { group: "global.go", binding: "alt+g" }), null);
});

test("menu keys are off while the search has text", () => {
  const menu = menuFor();
  assert.equal(entryForKey(menu, { query: "se", binding: "alt+g" }), null);
  assert.equal(entryForKey(menu, { group: "global.go", query: "x", binding: "meta+," }), null);
  assert.equal(label(entryForKey(menu, { query: "  ", binding: "alt+g" })), "Go to");
});

const found = (menu, level) => searchMenu(menu, level).map((entry) => [label(entry), entry.group?.label ?? null]);

test("a search at the top finds actions in every group, tagged with their group, in draw order", () => {
  assert.deepEqual(found(menuFor(), { query: "toggle" }), [
    ["Toggle Light Mode", "Appearance"],
    ["Toggle Vim Mode", "Appearance"],
  ]);
  assert.deepEqual(found(menuFor(), { query: "raw request" }), [["Copy Raw Request", "Copy"]]);
});

test("a group matches a search by its label, ahead of the actions", () => {
  assert.deepEqual(found(menuFor(), { query: "copy" }), [
    ["Copy", null],
    ["Copy URL", "Copy"],
    ["Copy Raw Request", "Copy"],
    ["Copy Quietly", "Copy"],
  ]);
});

test("a one-letter search matches word starts only", () => {
  // "s" is in "Focus" and "Toggle Vim Mode"'s description, but starts only
  // these words.
  assert.deepEqual(found(menuFor(), { query: "s" }), [
    ["Search", "Focus"],
    ["Find in Sitemap", "Focus"],
    ["Settings", "Go to"],
  ]);
});

test("a search inside a group searches only that group", () => {
  assert.deepEqual(found(menuFor(), { group: "page.copy", query: "r" }), [["Copy Raw Request", "Copy"]]);
  assert.deepEqual(found(menuFor(), { group: "page.copy", query: "settings" }), []);
});

test("an action keeps its own key over a group's ⌥ letter, and the group moves", () => {
  // Bound to ⌥G and ⌥A, the Go to and Appearance letters: a conflict a
  // profile can't save (letter-taken), but a stale saved state can hold one.
  // With the menu open the dispatcher runs the actions, so the menu shows
  // them under their keys and gives the groups other letters.
  const menu = menuFor({ overrides: { "page.only": ["alt+g"], "page.new-note": ["alt+a"] } });
  assert.equal(label(entryForKey(menu, { binding: "alt+g" })), "Only Child");
  assert.equal(label(entryForKey(menu, { binding: "alt+a" })), "New Note");
  assert.match(groupNamed(menu, "Go to").menuKey, /^alt\+[^ga]$/);
  assert.match(groupNamed(menu, "Appearance").menuKey, /^alt\+[^ga]$/);
  const keys = menu.sections.flatMap((s) => s.rows).map((row) => row.menuKey);
  assert.equal(new Set(keys).size, keys.length, keys.join(" "));
});

test("a menu with no page entries shows only the Marasi section", () => {
  assert.deepEqual(
    menuFor({ page: [] }).sections.map((s) => s.scope),
    ["global"],
  );
});
