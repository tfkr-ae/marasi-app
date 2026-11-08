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
  captureLetter,
  isDirty,
  isProfileCustomized,
  openDraft,
  pagesOf,
  removeBinding,
  replaceBinding,
  resetAction,
  resetProfile,
  resetGroupLetter,
  resetGroupLetters,
  saveDraft,
  saveProblems,
  setGroupLetter,
} from "./settings.js";
import { menuLetters } from "./profiles.js";

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

// Whether the target's row offers Reset.
function resettable(draft, target, at = catalog) {
  const profile = draft.profiles.find((p) => p.id === target.profileId);
  const rows = browse({ catalog: at, profile, platform: target.platform }).groups.flatMap((g) => g.all);
  return rows.find((row) => row.action.id === target.actionId).resettable;
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
  assert.equal(resettable(draft, home), true);
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
  assert.equal(resettable(draft, home), true);
  const reset = resetAction(draft, home);
  assert.deepEqual(bindings(reset), ["meta+1"]);
  assert.equal(resettable(reset, home), false);
  assert.deepEqual(bindings(reset, { ...home, actionId: "global.go-ledger" }), ["meta+2", "meta+9"]);

  const back = addBinding(catalog, draft, home, "meta+1");
  assert.equal(resettable(back, home), false);
});

