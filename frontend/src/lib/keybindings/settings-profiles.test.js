import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog } from "./catalog.js";
import { createDispatcher } from "./dispatcher.js";
import { MACOS, WINDOWS_LINUX } from "./platform.js";
import { validateKeybindings } from "./testing.js";
import {
  actionBindings,
  addBinding,
  createProfile,
  deleteBlocker,
  deleteProfile,
  duplicateProfile,
  makeActive,
  makeActiveBlocker,
  openDraft,
  profileNameProblem,
  isPlatformCustomized,
  removeBinding,
  renameProfile,
  resetPlatform,
  saveDraft,
  suggestProfileName,
} from "./settings.js";

// Profile lifecycle and platform reset in the settings modal's draft.

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

function profile(id, name, overrides = {}) {
  return { id, name, overrides: { [MACOS]: [], [WINDOWS_LINUX]: [], ...overrides }, knownActions: allIds };
}

const homeOn = (profileId, platform = MACOS) => ({ profileId, platform, actionId: "global.go-home" });

// A saved config with a customized active profile ("Work": Home on ⌘H as
// well, Ledger unbound on Windows/Linux, a dormant extension override).
function workDraft() {
  const work = profile("work", "Work", {
    [MACOS]: [
      { action: "global.go-home", keys: ["meta+1", "meta+h"] },
      { action: "extension.gone.do-thing", keys: ["meta+alt+9"] },
    ],
    [WINDOWS_LINUX]: [{ action: "global.go-ledger", keys: [] }],
  });
  return openDraft({ config: { version: 1, activeProfile: "work", profiles: [profile("default", "Default"), work] }, problem: "" }, catalog);
}

function find(draft, id) {
  return draft.profiles.find((p) => p.id === id);
}

function bindings(draft, target) {
  return actionBindings(catalog, find(draft, target.profileId), target.platform, target.actionId);
}

test("a new profile starts from factory defaults with an id derived from its name and does not become active", () => {
  const before = workDraft();
  const draft = createProfile(catalog, before, "Pair Testing");

  const created = draft.profiles.at(-1);
  assert.equal(created.id, "pair-testing");
  assert.equal(created.name, "Pair Testing");
  assert.equal(draft.activeProfile, "work");
  assert.deepEqual(bindings(draft, homeOn("pair-testing")), ["meta+1"]);
  assert.deepEqual(bindings(draft, { ...homeOn("pair-testing", WINDOWS_LINUX), actionId: "global.go-ledger" }), ["ctrl+2"]);
  assert.deepEqual(created.knownActions, allIds);
  assert.deepEqual(validateKeybindings(catalog, draft), []);
  assert.equal(before.profiles.length, 2);
});

test("profile names must be nonempty and distinct, ignoring case and surrounding spaces", () => {
  const draft = workDraft();
  assert.equal(profileNameProblem(draft, "  "), "Enter a profile name");
  assert.equal(profileNameProblem(draft, " work "), "Another profile is already named Work");
  assert.equal(profileNameProblem(draft, "Work 2"), "");
  // A profile may keep its own name, in any case.
  assert.equal(profileNameProblem(draft, "WORK", "work"), "");
  assert.throws(() => createProfile(catalog, draft, "default"), /already named Default/);
  assert.throws(() => renameProfile(draft, "work", ""), /Enter a profile name/);
  assert.throws(() => renameProfile(draft, "work", "Default"), /already named Default/);
});

test("renaming keeps the profile's identity, bindings and active state", () => {
  const draft = renameProfile(workDraft(), "work", "  Client Work ");
  const renamed = find(draft, "work");
  assert.equal(renamed.name, "Client Work");
  assert.equal(draft.activeProfile, "work");
  assert.deepEqual(bindings(draft, homeOn("work")), ["meta+1", "meta+h"]);
  assert.deepEqual(draft.profiles.map((p) => p.id), ["default", "work"]);
});

