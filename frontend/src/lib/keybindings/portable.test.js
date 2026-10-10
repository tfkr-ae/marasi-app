import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, createCatalog } from "./catalog.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import { factoryProfile, profileKeymap, settleProfile } from "./profiles.js";
import { exportBlocker, exportFileName, exportProfile, importProfile } from "./portable.js";

// Exporting a keybinding profile to a portable file and importing it back
// into the settings draft (docs/keybinding-profile-format.md).

const contexts = [
  { id: "global", tier: "global", label: "Global", page: "Global", state: "Every page", isEligible: () => true },
  { id: "ledger.drawer-open", tier: "drawer", label: "Ledger drawer", page: "Ledger", state: "Drawer open", isEligible: () => false },
];

function both(mac, other) {
  return { [MACOS]: [mac], [WINDOWS_LINUX]: [other] };
}

const actions = [
  { id: "global.open-menu", context: "global", label: "Open Marasi Menu", defaults: both("meta+k", "ctrl+k") },
  { id: "global.go-home", context: "global", label: "Marasi", defaults: both("meta+1", "ctrl+1") },
  { id: "global.go-ledger", context: "global", label: "Ledger", defaults: both("meta+2", "ctrl+2") },
  { id: "ledger.drawer-open.close", context: "ledger.drawer-open", label: "Close", defaults: both("meta+e", "ctrl+e") },
];
const catalog = createCatalog(actions, { contexts });
const allIds = actions.map((a) => a.id).sort();

function profile(id, name, overrides = {}, knownActions = allIds) {
  return { id, name, overrides: { [MACOS]: [], [WINDOWS_LINUX]: [], ...overrides }, knownActions };
}

// "Work": Home also on ⌘H on macOS, Ledger explicitly unbound on
// Windows/Linux, a dormant override for an extension this build lacks, and
// every other action inheriting its default.
const work = profile("work", "Work", {
  [MACOS]: [
    { action: "global.go-home", keys: ["meta+1", "meta+h"] },
    { action: "extension.gone.do-thing", keys: ["meta+alt+9"] },
  ],
  [WINDOWS_LINUX]: [{ action: "global.go-ledger", keys: [] }],
});

function draftOf(...profiles) {
  return { version: 1, activeProfile: profiles[0].id, profiles };
}

const resolved = (p, platform) => Object.fromEntries(actions.map((a) => [a.id, profileKeymap(catalog, p, platform).bindingsFor(a.id)]));

test("export then import round-trips both variants, unbinding, inheritance and dormant overrides", () => {
  const text = exportProfile(work);
  const draft = draftOf(profile("default", "Default"));

  const { draft: next, profileId } = importProfile(catalog, draft, text);

  const imported = next.profiles.find((p) => p.id === profileId);
  assert.equal(imported.name, "Work");
  assert.deepEqual(imported.overrides, work.overrides);
  assert.deepEqual(imported.knownActions, allIds);
  for (const platform of [MACOS, WINDOWS_LINUX]) assert.deepEqual(resolved(imported, platform), resolved(work, platform));
  assert.deepEqual(resolved(imported, MACOS)["global.go-ledger"], ["meta+2"]);
  assert.deepEqual(resolved(imported, WINDOWS_LINUX)["global.go-ledger"], []);
});

test("a name clash imports under a distinct name and new id, without overwriting or activating anything", () => {
  const existing = profile("work", " work ", { [MACOS]: [{ action: "global.go-ledger", keys: ["meta+l"] }] });
  const draft = draftOf(profile("default", "Default"), existing);
  const before = structuredClone(draft);

  const { draft: next, profileId, name } = importProfile(catalog, draft, exportProfile(work));

  assert.equal(name, "Work 2");
  assert.equal(profileId, "work-2");
  assert.equal(next.activeProfile, "default");
  assert.deepEqual(next.profiles.slice(0, 2), before.profiles);
  assert.deepEqual(next.profiles.map((p) => p.id), ["default", "work", "work-2"]);
  assert.deepEqual(draft, before);
});

// A valid file with `edit` applied to its parsed form.
function fileWith(edit) {
  const file = JSON.parse(exportProfile(work));
  edit(file);
  return JSON.stringify(file);
}