test("Reset does not apply when the action's keys already equal what resetting would give", () => {
  const extra = createCatalog(
    [
      ...actions,
      { id: "global.toggle-vim", context: "global", label: "Vim", description: "Toggle Vim mode", defaults: { [MACOS]: [], [WINDOWS_LINUX]: [] } },
      { id: "global.open-extension.repeater", context: "global", label: "Repeater", description: "Open Repeater", defaults: both("meta+alt+1", "ctrl+alt+1"), positionalDefault: true },
    ],
    { contexts },
  );
  const at = (actionId) => ({ ...home, actionId });
  // A saved override equal to the default, an explicit unbinding of an
  // action whose default is empty, and an explicit unbinding of a
  // positional default that yields to Home's customization anyway.
  const overrides = {
    [MACOS]: [
      { action: "global.go-ledger", keys: ["meta+2"] },
      { action: "global.toggle-vim", keys: [] },
      { action: "global.go-home", keys: ["meta+alt+1"] },
      { action: "global.open-extension.repeater", keys: [] },
    ],
  };
  const draft = openDraft(saved([profile("default", "Default", overrides, extra.actions.map((a) => a.id))]), extra);
  assert.equal(resettable(draft, at("global.go-ledger"), extra), false);
  assert.equal(resettable(draft, at("global.toggle-vim"), extra), false);
  assert.equal(resettable(draft, at("global.open-extension.repeater"), extra), false);
  assert.equal(resettable(draft, home, extra), true);
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
  assert.deepEqual(rows.map((r) => r.resettable), [false, true, false]);
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
    "Ledger / Drawer open (WebSocket)",
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
  draft = replaceBinding(installed, draft, onMac(sendRequest), 0, "meta+shift+j");
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
  assert.deepEqual(send.row.bindings, ["meta+shift+j"]);
  assert.deepEqual(send.row.display, ["⌘⇧J"]);
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

test("action counts leave out unavailable rows, which are still listed", () => {
  const missing = buildCatalog({ extensions: [] });
  const draft = openDraft({ config: customizedRepeater(), problem: "" }, missing);
  const result = browse({ catalog: missing, profile: draft.profiles[0], platform: MACOS });
  const rows = rowsById(result);
  for (const id of [openRepeater, sendRequest]) {
    assert.equal(rows[id].group.all.length, 1, `${id} is listed`);
    assert.equal(rows[id].group.actionCount, 0, `${id} is not counted`);
  }
  assert.equal(result.actionCount, missing.actions.length);
  const global = result.groups.find((g) => g.id === "global");
  assert.equal(global.actionCount, global.all.length);
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
  assert.deepEqual(rows[sendRequest].row.bindings, ["meta+shift+j"]);
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
  assert.equal(rows["global.open-extension.intruder"].row.resettable, false);
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

test("an unavailable action's binding is not a conflict and never blocks Save", () => {
  const missing = buildCatalog({ extensions: [] });
  // Home takes ⌘⌥8, which the missing Repeater's navigation keeps.
  const draft = addBinding(missing, openDraft({ config: customizedRepeater(), problem: "" }, missing), onMac("global.go-home"), "meta+alt+8");
  const result = browse({ catalog: missing, profile: draft.profiles[0], platform: MACOS });
  assert.equal(result.conflictCount, 0);
  assert.equal(rowsById(result)[openRepeater].row.status, "unavailable");
  assert.deepEqual(browse({ catalog: missing, profile: draft.profiles[0], platform: MACOS, filter: "conflict" }).groups.flatMap(ids), []);
  assert.deepEqual(saveProblems(missing, draft, { profileId: "default", platform: MACOS }), []);
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

const rowOf = (result, id) => result.groups.flatMap((g) => g.all).find((r) => r.action.id === id);
const search = { ...home, actionId: "ledger.drawer-closed.focus-query" };

test("a more-specific binding that shadows a global one is shown as shadowing on both rows, not as a conflict", () => {
  const draft = addBinding(withExtension, openDraft(saved([profile("default", "Default")]), withExtension), search, "meta+1");
  const all = view({ profile: draft.profiles[0] });

  assert.equal(all.conflictCount, 0);
  assert.equal(rowOf(all, "ledger.drawer-closed.focus-query").status, "shadowing");
  assert.equal(rowOf(all, "ledger.drawer-closed.focus-query").problem, "⌘1 shadows Marasi (Global) here");
  assert.equal(rowOf(all, "global.go-home").status, "shadowing");
  assert.equal(rowOf(all, "global.go-home").problem, "⌘1 is shadowed by Search in Ledger · Drawer closed");
  assert.deepEqual(view({ profile: draft.profiles[0], filter: "conflict" }).groups.flatMap(ids), []);
});

test("an unbound or shadowed Open Marasi Menu is a conflict on the rows involved", () => {
  const menu = { ...home, actionId: "global.open-menu" };
  const fresh = openDraft(saved([profile("default", "Default")]), withExtension);

  const unbound = view({ profile: removeBinding(withExtension, fresh, menu, 0).profiles[0] });
  assert.equal(rowOf(unbound, "global.open-menu").status, "conflict");
  assert.equal(rowOf(unbound, "global.open-menu").problem, "The Marasi menu must have a binding");
  assert.equal(unbound.unboundCount, 0, "a conflict is not also counted as unbound");

  const shadowed = view({ profile: addBinding(withExtension, fresh, search, "meta+k").profiles[0] });
  assert.equal(shadowed.conflictCount, 2);
  assert.equal(rowOf(shadowed, "global.open-menu").problem, "⌘K is shadowed by Search in Ledger · Drawer closed; the menu must open everywhere");
  assert.equal(rowOf(shadowed, "ledger.drawer-closed.focus-query").problem, "⌘K would shadow Open Marasi Menu, which must open everywhere");
});

test("a duplicate across overlapping contexts names the other action's context", () => {
  const overlapping = createCatalog(
    [
      ...actions,
      { id: "ledger.drawer-open.websocket.stream", context: "ledger.drawer-open.websocket", label: "Open Stream", description: "", defaults: both("meta+shift+o", "ctrl+shift+o") },
    ],
    {
      contexts: [
        ...contexts,
        { id: "ledger.drawer-open.websocket", tier: "drawer", label: "WS", page: "Ledger", state: "WebSocket drawer", overlaps: ["ledger.drawer-open"], isEligible: () => false },
      ],
    },
  );
  const stream = { ...home, actionId: "ledger.drawer-open.websocket.stream" };
  const draft = addBinding(overlapping, openDraft(saved([profile("default", "Default")]), overlapping), stream, "meta+e");
  const result = browse({ catalog: overlapping, profile: draft.profiles[0], platform: MACOS });
  assert.equal(rowOf(result, "ledger.drawer-open.websocket.stream").problem, "⌘E is also bound to Close in Ledger · Drawer open");
  assert.equal(rowOf(result, "ledger.drawer-open.close").problem, "⌘E is also bound to Open Stream in Ledger · WebSocket drawer");
});

test("save problems cover every profile and platform and say where each one is", () => {
  const fresh = factoryDraft();
  assert.deepEqual(saveProblems(catalog, fresh), []);

  // A duplicate on the other profile's Windows/Linux variant, which is not
  // on screen while Default/macOS is shown.
  const hidden = addBinding(catalog, fresh, { profileId: "other", platform: WINDOWS_LINUX, actionId: "global.go-home" }, "ctrl+2");
  assert.deepEqual(saveProblems(catalog, hidden), [
    {
      profileId: "other",
      platform: WINDOWS_LINUX,
      groupId: "global",
      actionId: "global.go-home",
      message: "Other · Windows / Linux · Global · Marasi: ⌃2 is also bound to Ledger",
    },
  ]);

  const menuless = removeBinding(catalog, hidden, { ...home, actionId: "global.open-menu" }, 0);
  const problems = saveProblems(catalog, menuless, { profileId: "other", platform: WINDOWS_LINUX });
  assert.deepEqual(
    problems.map((p) => p.message),
    [
      "Other · Windows / Linux · Global · Marasi: ⌃2 is also bound to Ledger",
      "Default · macOS · Global · Open Marasi Menu: The Marasi menu must have a binding",
    ],
    "the variant on screen comes first",
  );
});

test("reusing a key in mutually exclusive states is neither a save problem nor a conflict", () => {
  const draft = addBinding(catalog, factoryDraft(), search, "meta+e");
  assert.deepEqual(saveProblems(catalog, draft), []);
  const result = browse({ catalog, profile: draft.profiles[0], platform: MACOS });
  assert.equal(rowOf(result, "ledger.drawer-closed.focus-query").status, "");
  assert.equal(rowOf(result, "ledger.drawer-open.close").status, "");
});

test("save problems include profile names and the active profile, as the backend checks them", () => {
  const draft = factoryDraft();
  const renamed = { ...draft, profiles: draft.profiles.map((p) => (p.id === "other" ? { ...p, name: " default " } : p)) };
  assert.deepEqual(saveProblems(catalog, renamed), [
    { profileId: "other", platform: null, groupId: null, actionId: null, message: "Profile name \"default\" is used twice" },
  ]);
  const blank = { ...draft, profiles: draft.profiles.map((p) => (p.id === "other" ? { ...p, name: "  " } : p)) };
  assert.deepEqual(saveProblems(catalog, blank).map((p) => p.message), ["A profile has no name"]);
  assert.deepEqual(saveProblems(catalog, { ...draft, activeProfile: "gone" }).map((p) => p.message), ["The active profile does not exist"]);
});

test("pagesOf groups page/state entries under one page, in order, with summed counts", () => {
  const groups = [
    { id: "global", page: "Global", state: "Every page", actionCount: 19, unboundCount: 0, conflictCount: 0 },
    { id: "websocket", page: "WebSocket", state: "Every tab", actionCount: 3, unboundCount: 1, conflictCount: 0 },
    { id: "websocket.stream", page: "WebSocket", state: "Stream tab", actionCount: 5, unboundCount: 0, conflictCount: 2 },
    { id: "ledger.drawer-closed", page: "Ledger", state: "Drawer closed", actionCount: 6, unboundCount: 0, conflictCount: 0 },
  ];
  const pages = pagesOf(groups);
  assert.deepEqual(pages.map((p) => p.page), ["Global", "WebSocket", "Ledger"]);
  const websocket = pages[1];
  assert.deepEqual(websocket.groups.map((g) => g.state), ["Every tab", "Stream tab"]);
  assert.deepEqual(
    { actionCount: websocket.actionCount, unboundCount: websocket.unboundCount, conflictCount: websocket.conflictCount },
    { actionCount: 8, unboundCount: 1, conflictCount: 2 },
  );
});

// Menu letters, against fixture groups so the tests hold whatever groups the
// factory catalog has: four global groups.
const letterCatalog = createCatalog(actions, {
  contexts,
  groups: [
    ["go", "Go to", "G"],
    ["project", "Project", "P"],
    ["browser", "Browser & proxy", "B"],
    ["appearance", "Appearance", "A"],
  ].map(([id, label, letter]) => ({ context: "global", id, label, letter, icon: "Eye", tone: "sky", description: label })),
});
const goTo = { profileId: "default", groupId: "global.go" };
const letterOf = (draft, groupId, profileId = "default") => menuLetters(letterCatalog, draft.profiles.find((p) => p.id === profileId))[groupId];

test("a group's letter is set per profile, and setting the factory letter again is no customization", () => {
  const opened = factoryDraft();
  const moved = setGroupLetter(letterCatalog, opened, goTo, "X");
  assert.equal(letterOf(moved, "global.go"), "X");
  assert.equal(letterOf(moved, "global.project"), "P");
  assert.deepEqual(moved.profiles[0].letters, [{ group: "global.go", letter: "X" }]);
  assert.equal(isDirty(moved, opened), true);
  const back = setGroupLetter(letterCatalog, moved, goTo, "G");
  assert.deepEqual(back.profiles[0].letters, []);
  assert.equal(isDirty(back, opened), false);
  assert.deepEqual(opened.profiles[0].letters ?? [], [], "the draft as opened is untouched");
});

test("reset restores the factory letters: one group, or every group of the profile, keeping dormant overrides", () => {
  let draft = setGroupLetter(letterCatalog, factoryDraft(), goTo, "X");
  draft = setGroupLetter(letterCatalog, draft, { profileId: "default", groupId: "global.project" }, "Y");
  draft = setGroupLetter(letterCatalog, draft, { profileId: "default", groupId: "compass.filters" }, "F");
  const one = resetGroupLetter(draft, goTo);
  assert.equal(letterOf(one, "global.go"), "G");
  assert.equal(letterOf(one, "global.project"), "Y");
  const all = resetGroupLetters(letterCatalog, draft, "default");
  assert.equal(letterOf(all, "global.go"), "G");
  assert.equal(letterOf(all, "global.project"), "P");
  assert.deepEqual(all.profiles[0].letters, [{ group: "compass.filters", letter: "F" }]);
});

test("a letter clash blocks saving, names both groups, and points at the first one", () => {
  const draft = setGroupLetter(letterCatalog, factoryDraft(), goTo, "P");
  assert.deepEqual(saveProblems(letterCatalog, draft, { profileId: "default", platform: MACOS }), [
    {
      profileId: "default",
      platform: null,
      groupId: "global",
      actionId: null,
      menuGroupId: "global.go",
      message: "Default · Go to (global) and Project (global) both use menu letter P",
    },
  ]);
});

test("a reserved or non-letter menu letter blocks saving", () => {
  const reserved = setGroupLetter(letterCatalog, factoryDraft(), goTo, "K");
  assert.deepEqual(
    saveProblems(letterCatalog, reserved).map((p) => p.message),
    ["Default · Go to (global): menu letter K is reserved; K, Q and H are never menu letters"],
  );
  const digit = setGroupLetter(letterCatalog, factoryDraft(), goTo, "7");
  assert.deepEqual(saveProblems(letterCatalog, digit).map((p) => p.message), ['Default · Go to (global): menu letter "7" is not a single letter A–Z']);
});

test("saving sends the letters with the catalog's groups, and the live menu letters follow", async () => {
  const draft = setGroupLetter(letterCatalog, factoryDraft(), goTo, "X");
  const live = createDispatcher({ catalog: letterCatalog, platform: MACOS });
  let sent;
  const result = await saveDraft({
    draft,
    catalog: letterCatalog,
    save: async (config, descriptor) => {
      sent = { config, descriptor };
      return { config, problem: "" };
    },
    apply: (state) => live.configure({ keybindings: state }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.config.profiles[0].letters, [{ group: "global.go", letter: "X" }]);
  assert.deepEqual(sent.descriptor.groups.map((g) => [g.id, g.letter]), [
    ["global.go", "G"],
    ["global.project", "P"],
    ["global.browser", "B"],
    ["global.appearance", "A"],
  ]);
  let seen;
  live.subscribe((snapshot) => (seen = snapshot));
  assert.deepEqual(seen.letters, { "global.go": "X" });
});

// A page's groups beside the global ones, so a page group can clash with a
// global group at its menu level.
const pageLetterCatalog = createCatalog(actions, {
  contexts,
  groups: [
    ["global", "go", "Go to", "G", "Navigation"],
    ["global", "project", "Project", "P", "FolderOpen"],
    ["ledger.drawer-open", "copy", "Copy", "C", "Copy"],
    ["ledger.drawer-open", "view", "View", "V", "Eye"],
    ["ledger.drawer-closed", "focus", "Focus", "F", "Crosshair"],
  ].map(([context, id, label, letter, icon]) => ({ context, id, label, letter, icon, tone: "sky", description: `${label} things` })),
});
const copyGroup = { profileId: "default", groupId: "ledger.drawer-open.copy" };
const menuGroupsOf = (draft, entryId) =>
  browse({ catalog: pageLetterCatalog, profile: draft.profiles[0], platform: MACOS }).groups.find((g) => g.id === entryId).menuGroups;
const lettersShown = (rows) => rows.map((row) => [row.id, row.group.label, row.group.icon, row.letter, row.resettable, row.status]);

test("each sidebar entry lists its context's menu groups with their letters, and the global entry the global groups", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "X");
  assert.deepEqual(lettersShown(menuGroupsOf(draft, "global")), [
    ["global.go", "Go to", "Navigation", "G", false, ""],
    ["global.project", "Project", "FolderOpen", "P", false, ""],
  ]);
  assert.deepEqual(lettersShown(menuGroupsOf(draft, "ledger.drawer-open")), [
    ["ledger.drawer-open.copy", "Copy", "Copy", "X", true, ""],
    ["ledger.drawer-open.view", "View", "Eye", "V", false, ""],
  ]);
  assert.deepEqual(lettersShown(menuGroupsOf(draft, "ledger.drawer-closed")), [["ledger.drawer-closed.focus", "Focus", "Crosshair", "F", false, ""]]);
  assert.equal(menuGroupsOf(draft, "ledger.drawer-open")[0].factoryLetter, "C");
});

// ⌥ (Alt) + a group's letter opens it in the menu, so an action bound to it
// in the same menu is a conflict on both rows, like two actions sharing a key.
test("an action bound to a group's ⌥ letter is a conflict on the action's row and the group's, and blocks saving", () => {
  const close = { profileId: "default", platform: MACOS, actionId: "ledger.drawer-open.close" };
  const draft = addBinding(pageLetterCatalog, factoryDraft(), close, "alt+c");
  const view = browse({ catalog: pageLetterCatalog, profile: draft.profiles[0], platform: MACOS });
  const entry = view.groups.find((g) => g.id === "ledger.drawer-open");
  const copy = entry.menuGroups.find((row) => row.id === "ledger.drawer-open.copy");
  const row = entry.all.find((r) => r.action.id === "ledger.drawer-open.close");
  assert.deepEqual([copy.status, copy.problem], ["conflict", "⌥C is Close's shortcut"]);
  assert.deepEqual([row.status, row.problem], ["conflict", "⌥C opens the Copy menu group; change one of them"]);
  assert.equal(entry.conflictCount, 2);
  assert.deepEqual(
    saveProblems(pageLetterCatalog, draft, { profileId: "default", platform: MACOS }).map((p) => p.message),
    ["Default · macOS · Ledger · Drawer open · Close: ⌥C opens the Copy menu group; change one of them"],
  );
  // The other platform's view of the group is clean.
  const windows = browse({ catalog: pageLetterCatalog, profile: draft.profiles[0], platform: WINDOWS_LINUX });
  assert.equal(windows.groups.find((g) => g.id === "ledger.drawer-open").menuGroups[0].status, "");
});

test("a global group's ⌥ letter names the page on the group's row and Marasi on the action's", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), { profileId: "default", groupId: "global.project" }, "E");
  const close = { profileId: "default", platform: MACOS, actionId: "ledger.drawer-open.close" };
  const taken = addBinding(pageLetterCatalog, draft, close, "alt+e");
  const view = browse({ catalog: pageLetterCatalog, profile: taken.profiles[0], platform: MACOS });
  const project = view.groups.find((g) => g.id === "global").menuGroups.find((r) => r.id === "global.project");
  const row = view.groups.find((g) => g.id === "ledger.drawer-open").all.find((r) => r.action.id === "ledger.drawer-open.close");
  assert.equal(project.problem, "⌥E is Close's shortcut in Ledger · Drawer open");
  assert.equal(row.problem, "⌥E opens the Project menu group in Marasi; change one of them");
});

test("recording a group letter takes one letter key, waits through modifiers, and Esc cancels", () => {
  assert.deepEqual(captureLetter(keydown("x", "KeyX")), { type: "letter", letter: "X" });
  assert.deepEqual(captureLetter(keydown("X", "KeyX", { shiftKey: true })), { type: "letter", letter: "X" });
  assert.deepEqual(captureLetter(keydown("k", "KeyK")), { type: "letter", letter: "K" }, "a reserved letter is recorded, and shown as a conflict");
  assert.deepEqual(captureLetter(keydown("Escape", "Escape")), { type: "cancel" });
  assert.equal(captureLetter(keydown("Meta", "MetaLeft", { metaKey: true })), null);
  assert.equal(captureLetter(keydown("x", "KeyX", { repeat: true })), null);
  assert.equal(captureLetter(keydown("x", "KeyX", { isComposing: true })), null);
  for (const event of [keydown("x", "KeyX", { metaKey: true }), keydown("7", "Digit7"), keydown("F5", "F5"), keydown("Enter", "Enter")]) {
    assert.deepEqual(captureLetter(event), { type: "refused" });
  }
});

const conflictsShown = (rows) => rows.filter((row) => row.status === "conflict").map((row) => [row.id, row.problem]);

test("a duplicate letter shows on both groups, naming the other one, and blocks saving", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "V");
  assert.deepEqual(conflictsShown(menuGroupsOf(draft, "ledger.drawer-open")), [
    ["ledger.drawer-open.copy", "V is also used by View"],
    ["ledger.drawer-open.view", "V is also used by Copy"],
  ]);
  assert.equal(saveProblems(pageLetterCatalog, draft).length, 1);
});

test("a page group using a global group's letter names the global group in the Marasi section, and vice versa", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "G");
  assert.deepEqual(conflictsShown(menuGroupsOf(draft, "ledger.drawer-open")), [["ledger.drawer-open.copy", "G is also used by Go to in Marasi"]]);
  assert.deepEqual(conflictsShown(menuGroupsOf(draft, "global")), [["global.go", "G is also used by Copy in Ledger · Drawer open"]]);
  assert.deepEqual(conflictsShown(menuGroupsOf(draft, "ledger.drawer-closed")), []);
});

