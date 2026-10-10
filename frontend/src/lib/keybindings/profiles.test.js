import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import {
  catalogDescriptor,
  factoryKeybindings,
  settleProfile,
  validateKeybindings,
} from "./profiles.js";

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