test("names that slug alike still get distinct ids", () => {
  const draft = createProfile(catalog, createProfile(catalog, workDraft(), "Work!"), "WORK?");
  assert.deepEqual(draft.profiles.map((p) => p.id), ["default", "work", "work-2", "work-3"]);
  const unnamed = createProfile(catalog, workDraft(), "***");
  assert.equal(unnamed.profiles.at(-1).id, "profile");
});

test("a duplicate keeps both variants, unbinding, dormant overrides and known actions under a new identity", () => {
  const before = workDraft();
  const draft = duplicateProfile(before, "work", "Work Copy");

  const copy = draft.profiles.at(-1);
  assert.equal(copy.id, "work-copy");
  assert.equal(copy.name, "Work Copy");
  assert.equal(draft.activeProfile, "work");
  assert.deepEqual(copy.overrides, find(before, "work").overrides);
  assert.deepEqual(copy.knownActions, find(before, "work").knownActions);
  assert.deepEqual(bindings(draft, homeOn("work-copy")), ["meta+1", "meta+h"]);
  assert.deepEqual(bindings(draft, { ...homeOn("work-copy", WINDOWS_LINUX), actionId: "global.go-ledger" }), []);
  assert.deepEqual(
    copy.overrides[MACOS].find((o) => o.action === "extension.gone.do-thing"),
    { action: "extension.gone.do-thing", keys: ["meta+alt+9"] },
  );

  // Editing the copy leaves the source alone, and the reverse.
  const edited = addBinding(catalog, draft, homeOn("work-copy"), "meta+j");
  assert.deepEqual(bindings(edited, homeOn("work")), ["meta+1", "meta+h"]);
  const source = removeBinding(catalog, draft, homeOn("work"), 1);
  assert.deepEqual(bindings(source, homeOn("work-copy")), ["meta+1", "meta+h"]);
  assert.throws(() => duplicateProfile(before, "work", "work"), /already named Work/);
});

test("suggested names for new and duplicated profiles are unused", () => {
  const draft = workDraft();
  assert.equal(suggestProfileName(draft, "Profile"), "Profile");
  assert.equal(suggestProfileName(draft, "Work Copy"), "Work Copy");
  const copied = duplicateProfile(draft, "work", "Work Copy");
  assert.equal(suggestProfileName(copied, "Work Copy"), "Work Copy 2");
  assert.equal(suggestProfileName(duplicateProfile(copied, "work", "work copy 2"), "Work Copy"), "Work Copy 3");
});

test("making a profile active is a draft edit that keeps every pending edit", () => {
  const edited = addBinding(catalog, workDraft(), homeOn("work"), "meta+j");
  const draft = makeActive(edited, "default");
  assert.equal(draft.activeProfile, "default");
  assert.deepEqual(bindings(draft, homeOn("work")), ["meta+1", "meta+h", "meta+j"]);
  assert.equal(makeActiveBlocker(draft, "default"), "Default is already the active profile");
  assert.equal(makeActiveBlocker(draft, "work"), "");
});

test("the active profile cannot be deleted until another is made active", () => {
  const draft = workDraft();
  assert.equal(deleteBlocker(draft, "work"), "Make another profile active before deleting Work");
  assert.throws(() => deleteProfile(draft, "work"), /Make another profile active/);

  const switched = makeActive(draft, "default");
  assert.equal(deleteBlocker(switched, "work"), "");
  const deleted = deleteProfile(switched, "work");
  assert.deepEqual(deleted.profiles.map((p) => p.id), ["default"]);
  assert.equal(deleted.activeProfile, "default");
  assert.equal(draft.profiles.length, 2);
});

test("the last profile cannot be deleted", () => {
  const only = deleteProfile(makeActive(workDraft(), "default"), "work");
  assert.equal(deleteBlocker(only, "default"), "The last profile cannot be deleted");
  assert.throws(() => deleteProfile(only, "default"), /last profile/);
});

test("deleting an inactive profile leaves the others' pending edits", () => {
  let draft = createProfile(catalog, workDraft(), "Scratch");
  draft = addBinding(catalog, draft, homeOn("default"), "meta+j");
  draft = deleteProfile(draft, "scratch");
  assert.deepEqual(draft.profiles.map((p) => p.id), ["default", "work"]);
  assert.deepEqual(bindings(draft, homeOn("default")), ["meta+1", "meta+j"]);
});

