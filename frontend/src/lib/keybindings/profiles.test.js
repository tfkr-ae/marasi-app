import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import {
  activeProfile,
  catalogDescriptor,
  factoryKeybindings,
  factoryProfile,
  profileKeymap,
  settleProfile,
} from "./profiles.js";
import { validateKeybindings } from "./testing.js";

// Ledger's drawer-open and drawer-closed contexts are mutually exclusive; the
// WebSocket drawer context is eligible together with drawer-open, in the same
// tier, so it declares the overlap.
const drawerOpen = (s) => s.route === "/ledger" && Boolean(s.drawer?.open);
const contexts = [
  { id: "global", tier: "global", label: "Global", isEligible: () => true },
  { id: "ledger.drawer-closed", tier: "page", label: "Ledger", isEligible: (s) => s.route === "/ledger" && !s.drawer?.open },
  { id: "ledger.drawer-open.websocket", tier: "drawer", label: "WebSocket", overlaps: ["ledger.drawer-open"], isEligible: (s) => drawerOpen(s) && s.drawer.websocket },
  { id: "ledger.drawer-open", tier: "drawer", label: "Ledger drawer", isEligible: drawerOpen },
];

function both(mac, other) {
  return { [MACOS]: [mac], [WINDOWS_LINUX]: [other] };
}

const baseActions = [
  { id: "global.open-menu", context: "global", label: "Menu", defaults: both("meta+k", "ctrl+k") },
  { id: "global.go-home", context: "global", label: "Home", defaults: both("meta+1", "ctrl+1") },
  { id: "global.go-ledger", context: "global", label: "Ledger", defaults: both("meta+2", "ctrl+2") },
  { id: "ledger.drawer-closed.open-item", context: "ledger.drawer-closed", label: "Open", defaults: both("meta+e", "ctrl+e") },
  { id: "ledger.drawer-open.close", context: "ledger.drawer-open", label: "Close", defaults: both("meta+e", "ctrl+e") },
  { id: "ledger.drawer-open.websocket.stream", context: "ledger.drawer-open.websocket", label: "Stream", defaults: both("meta+shift+o", "ctrl+shift+o") },
];
const catalog = createCatalog(baseActions, { contexts });
const knownIds = baseActions.map((action) => action.id).sort();

function profile(id, name, overrides = {}, knownActions = knownIds) {
  return {
    id,
    name,
    overrides: { [MACOS]: [], [WINDOWS_LINUX]: [], ...overrides },
    knownActions,
  };
}

function saved(profiles, activeProfile = profiles[0].id) {
  return { config: { version: 1, activeProfile, profiles }, problem: "" };
}

function keydown(key, mods = {}) {
  return {
    key,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: "BODY" },
    preventDefault() {},
    stopImmediatePropagation() {},
    ...mods,
  };
}

const home = { route: "/", modal: null, dialogOpen: false };
const meta = (key) => keydown(key, { metaKey: true });
const ctrl = (key) => keydown(key, { ctrlKey: true });

const customized = saved(
  [
    profile("default", "Default"),
    profile("vim-ish", "Vim-ish", {
      [MACOS]: [
        { action: "global.go-home", keys: ["meta+h", "Meta+Shift+H"] },
        { action: "global.go-ledger", keys: [] },
        { action: "extension.gone.do-thing", keys: ["meta+2"] },
      ],
      [WINDOWS_LINUX]: [{ action: "global.go-home", keys: ["ctrl+h"] }],
    }),
  ],
  "vim-ish",
);

test("the active profile's current-platform overrides replace factory defaults", () => {
  const mac = createDispatcher({ catalog, platform: MACOS, keybindings: customized });
  assert.equal(mac.resolve(meta("h"), home), "global.go-home");
  assert.equal(mac.resolve(keydown("H", { metaKey: true, shiftKey: true }), home), "global.go-home");
  assert.equal(mac.resolve(meta("1"), home), null, "the replaced default no longer fires");
  assert.deepEqual(mac.bindingsFor("global.go-ledger"), [], "an empty list is intentionally unbound");
  assert.equal(mac.resolve(meta("2"), home), null, "a dormant override never executes");
  assert.deepEqual(mac.bindingsFor("ledger.drawer-closed.open-item"), ["meta+e"], "no override inherits");
});

test("the other platform variant resolves independently", () => {
  const win = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings: customized });
  assert.equal(win.resolve(ctrl("h"), home), "global.go-home");
  assert.equal(win.resolve(ctrl("2"), home), "global.go-ledger", "unbound on macOS only");
  assert.equal(win.resolve(meta("h"), home), null);
});

