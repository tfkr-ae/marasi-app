import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createKeymap } from "./keymap.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";

test("menu opening is a global action bound to ⌘K on macOS and Ctrl+K on Windows/Linux", () => {
  const action = buildCatalog().get("global.open-menu");
  assert.equal(action.context, "global");
  assert.deepEqual(action.defaults, { [MACOS]: ["meta+k"], [WINDOWS_LINUX]: ["ctrl+k"] });
});

test("global navigation and Home actions keep today's labels and default keys", () => {
  const catalog = buildCatalog();
  const expected = [
    ["global.go-home", "Marasi", "meta+1", "ctrl+1"],
    ["global.go-ledger", "Ledger", "meta+2", "ctrl+2"],
    ["global.go-compass", "Compass", "meta+3", "ctrl+3"],
    ["global.go-checkpoint", "Checkpoint", "meta+4", "ctrl+4"],
    ["global.go-launchpad", "Launchpad", "meta+5", "ctrl+5"],
    ["global.go-armory", "Armory", "meta+6", "ctrl+6"],
    ["global.go-logbook", "Logbook", "meta+7", "ctrl+7"],
    ["global.go-workshop", "Workshop", "meta+8", "ctrl+8"],
    ["global.go-settings", "Settings", "meta+s", "ctrl+s"],
    ["global.start-chrome", "Start Chrome", "meta+`", "ctrl+`"],
    ["global.download-certificate", "Download Certificate", "meta+d", "ctrl+d"],
    ["global.copy-certificate", "Copy Certificate", "meta+,", "ctrl+,"],
    ["global.jump-to-toast", "Jump to Toast", "meta+.", "ctrl+."],
    ["global.open-project", "Open Project", "meta+o", "ctrl+o"],
    ["global.setup-listener", "Setup Listener", "meta+l", "ctrl+l"],
    ["global.toggle-vim", "Toggle Vim Mode", "meta+t", "ctrl+t"],
    ["global.toggle-light-mode", "Toggle Light Mode", "meta+u", "ctrl+u"],
    ["global.toggle-intercept", "Toggle Intercept", "meta+i", "ctrl+i"],
  ];
  for (const [id, label, mac, win] of expected) {
    const action = catalog.get(id);
    assert.ok(action, id);
    assert.equal(action.label, label, id);
    assert.equal(action.context, "global", id);
    assert.deepEqual(action.defaults, { [MACOS]: [mac], [WINDOWS_LINUX]: [win] }, id);
  }
});

test("the palette order of global actions is preserved", () => {
  const ids = buildCatalog().inContext("global").map((a) => a.id);
  assert.deepEqual(ids.slice(0, 4), ["global.open-menu", "global.go-home", "global.go-ledger", "global.go-compass"]);
  assert.equal(ids.at(-1), "global.toggle-intercept");
});

test("an unknown action id has no catalog entry", () => {
  assert.equal(buildCatalog().get("global.does-not-exist"), undefined);
});

test("extension navigation actions are identified by extension name, not position", () => {
  const first = buildCatalog({ extensions: [{ Name: "workshop" }, { Name: "Port Scanner" }] });
  const reordered = buildCatalog({ extensions: [{ Name: "Port Scanner" }, { Name: "workshop" }] });
  assert.ok(first.get("global.open-extension.port-scanner"));
  assert.ok(reordered.get("global.open-extension.port-scanner"));
  assert.equal(first.get("global.open-extension.port-scanner").label, "Port Scanner");
});

test("extension navigation defaults follow today's ⌘⌥1–9 order of the extension list", () => {
  const extensions = Array.from({ length: 10 }, (_, i) => ({ Name: `ext${i}` }));
  const catalog = buildCatalog({
    extensions: [{ Name: "compass" }, { Name: "checkpoint" }, ...extensions],
  });
  assert.equal(catalog.get("global.open-extension.compass"), undefined);
  assert.equal(catalog.get("global.open-extension.checkpoint"), undefined);
  assert.deepEqual(catalog.get("global.open-extension.ext0").defaults, {
    [MACOS]: ["meta+alt+1"],
    [WINDOWS_LINUX]: ["ctrl+alt+1"],
  });
  assert.deepEqual(catalog.get("global.open-extension.ext8").defaults[MACOS], ["meta+alt+9"]);
  assert.deepEqual(catalog.get("global.open-extension.ext9").defaults, { [MACOS]: [], [WINDOWS_LINUX]: [] });
});

const scanner = { Name: "Port Scanner" };
const scannerMenu = [
  { name: "Scan", subtitle: "Scan ports", keywords: "scan", action: "scanPorts", keys: ["⌘+⇧+H", "ctrl+⇧+H"] },
  { name: "Stop", action: "stop_scan", keys: ["⌘+⇧+J", "ctrl+⇧+J"] },
];

