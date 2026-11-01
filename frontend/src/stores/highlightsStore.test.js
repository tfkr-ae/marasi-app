// The highlight palette's labels per project, renaming a label for this
// project or for all projects, and the once-per-project migration of old
// hex highlights.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createHighlightsStore } from "./createHighlightsStore.js";

const DEFAULT_APP = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"].map(
  (color) => ({ color, label: "" }),
);

// Project client settings in `settings` (key -> value); app highlights in `app`.
function fakeApi({ settings = {}, app = DEFAULT_APP, migration = { Ran: true, Highlighted: 2, Cleared: 3 } } = {}) {
  const calls = [];
  const api = {
    calls,
    settings,
    app: app.map((h) => ({ ...h })),
    getHighlights: async () => api.app.map((h) => ({ ...h })),
    saveHighlights: async (list) => {
      calls.push(["saveHighlights", list.map((h) => h.label)]);
      api.app = list.map((h) => ({ ...h }));
      return api.app.map((h) => ({ ...h }));
    },
    resetHighlights: async () => api.app,
    listClientSettings: async (prefix) =>
      Object.keys(settings)
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ client: "marasi-app", key, value: settings[key] })),
    getClientSetting: async (key) => (key in settings ? { key, value: settings[key] } : null),
    setClientSetting: async (key, value) => {
      calls.push(["setClientSetting", key, value]);
      settings[key] = value;
    },
    deleteClientSetting: async (key) => {
      calls.push(["deleteClientSetting", key]);
      delete settings[key];
    },
    migrateOldHighlights: async () => {
      calls.push(["migrateOldHighlights"]);
      settings["ledger.highlight_migrated"] = true;
      return migration;
    },
  };
  return api;
}

const labels = (store) => get(store.palette).map((h) => `${h.label}${h.scope ? ` (${h.scope})` : ""}`);