test("only the active profile is live", () => {
  const inactive = { ...customized, config: { ...customized.config, activeProfile: "default" } };
  const mac = createDispatcher({ catalog, platform: MACOS, keybindings: inactive });
  assert.equal(mac.resolve(meta("1"), home), "global.go-home");
  assert.equal(mac.resolve(meta("h"), home), null);
});

test("a new action inherits a free default but stays unbound when its default collides with a customization", () => {
  const newer = createCatalog(
    [
      ...baseActions,
      { id: "global.go-new", context: "global", label: "New", defaults: both("meta+j", "ctrl+j") },
      { id: "ledger.drawer-open.new", context: "ledger.drawer-open", label: "New drawer", defaults: both("meta+m", "ctrl+9") },
      { id: "global.go-free", context: "global", label: "Free", defaults: both("meta+9", "ctrl+8") },
    ],
    { contexts },
  );
  const state = saved([
    profile("default", "Default", {
      [MACOS]: [
        { action: "global.go-home", keys: ["meta+j"] },
        { action: "global.open-menu", keys: ["meta+m"] },
      ],
    }),
  ]);
  const mac = createDispatcher({ catalog: newer, platform: MACOS, keybindings: state });
  assert.deepEqual(mac.bindingsFor("global.go-new"), []);
  assert.deepEqual(mac.bindingsFor("ledger.drawer-open.new"), [], "it would shadow the menu opening");
  assert.deepEqual(mac.bindingsFor("global.go-free"), ["meta+9"]);
  assert.equal(mac.resolve(meta("j"), home), "global.go-home", "the customization wins");
  const win = createDispatcher({ catalog: newer, platform: WINDOWS_LINUX, keybindings: state });
  assert.deepEqual(win.bindingsFor("global.go-new"), ["ctrl+j"], "no customization collides on this variant");
  assert.deepEqual(validateKeybindings(newer, state.config), []);
});

test("settling a profile records the new-default decision and the known actions", () => {
  const newer = createCatalog(
    [...baseActions, { id: "global.go-new", context: "global", label: "New", defaults: both("meta+j", "ctrl+j") }],
    { contexts },
  );
  const before = profile("default", "Default", { [MACOS]: [{ action: "global.go-home", keys: ["meta+j"] }] }, [
    ...knownIds,
    "extension.gone.do-thing",
  ]);
  const after = settleProfile(newer, before);
  assert.deepEqual(after.overrides[MACOS], [
    { action: "global.go-home", keys: ["meta+j"] },
    { action: "global.go-new", keys: [] },
  ]);
  assert.deepEqual(after.overrides[WINDOWS_LINUX], []);
  assert.deepEqual(after.knownActions, [...knownIds, "extension.gone.do-thing", "global.go-new"].sort());
  assert.deepEqual(before.knownActions.includes("global.go-new"), false, "the input is not mutated");
});

test("validation rejects unbound or shadowed menu opening, same-context duplicates and reserved keys", () => {
  const config = {
    version: 1,
    activeProfile: "a",
    profiles: [
      profile("a", "A", {
        [MACOS]: [{ action: "global.open-menu", keys: [] }],
        [WINDOWS_LINUX]: [{ action: "ledger.drawer-open.close", keys: ["ctrl+k"] }],
      }),
      profile("b", "B", {
        [MACOS]: [
          { action: "global.go-home", keys: ["meta+2"] },
          { action: "ledger.drawer-closed.open-item", keys: ["escape"] },
        ],
      }),
    ],
  };
  const problems = validateKeybindings(catalog, config).map(({ profileId, platform, kind, actions }) => ({
    profileId,
    platform,
    kind,
    actions,
  }));
  assert.deepEqual(problems, [
    { profileId: "a", platform: MACOS, kind: "menu-unbound", actions: ["global.open-menu"] },
    { profileId: "a", platform: WINDOWS_LINUX, kind: "menu-shadowed", actions: ["global.open-menu", "ledger.drawer-open.close"] },
    { profileId: "b", platform: MACOS, kind: "reserved", actions: ["ledger.drawer-closed.open-item"] },
    { profileId: "b", platform: MACOS, kind: "duplicate", actions: ["global.go-home", "global.go-ledger"] },
  ]);
});

test("reusing a binding in mutually exclusive contexts is valid", () => {
  const config = saved([
    profile("a", "A", {
      [MACOS]: [
        { action: "ledger.drawer-closed.open-item", keys: ["meta+j"] },
        { action: "ledger.drawer-open.close", keys: ["meta+j"] },
      ],
    }),
  ]).config;
  assert.deepEqual(validateKeybindings(catalog, config), []);
});