test("platform reset returns every action of that variant to its default and leaves the other platform and profiles unchanged", () => {
  let before = addBinding(catalog, workDraft(), homeOn("default"), "meta+j");
  before = removeBinding(catalog, before, { profileId: "work", platform: MACOS, actionId: "ledger.drawer-open.close" }, 0);
  const draft = resetPlatform(catalog, before, { profileId: "work", platform: MACOS });

  assert.deepEqual(bindings(draft, homeOn("work")), ["meta+1"]);
  assert.deepEqual(bindings(draft, { profileId: "work", platform: MACOS, actionId: "ledger.drawer-open.close" }), ["meta+e"]);
  assert.deepEqual(find(draft, "work").overrides[WINDOWS_LINUX], find(before, "work").overrides[WINDOWS_LINUX]);
  assert.deepEqual(bindings(draft, { ...homeOn("work", WINDOWS_LINUX), actionId: "global.go-ledger" }), []);
  assert.deepEqual(bindings(draft, homeOn("default")), ["meta+1", "meta+j"]);
  assert.equal(isPlatformCustomized(catalog, draft, { profileId: "work", platform: MACOS }), false);
  assert.equal(isPlatformCustomized(catalog, draft, { profileId: "work", platform: WINDOWS_LINUX }), true);
});

test("platform reset keeps customizations of unavailable extension actions, which have no row to restore them", () => {
  const draft = resetPlatform(catalog, workDraft(), { profileId: "work", platform: MACOS });
  assert.deepEqual(find(draft, "work").overrides[MACOS], [{ action: "extension.gone.do-thing", keys: ["meta+alt+9"] }]);
  // Only a dormant override left: nothing on this platform can be reset.
  assert.equal(isPlatformCustomized(catalog, draft, { profileId: "work", platform: MACOS }), false);
});

async function saveInto(live, draft) {
  return saveDraft({ draft, catalog, save: async (config) => ({ config, problem: "" }), apply: (state) => live.configure({ keybindings: state }) });
}

test("saving edits to the other platform's variant leaves this device's dispatch unchanged", async () => {
  const opened = workDraft();
  const live = createDispatcher({ catalog, platform: MACOS, keybindings: { config: opened, problem: "" } });
  let draft = addBinding(catalog, opened, homeOn("work", WINDOWS_LINUX), "ctrl+h");
  draft = resetPlatform(catalog, draft, { profileId: "work", platform: WINDOWS_LINUX });
  draft = removeBinding(catalog, draft, { ...homeOn("work", WINDOWS_LINUX), actionId: "global.go-ledger" }, 0);

  await saveInto(live, draft);
  assert.deepEqual(live.bindingsFor("global.go-home"), ["meta+1", "meta+h"]);
  assert.deepEqual(live.bindingsFor("global.go-ledger"), ["meta+2"]);
  assert.equal(live.resolve({ key: "h", code: "KeyH", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target: null }, { route: "/" }), "global.go-home");

  const windows = createDispatcher({ catalog, platform: WINDOWS_LINUX, keybindings: { config: draft, problem: "" } });
  assert.deepEqual(windows.bindingsFor("global.go-ledger"), []);
});

test("activation, a new profile and a deletion take effect on dispatch only once saved", async () => {
  const opened = workDraft();
  const live = createDispatcher({ catalog, platform: MACOS, keybindings: { config: opened, problem: "" } });
  let draft = duplicateProfile(opened, "work", "Work Copy");
  draft = addBinding(catalog, draft, homeOn("work-copy"), "meta+j");
  draft = makeActive(draft, "work-copy");
  draft = deleteProfile(draft, "work");
  assert.deepEqual(live.bindingsFor("global.go-home"), ["meta+1", "meta+h"]);

  await saveInto(live, draft);
  assert.deepEqual(live.bindingsFor("global.go-home"), ["meta+1", "meta+h", "meta+j"]);
});