test("a project's labels win over the app's", async () => {
  const app = DEFAULT_APP.map((h, i) => (i === 2 ? { ...h, label: "Revisit" } : i === 0 ? { ...h, label: "Auth" } : h));
  const api = fakeApi({ app, settings: { "ledger.highlight.3": "IDOR candidate", "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();

  await store.openProject();

  assert.deepEqual(labels(store).slice(0, 4), ["Auth (app)", "Orange", "IDOR candidate (project)", "Green"]);
});

test("renaming for this project writes ledger.highlight.<n>", async () => {
  const api = fakeApi({ settings: { "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.openProject();

  await store.rename(4, "  Leaks tokens ", { allProjects: false });

  assert.deepEqual(api.calls, [["setClientSetting", "ledger.highlight.4", "Leaks tokens"]]);
  assert.equal(labels(store)[3], "Leaks tokens (project)");
});

test("renaming for all projects writes the app label and drops the project's", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.4": "Old", "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.openProject();

  await store.rename(4, "Leaks tokens", { allProjects: true });

  assert.deepEqual(api.calls, [
    ["saveHighlights", ["", "", "", "Leaks tokens", "", "", "", ""]],
    ["deleteClientSetting", "ledger.highlight.4"],
  ]);
  assert.equal(labels(store)[3], "Leaks tokens (app)");
});

// Makes `api[name]` wait until the returned release(), or fail(error).
function hold(api, name) {
  const real = api[name];
  let release;
  let fail;
  const gate = new Promise((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  api[name] = async (...args) => {
    await gate;
    return real(...args);
  };
  return { release: () => release(), fail: (error) => fail(error) };
}

test("a rename shows at once and goes back when the write fails", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.4": "Old", "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.openProject();

  let held = hold(api, "setClientSetting");
  const renaming = store.rename(4, "New");
  assert.equal(labels(store)[3], "New (project)");
  held.fail(new Error("locked"));
  await assert.rejects(renaming, /locked/);
  assert.equal(labels(store)[3], "Old (project)");

  held = hold(api, "saveHighlights");
  const renamingAll = store.rename(4, "Everywhere", { allProjects: true });
  assert.equal(labels(store)[3], "Everywhere (app)");
  held.release();
  await renamingAll;
  assert.equal(labels(store)[3], "Everywhere (app)");
  assert.equal(api.settings["ledger.highlight.4"], undefined);
});

test("saving the app highlights shows at once and goes back when the write fails", async () => {
  const api = fakeApi();
  const store = createHighlightsStore(api);
  await store.readApp();
  const next = DEFAULT_APP.map((h, i) => (i === 0 ? { ...h, label: "Auth" } : h));

  const held = hold(api, "saveHighlights");
  const saving = store.save(next);
  assert.equal(get(store.appHighlights)[0].label, "Auth");
  held.fail(new Error("disk full"));
  await assert.rejects(saving, /disk full/);
  assert.equal(get(store.appHighlights)[0].label, "");
});

test("a blank project label falls back to the app's", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.2": "Mine", "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.openProject();

  await store.rename(2, "  ", { allProjects: false });

  assert.deepEqual(api.calls, [["deleteClientSetting", "ledger.highlight.2"]]);
  assert.equal(labels(store)[1], "Orange");
});

test("opening a project migrates its old highlights once, with a notice while it runs", async () => {
  const api = fakeApi();
  let finish;
  api.migrateOldHighlights = () => {
    api.calls.push(["migrateOldHighlights"]);
    return new Promise((resolve) => (finish = resolve));
  };
  const store = createHighlightsStore(api);
  const migrated = [];

  const opened = store.openProject({ onMigrated: (result) => migrated.push(result) });
  await opened;
  assert.equal(get(store.migrating), true);
  finish({ Ran: true, Highlighted: 4, Cleared: 5 });
  await store.migration;

  assert.equal(get(store.migrating), false);
  assert.deepEqual(migrated, [{ Ran: true, Highlighted: 4, Cleared: 5 }]);
});

test("a migrated project skips the migration and its notice", async () => {
  const api = fakeApi({ settings: { "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  const migrated = [];

  await store.openProject({ onMigrated: (result) => migrated.push(result) });
  await store.migration;

  assert.equal(api.calls.some(([name]) => name === "migrateOldHighlights"), false);
  assert.equal(get(store.migrating), false);
  assert.deepEqual(migrated, []);
});

test("a failed migration clears the notice and is retried on the next open", async () => {
  const api = fakeApi();
  api.migrateOldHighlights = async () => {
    api.calls.push(["migrateOldHighlights"]);
    throw new Error("database is locked");
  };
  const store = createHighlightsStore(api);

  await store.openProject();
  await store.migration;
  assert.equal(get(store.migrating), false);
  await store.openProject();
  await store.migration;

  assert.equal(api.calls.filter(([name]) => name === "migrateOldHighlights").length, 2);
});

test("a migration that finishes after another project opened doesn't refresh it", async () => {
  const api = fakeApi();
  let finish;
  api.migrateOldHighlights = () => new Promise((resolve) => (finish = resolve));
  const store = createHighlightsStore(api);
  const migrated = [];
  await store.openProject({ onMigrated: (result) => migrated.push(result) });
  const first = store.migration;

  api.settings["ledger.highlight_migrated"] = true;
  await store.openProject({ onMigrated: (result) => migrated.push(result) });
  finish({ Ran: true, Highlighted: 1, Cleared: 1 });
  await first;

  assert.deepEqual(migrated, []);
  assert.equal(get(store.migrating), false);
});

test("reload reads the project's labels again, as after the event stream reopens, without migrating", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.3": "IDOR candidate", "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.openProject();
  // Another client renames while the stream is closed.
  api.settings["ledger.highlight.3"] = "Confirmed IDOR";
  api.settings["ledger.highlight.5"] = "Auth bypass";

  await store.reload();

  assert.deepEqual(labels(store).slice(2, 5), ["Confirmed IDOR (project)", "Green", "Auth bypass (project)"]);
  assert.ok(!api.calls.some((c) => c[0] === "migrateOldHighlights"));
});