test("a reserved letter shows as a conflict on its group", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "K");
  assert.deepEqual(conflictsShown(menuGroupsOf(draft, "ledger.drawer-open")), [
    ["ledger.drawer-open.copy", "K is reserved; K, Q and H are never menu letters"],
  ]);
  assert.equal(menuGroupsOf(draft, "ledger.drawer-open")[0].letter, "K");
  assert.deepEqual(saveProblems(pageLetterCatalog, draft).map((p) => [p.groupId, p.menuGroupId]), [["ledger.drawer-open", "ledger.drawer-open.copy"]]);
});

test("resetting a profile's platform also returns its letters to the factory letters", () => {
  const variant = { profileId: "default", platform: MACOS };
  const moved = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "X");
  assert.equal(isProfileCustomized(pageLetterCatalog, moved, variant), true, "a changed letter alone makes Reset available");
  assert.equal(isProfileCustomized(pageLetterCatalog, moved, { profileId: "other", platform: MACOS }), false);
  const reset = resetProfile(pageLetterCatalog, moved, variant);
  assert.equal(menuGroupsOf(reset, "ledger.drawer-open")[0].letter, "C");
  assert.equal(isProfileCustomized(pageLetterCatalog, reset, variant), false);
  const rebound = addBinding(pageLetterCatalog, factoryDraft(), home, "meta+j");
  assert.equal(isProfileCustomized(pageLetterCatalog, rebound, variant), true);
  assert.deepEqual(actionBindings(pageLetterCatalog, resetProfile(pageLetterCatalog, rebound, variant).profiles[0], MACOS, "global.go-home"), ["meta+1"]);
});

test("group rows follow the search and filters, and a letter conflict counts in its entry", () => {
  const draft = setGroupLetter(pageLetterCatalog, factoryDraft(), copyGroup, "V");
  const view = (query, filter) =>
    browse({ catalog: pageLetterCatalog, profile: draft.profiles[0], platform: MACOS, query, filter }).groups.find((g) => g.id === "ledger.drawer-open");
  assert.deepEqual(view("", "all").menuItems.map((row) => row.id), ["ledger.drawer-open.copy", "ledger.drawer-open.view"]);
  assert.deepEqual(view("copy", "all").menuItems.map((row) => row.id), ["ledger.drawer-open.copy"]);
  assert.deepEqual(view("", "unbound").menuItems, []);
  assert.deepEqual(view("", "conflict").menuItems.map((row) => row.id), ["ledger.drawer-open.copy", "ledger.drawer-open.view"]);
  assert.equal(view("", "all").conflictCount, 2);
  assert.equal(browse({ catalog: pageLetterCatalog, profile: draft.profiles[0], platform: MACOS }).conflictCount, 2);
});