test("sharing a binding with an overlapping context is a duplicate", () => {
  const config = saved([
    profile("a", "A", { [MACOS]: [{ action: "ledger.drawer-open.websocket.stream", keys: ["meta+e"] }] }),
  ]).config;
  assert.deepEqual(
    validateKeybindings(catalog, config).map(({ kind, actions }) => ({ kind, actions })),
    [{ kind: "duplicate", actions: ["ledger.drawer-open.close", "ledger.drawer-open.websocket.stream"] }],
  );
});

test("a reported problem with the saved section falls back to factory shortcuts", () => {
  const dispatcher = createDispatcher({
    catalog,
    platform: MACOS,
    keybindings: { config: factoryKeybindings(), problem: "keybindings version 2 is not supported" },
  });
  assert.equal(dispatcher.resolve(meta("k"), home), "global.open-menu");
  let seen;
  dispatcher.subscribe((snapshot) => (seen = snapshot.problem));
  assert.equal(seen, "keybindings version 2 is not supported");
});

test("a hand-edited active variant that strands the menu falls back to factory shortcuts", () => {
  const stranded = saved([profile("a", "A", { [MACOS]: [{ action: "global.open-menu", keys: [] }] })]);
  const mac = createDispatcher({ catalog, platform: MACOS, keybindings: stranded });
  assert.equal(mac.resolve(meta("k"), home), "global.open-menu");
  let problem;
  mac.subscribe((snapshot) => (problem = snapshot.problem));
  assert.match(problem, /menu opening/);
  const win = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings: stranded });
  let winProblem;
  win.subscribe((snapshot) => (winProblem = snapshot.problem));
  assert.equal(winProblem, "", "the other variant is not this platform's problem");
});

test("the catalog descriptor carries what the backend validates", () => {
  const descriptor = catalogDescriptor(catalog);
  assert.deepEqual(descriptor.actions[3], {
    id: "ledger.drawer-closed.open-item",
    context: "ledger.drawer-closed",
    defaults: { [MACOS]: ["meta+e"], [WINDOWS_LINUX]: ["ctrl+e"] },
    positionalDefault: false,
  });
  assert.deepEqual(descriptor.contexts[2], { id: "ledger.drawer-open.websocket", overlaps: ["ledger.drawer-open"] });
  assert.deepEqual(descriptor.contexts[0], { id: "global", overlaps: [] });
});

test("the factory profile is valid against the app catalog", () => {
  const app = buildCatalog({ extensions: [{ Name: "workshop" }, { Name: "fuzzer" }, { Name: "notes" }] });
  assert.deepEqual(validateKeybindings(app, factoryKeybindings()), []);
});

test("the app's WebSocket drawer context overlaps the Ledger drawer", () => {
  const { contexts: described } = catalogDescriptor(buildCatalog());
  const websocket = described.find((context) => context.id === "ledger.drawer-open.websocket");
  assert.deepEqual(websocket.overlaps, ["ledger.drawer-open"]);
});

// Extension navigation defaults (⌘⌥1–9) follow the extension load order, so
// they move when extensions are reordered. A customization stores the full
// key list and can keep an old positional default; the moved default yields.
const altMeta = (key) => keydown(key, { metaKey: true, altKey: true });
const beforeReorder = buildCatalog({ extensions: [{ Name: "first" }, { Name: "alpha" }, { Name: "beta" }] });
const reordered = buildCatalog({ extensions: [{ Name: "first" }, { Name: "beta" }, { Name: "alpha" }] });
const customizedAlpha = saved([
  {
    ...settleProfile(beforeReorder, factoryProfile("mine", "Mine")),
    overrides: {
      [MACOS]: [{ action: "global.open-extension.alpha", keys: ["meta+alt+2", "meta+alt+8"] }],
      [WINDOWS_LINUX]: [],
    },
  },
]);

test("after a reorder, a moved extension default that collides with a customization is unbound and the profile stays live", () => {
  const mac = createDispatcher({ catalog: reordered, platform: MACOS, keybindings: customizedAlpha });
  assert.deepEqual(mac.bindingsFor("global.open-extension.alpha"), ["meta+alt+2", "meta+alt+8"]);
  assert.deepEqual(mac.bindingsFor("global.open-extension.beta"), [], "beta's new ⌘⌥2 yields");
  assert.deepEqual(mac.bindingsFor("global.open-extension.first"), ["meta+alt+1"]);
  assert.equal(mac.resolve(altMeta("2"), home), "global.open-extension.alpha");
  let problem;
  mac.subscribe((snapshot) => (problem = snapshot.problem));
  assert.equal(problem, "", "no fallback to factory shortcuts");
  assert.deepEqual(validateKeybindings(reordered, customizedAlpha.config), []);
});

