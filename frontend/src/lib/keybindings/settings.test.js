import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import {
  actionBindings,
  addBinding,
  browse,
  captureKey,
  isCustomized,
  isDirty,
  openDraft,
  removeBinding,
  replaceBinding,
  resetAction,
  saveDraft,
} from "./settings.js";

const contexts = [
  { id: "global", tier: "global", label: "Global", page: "Global", state: "Every page", isEligible: () => true },
  { id: "ledger.drawer-closed", tier: "page", label: "Ledger", page: "Ledger", state: "Drawer closed", isEligible: () => false },
  { id: "ledger.drawer-open", tier: "drawer", label: "Ledger drawer", page: "Ledger", state: "Drawer open", isEligible: () => false },
];

function both(mac, other) {
  return { [MACOS]: [mac], [WINDOWS_LINUX]: [other] };
}

const actions = [
  { id: "global.open-menu", context: "global", label: "Open Marasi Menu", description: "Open or close the Marasi menu", defaults: both("meta+k", "ctrl+k") },
  { id: "global.go-home", context: "global", label: "Marasi", description: "Dashboard", defaults: both("meta+1", "ctrl+1") },
  { id: "global.go-ledger", context: "global", label: "Ledger", description: "View requests", defaults: both("meta+2", "ctrl+2") },
  { id: "ledger.drawer-closed.focus-query", context: "ledger.drawer-closed", label: "Search", description: "Jump to search input", defaults: both("meta+shift+s", "ctrl+shift+s") },
  { id: "ledger.drawer-open.close", context: "ledger.drawer-open", label: "Close", description: "Close the drawer", defaults: both("meta+e", "ctrl+e") },
];
const catalog = createCatalog(actions, { contexts });
const allIds = actions.map((a) => a.id).sort();

function profile(id, name, overrides = {}, knownActions = allIds) {
  return { id, name, overrides: { [MACOS]: [], [WINDOWS_LINUX]: [], ...overrides }, knownActions };
}

function saved(profiles, activeProfile = profiles[0].id, problem = "") {
  return { config: { version: 1, activeProfile, profiles }, problem };
}

test("opening a draft settles every profile so a new default that collides with a customization shows as unbound", () => {
  // "Hand" knew only the menu and Home; it moved Home to ⌘2, which Ledger's
  // (new to this profile) default holds.
  const hand = profile("hand", "Hand", { [MACOS]: [{ action: "global.go-home", keys: ["meta+2"] }] }, ["global.go-home", "global.open-menu"]);
  const other = profile("other", "Other", {}, []);
  const draft = openDraft(saved([hand, other]), catalog);

  assert.deepEqual(actionBindings(catalog, draft.profiles[0], MACOS, "global.go-ledger"), []);
  assert.deepEqual(draft.profiles[0].knownActions, allIds);
  assert.deepEqual(draft.profiles[1].knownActions, allIds);
  assert.deepEqual(actionBindings(catalog, draft.profiles[1], WINDOWS_LINUX, "global.go-home"), ["ctrl+1"]);
  assert.equal(draft.activeProfile, "hand");
});

test("opening a draft never shares objects with the saved state", () => {
  const state = saved([profile("default", "Default", { [MACOS]: [{ action: "global.go-home", keys: ["meta+9"] }] })]);
  const draft = openDraft(state, catalog);
  draft.profiles[0].overrides[MACOS][0].keys.push("meta+8");
  assert.deepEqual(state.config.profiles[0].overrides[MACOS][0].keys, ["meta+9"]);
});

test("opening without a saved state starts from the factory profile", () => {
  const draft = openDraft(null, catalog);
  assert.equal(draft.activeProfile, "default");
  assert.deepEqual(draft.profiles.map((p) => p.name), ["Default"]);
  assert.deepEqual(actionBindings(catalog, draft.profiles[0], MACOS, "global.open-menu"), ["meta+k"]);
});

const home = { profileId: "default", platform: MACOS, actionId: "global.go-home" };

function factoryDraft() {
  return openDraft(saved([profile("default", "Default"), profile("other", "Other")]), catalog);
}

function bindings(draft, target = home) {
  const p = draft.profiles.find((item) => item.id === target.profileId);
  return actionBindings(catalog, p, target.platform, target.actionId);
}