test("an extension's declared menu actions are identified by extension and action, not position", () => {
  const catalog = buildCatalog({
    extensions: [{ Name: "workshop" }, scanner],
    extensionMenus: { "Port Scanner": scannerMenu },
  });
  const scan = catalog.get("extension.port-scanner.scanports");
  assert.equal(scan.context, "extension-page.port-scanner");
  assert.equal(scan.label, "Scan");
  assert.equal(scan.description, "Scan ports");
  assert.equal(scan.keywords, "scan");
  assert.deepEqual(scan.defaults, { [MACOS]: ["meta+shift+h"], [WINDOWS_LINUX]: ["ctrl+shift+h"] });

  const reordered = buildCatalog({
    extensions: [scanner, { Name: "workshop" }],
    extensionMenus: { "Port Scanner": [...scannerMenu].reverse() },
  });
  assert.deepEqual(reordered.get("extension.port-scanner.scanports").defaults, scan.defaults);
  assert.deepEqual(reordered.get("extension.port-scanner.stop-scan").defaults[MACOS], ["meta+shift+j"]);
});

test("every extension page has a Toggle Settings action bound to ⌘P", () => {
  const catalog = buildCatalog({ extensions: [scanner] });
  const toggle = catalog.get("extension-page.port-scanner.toggle-settings");
  assert.equal(toggle.context, "extension-page.port-scanner");
  assert.equal(toggle.label, "Toggle Port Scanner Settings");
  assert.deepEqual(toggle.defaults, { [MACOS]: ["meta+p"], [WINDOWS_LINUX]: ["ctrl+p"] });
});

test("extension-declared ids never clash with Marasi's own extension actions", () => {
  const catalog = buildCatalog({
    extensions: [scanner],
    extensionMenus: {
      "Port Scanner": [
        { name: "Open", action: "open", keys: ["⌘+⇧+Y", "ctrl+⇧+Y"] },
        { name: "Settings", action: "toggle-settings", keys: ["⌘+⇧+G", "ctrl+⇧+G"] },
      ],
    },
  });
  assert.ok(catalog.get("global.open-extension.port-scanner"));
  assert.ok(catalog.get("extension-page.port-scanner.toggle-settings"));
  assert.ok(catalog.get("extension.port-scanner.open"));
  assert.ok(catalog.get("extension.port-scanner.toggle-settings"));
});

test("malformed extension menu items never break the catalog", () => {
  const catalog = buildCatalog({
    extensions: [scanner],
    extensionMenus: {
      "Port Scanner": [
        { name: "No action", keys: ["⌘+⇧+Q", "ctrl+⇧+Q"] },
        { name: "Bad keys", action: "bad", keys: ["⌘+⇧", "hyper+x"] },
        { name: "Same key both", action: "both", keys: "⌘+⇧+V, ctrl+⇧+V" },
        { name: "Duplicate", action: "Bad", keys: ["⌘+⇧+Z", "ctrl+⇧+Z"] },
        "not an item",
      ],
      Missing: [{ name: "Ghost", action: "ghost" }],
    },
  });
  const ids = catalog.actions.map((a) => a.id).filter((id) => id.startsWith("extension."));
  assert.deepEqual(ids, ["extension.port-scanner.bad", "extension.port-scanner.both"]);
  assert.deepEqual(catalog.get("extension.port-scanner.bad").defaults, { [MACOS]: [], [WINDOWS_LINUX]: [] });
  assert.deepEqual(catalog.get("extension.port-scanner.both").defaults, {
    [MACOS]: ["meta+shift+v", "ctrl+shift+v"],
    [WINDOWS_LINUX]: ["meta+shift+v", "ctrl+shift+v"],
  });
});

test("an action outside the lowercase dot/dash id format is rejected", () => {
  const define = (id) => () =>
    createCatalog([{ id, context: "global", label: "x", defaults: {} }]);
  assert.throws(define("global.Go_Home"));
  assert.throws(define("global.go home"));
});

test("an action in an unknown menu context is rejected", () => {
  assert.throws(() =>
    createCatalog([{ id: "nowhere.thing", context: "nowhere", label: "x", defaults: {} }]),
  );
});

test("the keymap shows only the current platform's bindings", () => {
  const catalog = buildCatalog();
  assert.deepEqual(createKeymap(catalog, MACOS).bindingsFor("global.go-home"), ["meta+1"]);
  assert.deepEqual(createKeymap(catalog, WINDOWS_LINUX).bindingsFor("global.go-home"), ["ctrl+1"]);
  assert.deepEqual(createKeymap(catalog, MACOS).actionsFor("ctrl+1"), []);
});

test("the keymap finds the actions bound to a key", () => {
  const keymap = createKeymap(buildCatalog(), MACOS);
  assert.deepEqual(keymap.actionsFor("meta+s"), ["global.go-settings"]);
});

test("an override replaces an action's defaults and an empty override unbinds it", () => {
  const keymap = createKeymap(buildCatalog(), MACOS, {
    "global.go-home": ["meta+h", "meta+h", "⌘+0"],
    "global.go-ledger": [],
  });
  assert.deepEqual(keymap.bindingsFor("global.go-home"), ["meta+h", "meta+0"]);
  assert.deepEqual(keymap.actionsFor("meta+1"), []);
  assert.deepEqual(keymap.bindingsFor("global.go-ledger"), []);
  assert.deepEqual(keymap.bindingsFor("global.go-compass"), ["meta+3"]);
});