test("the catalog descriptor marks positional defaults for the backend", () => {
  const { actions } = catalogDescriptor(reordered);
  const flag = (id) => actions.find((action) => action.id === id).positionalDefault;
  assert.equal(flag("global.open-extension.beta"), true);
  assert.equal(flag("global.go-home"), false);
});

test("settling does not record a yielded positional default, so freeing the binding restores it", () => {
  const settled = settleProfile(reordered, activeProfile(customizedAlpha.config));
  assert.deepEqual(settled.overrides[MACOS], [
    { action: "global.open-extension.alpha", keys: ["meta+alt+2", "meta+alt+8"] },
  ]);
  const freed = { ...settled, overrides: { ...settled.overrides, [MACOS]: [{ action: "global.open-extension.alpha", keys: ["meta+alt+8"] }] } };
  assert.deepEqual(profileKeymap(reordered, freed, MACOS).bindingsFor("global.open-extension.beta"), ["meta+alt+2"]);
});

test("a customization that takes a stable default is still a duplicate", () => {
  const config = saved([
    profile(
      "a",
      "A",
      { [MACOS]: [{ action: "global.open-extension.alpha", keys: ["meta+1"] }] },
      reordered.actions.map((action) => action.id),
    ),
  ]).config;
  assert.deepEqual(
    validateKeybindings(reordered, config).map(({ kind, actions }) => ({ kind, actions })),
    [{ kind: "duplicate", actions: ["global.go-home", "global.open-extension.alpha"] }],
  );
});

// Menu letters. The catalog's groups are fixtures here, so the rules hold for
// whatever groups the factory catalog has: two global groups, two in the
// Ledger drawer, one in the WebSocket drawer and one with the drawer closed.
function menuGroup(context, id, label, letter) {
  return { context, id, label, letter, icon: "Eye", tone: "sky", description: label };
}
const letterGroups = [
  menuGroup("global", "go", "Go to", "G"),
  menuGroup("global", "project", "Project", "P"),
  menuGroup("ledger.drawer-open", "copy", "Copy", "C"),
  menuGroup("ledger.drawer-open", "send", "Send", "S"),
  menuGroup("ledger.drawer-open.websocket", "frames", "Frames", "F"),
  menuGroup("ledger.drawer-closed", "view", "View", "V"),
];
const groupedCatalog = createCatalog(baseActions, { contexts, groups: letterGroups });

function withLetters(letters) {
  return { ...profile("work", "Work"), letters: Object.entries(letters).map(([group, letter]) => ({ group, letter })) };
}

const letterMessages = (letters) => validateKeybindings(groupedCatalog, saved([withLetters(letters)]).config).map((p) => p.message);

test("a page group may not take a global group's menu letter, and the refusal names both groups", () => {
  assert.deepEqual(letterMessages({ "ledger.drawer-open.copy": "G" }), [
    "Work: Go to (global) and Copy (ledger.drawer-open) both use menu letter G",
  ]);
});

test("two groups of one page context, or two global groups, may not share a menu letter; each clash is reported once", () => {
  assert.deepEqual(letterMessages({ "ledger.drawer-open.send": "C", "global.project": "G" }), [
    "Work: Go to (global) and Project (global) both use menu letter G",
    "Work: Copy (ledger.drawer-open) and Send (ledger.drawer-open) both use menu letter C",
  ]);
});

test("groups in different page contexts may share a menu letter, and a moved letter frees the factory one", () => {
  assert.deepEqual(letterMessages({ "ledger.drawer-closed.view": "C", "ledger.drawer-open.websocket.frames": "V" }), []);
  assert.deepEqual(letterMessages({ "global.go": "X", "ledger.drawer-open.copy": "G" }), []);
});

// The WebSocket drawer overlaps the Ledger drawer, so both share one menu.
test("groups in overlapping contexts are one menu level and may not share a menu letter", () => {
  assert.deepEqual(letterMessages({ "ledger.drawer-open.websocket.frames": "S" }), [
    "Work: Send (ledger.drawer-open) and Frames (ledger.drawer-open.websocket) both use menu letter S",
  ]);
});

test("the Launchpad tree's Entries shares the Launchpad's menu, so it may not take Launch's letter", () => {
  const app = buildCatalog();
  const work = { ...factoryProfile("work", "Work"), knownActions: app.actions.map((a) => a.id), letters: [{ group: "launchpad.tree.entries", letter: "L" }] };
  assert.deepEqual(
    validateKeybindings(app, saved([work]).config).map((p) => p.message),
    ["Work: Launch (launchpad) and Entries (launchpad.tree) both use menu letter L"],
  );
});