const rejected = [
  ["malformed JSON", "{ \"format\": ", /not valid JSON/],
  ["an empty file", "", /not valid JSON/],
  ["a JSON array", "[]", /not a Marasi keybinding profile/],
  ["another format", fileWith((f) => (f.format = "vscode-keybindings")), /not a Marasi keybinding profile/],
  ["a newer version", fileWith((f) => (f.version = 2)), /version 2 is not supported.*newer Marasi/],
  ["a missing version", fileWith((f) => delete f.version), /version .* invalid/],
  ["a fractional version", fileWith((f) => (f.version = 1.5)), /version 1\.5 is invalid/],
  ["a string version", fileWith((f) => (f.version = "1")), /version "1" is invalid/],
  ["an unknown top-level field", fileWith((f) => (f.profiles = [])), /unknown field "profiles"/],
  ["a missing profile", fileWith((f) => delete f.profile), /no profile/],
  ["an unknown profile field", fileWith((f) => (f.profile.id = "work")), /unknown field "id"/],
  ["an empty name", fileWith((f) => (f.profile.name = "  ")), /no name/],
  ["a non-string name", fileWith((f) => (f.profile.name = 7)), /no name/],
  ["an unknown platform", fileWith((f) => (f.profile.overrides.linux = [])), /unknown platform "linux"/],
  ["a variant that is not a list", fileWith((f) => (f.profile.overrides.macos = {})), /macOS.*not a list/],
  ["an override without keys", fileWith((f) => delete f.profile.overrides.macos[0].keys), /global\.go-home.*missing keys/],
  ["an override with an extra field", fileWith((f) => (f.profile.overrides.macos[0].when = "x")), /unknown field "when"/],
  ["keys that are not strings", fileWith((f) => (f.profile.overrides.macos[0].keys = [1])), /1 is not a binding/],
  ["an invalid action id", fileWith((f) => (f.profile.overrides.macos[0].action = "Go Home")), /"Go Home".*invalid action id/],
  ["an action overridden twice", fileWith((f) => f.profile.overrides.macos.push({ action: "global.go-home", keys: [] })), /global\.go-home.*overridden twice/],
  ["an unparseable binding", fileWith((f) => (f.profile.overrides.macos[0].keys = ["meta+banana"])), /"meta\+banana" is not a binding/],
  ["a reserved binding", fileWith((f) => (f.profile.overrides.macos[0].keys = ["shift+tab"])), /"shift\+tab" is reserved/],
  ["known actions that are not ids", fileWith((f) => (f.profile.knownActions = ["global.go-home", 3])), /known actions/],
  [
    "an unbound menu opening",
    fileWith((f) => f.profile.overrides.macos.push({ action: "global.open-menu", keys: [] })),
    /macOS: menu opening is unbound/,
  ],
  [
    "a collision inside the profile",
    fileWith((f) => (f.profile.overrides["windows-linux"] = [{ action: "global.go-home", keys: ["ctrl+2"] }])),
    /Windows \/ Linux: ctrl\+2 is bound to both/,
  ],
  [
    "a binding that shadows the menu opening",
    fileWith((f) => f.profile.overrides.macos.push({ action: "ledger.drawer-open.close", keys: ["meta+k"] })),
    /meta\+k opens the menu but ledger\.drawer-open\.close shadows it/,
  ],
];

for (const [what, text, message] of rejected) {
  test(`importing ${what} is rejected without touching the draft`, () => {
    const draft = draftOf(profile("default", "Default"), work);
    const before = structuredClone(draft);
    assert.throws(() => importProfile(catalog, draft, text), message);
    assert.deepEqual(draft, before);
  });
}

test("an imported profile keeps its customizations over this build's colliding new defaults", () => {
  // Exported by a build without the Ledger drawer action, whose default ⌘E
  // the file's menu opening now holds: the new action stays unbound.
  const older = profile("older", "Older", { [MACOS]: [{ action: "global.open-menu", keys: ["meta+e"] }] }, ["global.go-home", "global.go-ledger", "global.open-menu"]);

  const { draft: next, profileId } = importProfile(catalog, draftOf(profile("default", "Default")), exportProfile(older));

  const imported = next.profiles.find((p) => p.id === profileId);
  assert.deepEqual(resolved(imported, MACOS)["ledger.drawer-open.close"], []);
  assert.deepEqual(resolved(imported, MACOS)["global.open-menu"], ["meta+e"]);
  assert.deepEqual(resolved(imported, WINDOWS_LINUX)["ledger.drawer-open.close"], ["ctrl+e"]);
  assert.deepEqual(imported.knownActions, allIds);
});

test("an imported customization holding another extension's positional default imports, and that extension yields", () => {
  // Exported where Alpha was second (⌘⌥2); here Beta is second.
  const here = buildCatalog({ extensions: [{ Name: "first" }, { Name: "beta" }, { Name: "alpha" }] });
  const known = here.actions.map((a) => a.id);
  const mine = profile("mine", "Mine", { [MACOS]: [{ action: "global.open-extension.alpha", keys: ["meta+alt+2", "meta+alt+8"] }] }, known);

  const { draft: next, profileId } = importProfile(here, draftOf(factoryProfile()), exportProfile(mine));

  const imported = next.profiles.find((p) => p.id === profileId);
  const mac = profileKeymap(here, imported, MACOS);
  assert.deepEqual(mac.bindingsFor("global.open-extension.alpha"), ["meta+alt+2", "meta+alt+8"]);
  assert.deepEqual(mac.bindingsFor("global.open-extension.beta"), []);
});

test("bindings are stored in canonical form", () => {
  const text = fileWith((f) => (f.profile.overrides.macos[0].keys = ["Cmd+Shift+H", "⌘+H", "meta+h"]));
  const { draft: next, profileId } = importProfile(catalog, draftOf(profile("default", "Default")), text);
  const imported = next.profiles.find((p) => p.id === profileId);
  assert.deepEqual(imported.overrides[MACOS][0], { action: "global.go-home", keys: ["meta+shift+h", "meta+h"] });
});

test("a profile with a conflict cannot be exported, so every export imports again", () => {
  const clash = profile("clash", "Clash", { [MACOS]: [{ action: "global.go-home", keys: ["meta+2"] }] });
  const draft = draftOf(work, clash);
  assert.equal(exportBlocker(catalog, draft, "work"), "");
  assert.equal(exportBlocker(catalog, draft, "clash"), "Fix the conflicts in Clash before exporting it");
});

test("the factory profile of the real catalog exports and imports", () => {
  const real = buildCatalog({ extensions: [] });
  const settled = settleProfile(real, factoryProfile());
  const { draft: next, name } = importProfile(real, draftOf(settled), exportProfile(settled));
  assert.equal(name, "Default 2");
  assert.deepEqual(next.profiles[1].overrides, settled.overrides);
  assert.equal(exportFileName({ name: "Vim-ish Work" }), "vim-ish-work.marasi-keys.json");
});

test("an import becomes a distinct profile even when the file came from this draft", () => {
  const draft = draftOf(work);
  const { draft: next, profileId } = importProfile(catalog, draft, exportProfile(work));
  assert.notEqual(profileId, "work");
  assert.equal(next.activeProfile, "work");
  assert.equal(next.profiles.length, 2);
});