test("adding an alternative keeps the defaults, dedupes a repeat, and leaves the other platform and profiles alone", () => {
  const before = factoryDraft();
  let draft = addBinding(catalog, before, home, "meta+h");
  draft = addBinding(catalog, draft, home, "meta+h");
  assert.deepEqual(bindings(draft), ["meta+1", "meta+h"]);
  assert.deepEqual(bindings(draft, { ...home, platform: WINDOWS_LINUX }), ["ctrl+1"]);
  assert.deepEqual(bindings(draft, { ...home, profileId: "other" }), ["meta+1"]);
  assert.deepEqual(bindings(before), ["meta+1"]);
  assert.equal(isCustomized(draft, home), true);
});

test("replacing a chip records the new key in its place", () => {
  let draft = addBinding(catalog, factoryDraft(), home, "meta+h");
  draft = replaceBinding(catalog, draft, home, 0, "meta+shift+h");
  assert.deepEqual(bindings(draft), ["meta+shift+h", "meta+h"]);
});

test("removing the last binding unbinds the action explicitly", () => {
  const draft = removeBinding(catalog, factoryDraft(), home, 0);
  assert.deepEqual(bindings(draft), []);
  const p = draft.profiles[0];
  assert.deepEqual(p.overrides[MACOS].find((o) => o.action === "global.go-home"), { action: "global.go-home", keys: [] });
});

test("reset returns one action to inheriting its default and an edit back to the default is not a customization", () => {
  let draft = removeBinding(catalog, factoryDraft(), home, 0);
  draft = addBinding(catalog, draft, { ...home, actionId: "global.go-ledger" }, "meta+9");
  const reset = resetAction(draft, home);
  assert.deepEqual(bindings(reset), ["meta+1"]);
  assert.equal(isCustomized(reset, home), false);
  assert.deepEqual(bindings(reset, { ...home, actionId: "global.go-ledger" }), ["meta+2", "meta+9"]);

  const back = addBinding(catalog, draft, home, "meta+1");
  assert.equal(isCustomized(back, home), false);
});

test("a draft is dirty only while it differs from what was opened", () => {
  const opened = factoryDraft();
  assert.equal(isDirty(opened, opened), false);
  const edited = removeBinding(catalog, opened, home, 0);
  assert.equal(isDirty(edited, opened), true);
  assert.equal(isDirty(resetAction(edited, home), opened), false);
  assert.equal(isDirty({ ...opened, activeProfile: "other" }, opened), true);
});

test("the order overrides were edited in does not make a draft dirty", () => {
  const ledger = { ...home, actionId: "global.go-ledger" };
  const a = addBinding(catalog, addBinding(catalog, factoryDraft(), home, "meta+h"), ledger, "meta+l");
  const b = addBinding(catalog, addBinding(catalog, factoryDraft(), ledger, "meta+l"), home, "meta+h");
  assert.equal(isDirty(a, b), false);
});

function keydown(key, code, mods = {}) {
  return { key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, ...mods };
}

test("capture records a logical key plus modifiers", () => {
  assert.deepEqual(captureKey(keydown("j", "KeyJ", { metaKey: true })), { type: "binding", binding: "meta+j" });
  assert.deepEqual(captureKey(keydown("{", "BracketLeft", { metaKey: true, shiftKey: true })), { type: "binding", binding: "meta+shift+[" });
  assert.deepEqual(captureKey(keydown("F5", "F5")), { type: "binding", binding: "f5" });
});

test("capture waits through modifier-only, composition and auto-repeat events", () => {
  assert.equal(captureKey(keydown("Meta", "MetaLeft", { metaKey: true })), null);
  assert.equal(captureKey(keydown("Shift", "ShiftLeft", { shiftKey: true })), null);
  assert.equal(captureKey(keydown("a", "KeyA", { isComposing: true })), null);
  assert.equal(captureKey(keydown("Process", "KeyA")), null);
  assert.equal(captureKey(keydown("j", "KeyJ", { metaKey: true, repeat: true })), null);
});

test("Escape cancels capture and dialog keys are refused", () => {
  assert.deepEqual(captureKey(keydown("Escape", "Escape")), { type: "cancel" });
  assert.deepEqual(captureKey(keydown("Tab", "Tab", { shiftKey: true })), { type: "reserved", binding: "shift+tab" });
  assert.deepEqual(captureKey(keydown("Enter", "Enter")), { type: "reserved", binding: "enter" });
  assert.deepEqual(captureKey(keydown("Enter", "Enter", { metaKey: true })), { type: "binding", binding: "meta+enter" });
});