test("a menu letter must be one capital letter A–Z", () => {
  for (const letter of ["1", "", "XY", "x", "É", "⌘"]) {
    assert.deepEqual(letterMessages({ "global.go": letter }), [`Work: Go to (global): menu letter ${JSON.stringify(letter)} is not a single letter A–Z`], letter);
  }
});

test("K, Q and H are never menu letters, on either platform", () => {
  for (const letter of ["K", "Q", "H"]) {
    const problems = validateKeybindings(groupedCatalog, saved([withLetters({ "ledger.drawer-open.copy": letter })]).config);
    assert.deepEqual(
      problems.map((p) => [p.platform, p.message]),
      [[null, `Work: Copy (ledger.drawer-open): menu letter ${letter} is reserved; K, Q and H are never menu letters`]],
    );
  }
});

test("a menu group's letter may be given only once", () => {
  const work = { ...profile("work", "Work"), letters: [{ group: "global.go", letter: "X" }, { group: "global.go", letter: "Y" }] };
  assert.deepEqual(
    validateKeybindings(groupedCatalog, saved([work]).config).map((p) => p.message),
    ["Work: Go to (global): menu letter given twice"],
  );
});

test("a letter override for a group this build lacks is kept dormant, but must still be a usable letter", () => {
  assert.deepEqual(letterMessages({ "compass.filters": "G" }), []);
  assert.deepEqual(letterMessages({ "compass.filters": "Q" }), [
    "Work: compass.filters: menu letter Q is reserved; K, Q and H are never menu letters",
  ]);
});

test("the menu follows the active profile's letters, and changes with the saved profile without a reload", () => {
  const dispatcher = createDispatcher({ catalog: groupedCatalog, platform: MACOS });
  let seen;
  dispatcher.subscribe((snapshot) => (seen = snapshot));
  assert.deepEqual(seen.letters, {});
  dispatcher.configure({ keybindings: saved([withLetters({ "global.go": "X" })]) });
  assert.deepEqual(seen.letters, { "global.go": "X" });
  assert.equal(seen.problem, "");
  dispatcher.configure({ keybindings: saved([withLetters({})]) });
  assert.deepEqual(seen.letters, {});
});

// The ADR's rule for a new default: the researcher's saved letter wins on
// load, and the menu gives the clashing factory group a derived key. A save
// that creates the clash is still refused (above).
test("a saved letter that clashes with a factory letter keeps the profile live, bindings and letter included", () => {
  const dispatcher = createDispatcher({ catalog: groupedCatalog, platform: WINDOWS_LINUX });
  let seen;
  dispatcher.subscribe((snapshot) => (seen = snapshot));
  const work = { ...withLetters({ "global.go": "P" }), overrides: { [MACOS]: [], [WINDOWS_LINUX]: [{ action: "global.go-home", keys: ["ctrl+j"] }] } };
  dispatcher.configure({ keybindings: saved([work]) });
  assert.equal(seen.problem, "");
  assert.deepEqual(seen.letters, { "global.go": "P" });
  assert.deepEqual(seen.bindingsFor("global.go-home"), ["ctrl+j"]);
});

test("a saved letter that can't be a menu letter is ignored on load, and the profile stays live", () => {
  const dispatcher = createDispatcher({ catalog: groupedCatalog, platform: MACOS });
  let seen;
  dispatcher.subscribe((snapshot) => (seen = snapshot));
  dispatcher.configure({ keybindings: saved([withLetters({ "global.go": "K", "global.project": "X" })]) });
  assert.equal(seen.problem, "");
  assert.deepEqual(seen.letters, { "global.project": "X" });
});

test("the catalog descriptor sent with a save lists every menu group with its factory letter", () => {
  assert.deepEqual(catalogDescriptor(groupedCatalog).groups, [
    { id: "global.go", context: "global", label: "Go to", letter: "G" },
    { id: "global.project", context: "global", label: "Project", letter: "P" },
    { id: "ledger.drawer-open.copy", context: "ledger.drawer-open", label: "Copy", letter: "C" },
    { id: "ledger.drawer-open.send", context: "ledger.drawer-open", label: "Send", letter: "S" },
    { id: "ledger.drawer-open.websocket.frames", context: "ledger.drawer-open.websocket", label: "Frames", letter: "F" },
    { id: "ledger.drawer-closed.view", context: "ledger.drawer-closed", label: "View", letter: "V" },
  ]);
});