test("a successful save persists the draft with the catalog, then updates live bindings", async () => {
  const live = createDispatcher({ catalog, platform: MACOS, keybindings: saved([profile("default", "Default")]) });
  const draft = addBinding(catalog, factoryDraft(), home, "meta+h");
  const calls = [];
  const result = await saveDraft({
    draft,
    catalog,
    save: async (config, descriptor) => {
      calls.push({ config, descriptor });
      return { config, problem: "" };
    },
    apply: (state) => live.configure({ keybindings: state }),
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].config, draft);
  assert.ok(calls[0].descriptor.actions.some((a) => a.id === "global.open-menu"));
  assert.deepEqual(live.bindingsFor("global.go-home"), ["meta+1", "meta+h"]);
});

test("a failed save reports the error and leaves live bindings unchanged", async () => {
  const live = createDispatcher({ catalog, platform: MACOS, keybindings: saved([profile("default", "Default")]) });
  const draft = addBinding(catalog, factoryDraft(), home, "meta+h");
  const result = await saveDraft({
    draft,
    catalog,
    save: async () => {
      throw "writing config: permission denied";
    },
    apply: (state) => live.configure({ keybindings: state }),
  });
  assert.deepEqual(result, { ok: false, error: "writing config: permission denied" });
  assert.deepEqual(live.bindingsFor("global.go-home"), ["meta+1"]);
});

const withExtension = createCatalog(
  [...actions, { id: "global.open-extension.repeater", context: "global", label: "Repeater", description: "Open Repeater", defaults: both("meta+alt+1", "ctrl+alt+1") }],
  { contexts },
);

function view(options = {}) {
  const draft = openDraft(saved([profile("default", "Default")]), withExtension);
  return browse({ catalog: withExtension, profile: draft.profiles[0], platform: MACOS, query: "", filter: "all", ...options });
}

const ids = (group) => group.items.map((row) => row.action.id);

test("the sidebar has one entry per page and state, with extension navigation separate from global actions", () => {
  const groups = view().groups;
  assert.deepEqual(
    groups.map((g) => [g.page, g.state, g.all.length]),
    [
      ["Global", "Every page", 3],
      ["Extensions", "Open extension pages", 1],
      ["Ledger", "Drawer closed", 1],
      ["Ledger", "Drawer open", 1],
    ],
  );
  assert.deepEqual(ids(groups[0]), ["global.open-menu", "global.go-home", "global.go-ledger"]);
});

test("search matches action labels, descriptions, pages, states and keys in either notation", () => {
  const found = (query) => view({ query }).groups.flatMap(ids);
  assert.deepEqual(found("dashboard"), ["global.go-home"]);
  assert.deepEqual(found("drawer open"), ["ledger.drawer-open.close"]);
  assert.deepEqual(found("⌘+2"), ["global.go-ledger"]);
  assert.deepEqual(found("meta+shift+s"), ["ledger.drawer-closed.focus-query"]);
  assert.deepEqual(found("nothing like this"), []);
});

test("unbound actions are flagged, counted and filterable", () => {
  const draft = removeBinding(withExtension, openDraft(saved([profile("default", "Default")]), withExtension), { ...home, actionId: "ledger.drawer-open.close" }, 0);
  const all = browse({ catalog: withExtension, profile: draft.profiles[0], platform: MACOS, query: "", filter: "all" });
  assert.equal(all.unboundCount, 1);
  const row = all.groups[3].all[0];
  assert.equal(row.status, "unbound");
  assert.deepEqual(row.bindings, []);
  assert.equal(all.groups[0].all[1].status, "");

  const unbound = browse({ catalog: withExtension, profile: draft.profiles[0], platform: MACOS, query: "", filter: "unbound" });
  assert.deepEqual(unbound.groups.flatMap(ids), ["ledger.drawer-open.close"]);
  assert.equal(unbound.groups[0].all.length, 3, "sidebar counts stay whole while filtering");
});

test("rows report whether Reset applies", () => {
  const draft = addBinding(withExtension, openDraft(saved([profile("default", "Default")]), withExtension), home, "meta+h");
  const rows = browse({ catalog: withExtension, profile: draft.profiles[0], platform: MACOS, query: "", filter: "all" }).groups[0].all;
  assert.deepEqual(rows.map((r) => r.customized), [false, true, false]);
});

test("actions in a same-context duplicate are conflicts, counted per entry and filterable", () => {
  const draft = addBinding(withExtension, openDraft(saved([profile("default", "Default")]), withExtension), home, "meta+2");
  const all = view({ profile: draft.profiles[0] });
  assert.equal(all.conflictCount, 2);
  assert.deepEqual(all.groups[0].all.map((r) => r.status), ["", "conflict", "conflict"]);
  assert.match(all.groups[0].all[1].problem, /Ledger/);
  assert.equal(all.groups[0].conflictCount, 2);
  assert.equal(all.groups[2].conflictCount, 0);

  const conflicts = view({ profile: draft.profiles[0], filter: "conflict" });
  assert.deepEqual(conflicts.groups.flatMap(ids), ["global.go-home", "global.go-ledger"]);
  // The other platform is a separate variant.
  assert.equal(view({ profile: draft.profiles[0], platform: WINDOWS_LINUX }).conflictCount, 0);
});

test("the real catalog's factory draft lists every page and state with nothing unbound or conflicting", () => {
  const real = buildCatalog({ extensions: [{ Name: "Repeater" }] });
  const result = browse({ catalog: real, profile: openDraft(null, real).profiles[0], platform: MACOS });
  assert.equal(result.unboundCount, 0);
  assert.equal(result.conflictCount, 0);
  const entries = result.groups.map((g) => `${g.page} / ${g.state}`);
  for (const entry of [
    "Global / Every page",
    "Extensions / Open extension pages",
    "Ledger / Drawer closed",
    "Ledger / Drawer open",
    "Ledger / Drawer open on a WebSocket upgrade",
    "WebSocket / Inject tab",
    "Armory / Request drawer open",
    "Repeater / Extension page",
  ]) {
    assert.ok(entries.includes(entry), `${entry} in ${entries.join(", ")}`);
  }
  assert.equal(new Set(entries).size, entries.length);
  assert.equal(result.groups.reduce((n, g) => n + g.all.length, 0), real.actions.length);
});

test("sidebar entries count their unbound actions", () => {
  const draft = removeBinding(withExtension, openDraft(saved([profile("default", "Default")]), withExtension), { ...home, actionId: "ledger.drawer-open.close" }, 0);
  assert.deepEqual(view({ profile: draft.profiles[0] }).groups.map((g) => g.unboundCount), [0, 0, 0, 1]);
});

// Unavailable extension actions. "Repeater" declares one menu action; the
// researcher customizes it and Repeater's navigation, then Repeater goes
// missing.
const repeater = { Name: "Repeater" };
const intruder = { Name: "Intruder" };
const repeaterMenu = { Repeater: [{ action: "send_request", name: "Send Request", keys: ["⌘+⇧+Y", "ctrl+shift+y"] }] };
const sendRequest = "extension.repeater.send-request";
const openRepeater = "global.open-extension.repeater";
const onMac = (actionId) => ({ profileId: "default", platform: MACOS, actionId });

function customizedRepeater() {
  const installed = buildCatalog({ extensions: [repeater], extensionMenus: repeaterMenu });
  let draft = openDraft(null, installed);
  draft = replaceBinding(installed, draft, onMac(sendRequest), 0, "meta+shift+u");
  draft = replaceBinding(installed, draft, onMac(openRepeater), 0, "meta+alt+8");
  return draft;
}

function rowsById(result) {
  return Object.fromEntries(result.groups.flatMap((group) => group.all.map((row) => [row.action.id, { row, group }])));
}

test("a customized extension action shows as unavailable, keeping its bindings, while its extension is missing", () => {
  const missing = buildCatalog({ extensions: [] });
  const draft = openDraft({ config: customizedRepeater(), problem: "" }, missing);
  const rows = rowsById(browse({ catalog: missing, profile: draft.profiles[0], platform: MACOS }));

  const send = rows[sendRequest];
  assert.equal(send.row.status, "unavailable");
  assert.equal(send.row.available, false);
  assert.deepEqual(send.row.bindings, ["meta+shift+u"]);
  assert.deepEqual(send.row.display, ["⌘+⇧+U"]);
  assert.equal(send.row.note, "Extension unavailable");
  assert.equal(send.group.state, "Extension unavailable");

  const open = rows[openRepeater];
  assert.equal(open.row.status, "unavailable");
  assert.deepEqual(open.row.bindings, ["meta+alt+8"]);
  assert.equal(open.group.page, "Extensions");
});

test("unavailable actions are not counted or filtered as unbound, even when their override unbinds them", () => {
  const installed = buildCatalog({ extensions: [repeater], extensionMenus: repeaterMenu });
  const unbound = removeBinding(installed, openDraft(null, installed), onMac(sendRequest), 0);
  const missing = buildCatalog({ extensions: [] });
  const profile = openDraft({ config: unbound, problem: "" }, missing).profiles[0];

  const all = browse({ catalog: missing, profile, platform: MACOS });
  const send = rowsById(all)[sendRequest];
  assert.equal(send.row.status, "unavailable");
  assert.deepEqual(send.row.bindings, []);
  assert.equal(all.unboundCount, 0);
  assert.equal(send.group.unboundCount, 0);
  assert.deepEqual(browse({ catalog: missing, profile, platform: MACOS, filter: "unbound" }).groups.flatMap(ids), []);
  assert.deepEqual(browse({ catalog: missing, profile, platform: MACOS, query: "unavailable" }).groups.flatMap(ids), [sendRequest]);
});

test("edits saved while the extension is missing keep its customizations, which apply again when it returns", () => {
  const missing = buildCatalog({ extensions: [] });
  let draft = openDraft({ config: customizedRepeater(), problem: "" }, missing);
  draft = addBinding(missing, draft, onMac("global.go-home"), "meta+shift+h");
  // Saved and reopened while still missing (the backend settles the same way).
  draft = openDraft({ config: draft, problem: "" }, missing);

  const returned = buildCatalog({ extensions: [repeater], extensionMenus: repeaterMenu });
  const reopened = openDraft({ config: draft, problem: "" }, returned);
  const rows = rowsById(browse({ catalog: returned, profile: reopened.profiles[0], platform: MACOS }));
  assert.deepEqual(rows[sendRequest].row.bindings, ["meta+shift+u"]);
  assert.equal(rows[sendRequest].row.status, "");
  assert.equal(rows[sendRequest].row.available, true);
  assert.deepEqual(rows[openRepeater].row.bindings, ["meta+alt+8"]);

  const live = createDispatcher({
    catalog: returned,
    platform: MACOS,
    overrides: { [MACOS]: Object.fromEntries(reopened.profiles[0].overrides[MACOS].map((o) => [o.action, o.keys])) },
  });
  assert.deepEqual(live.bindingsFor(openRepeater), ["meta+alt+8"]);
});

test("reordering extensions keeps a customization with its extension; defaults follow the new order", () => {
  const before = buildCatalog({ extensions: [repeater, intruder] });
  const custom = replaceBinding(before, openDraft(null, before), onMac(openRepeater), 0, "meta+alt+8");

  const after = buildCatalog({ extensions: [intruder, repeater] });
  const rows = rowsById(browse({ catalog: after, profile: openDraft({ config: custom, problem: "" }, after).profiles[0], platform: MACOS }));
  assert.deepEqual(rows[openRepeater].row.bindings, ["meta+alt+8"]);
  assert.deepEqual(rows["global.open-extension.intruder"].row.bindings, ["meta+alt+1"]);
  assert.equal(rows["global.open-extension.intruder"].row.customized, false);
});

test("an action its installed extension no longer declares is listed unavailable on that extension's page", () => {
  const withoutMenu = buildCatalog({ extensions: [repeater, intruder] });
  const result = browse({ catalog: withoutMenu, profile: openDraft({ config: customizedRepeater(), problem: "" }, withoutMenu).profiles[0], platform: MACOS });
  const page = result.groups.find((g) => g.id === "extension-page.repeater");
  assert.deepEqual(page.all.map((r) => [r.action.id, r.status]), [
    ["extension-page.repeater.toggle-settings", ""],
    [sendRequest, "unavailable"],
  ]);
  assert.equal(page.all[1].note, "Not offered by this extension");
  assert.equal(result.groups.filter((g) => g.id === "extension-page.repeater").length, 1);
});

test("a missing extension's dormant binding runs nothing", () => {
  const missing = buildCatalog({ extensions: [] });
  const profile = openDraft({ config: customizedRepeater(), problem: "" }, missing).profiles[0];
  const live = createDispatcher({
    catalog: missing,
    platform: MACOS,
    overrides: { [MACOS]: Object.fromEntries(profile.overrides[MACOS].map((o) => [o.action, o.keys])) },
  });
  let ran = false;
  live.register(openRepeater, () => (ran = true));
  const event = { key: "8", code: "Digit8", metaKey: true, altKey: true, ctrlKey: false, shiftKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {} };
  assert.equal(live.resolve(event, { route: "/" }), null);
  assert.equal(live.dispatch(event, { route: "/" }), false);
  assert.equal(ran, false);
});
