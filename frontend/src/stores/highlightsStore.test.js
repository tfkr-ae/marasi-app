// The highlight palette's labels per project, renaming a label for this
// project or for all projects, and the project's labels read over the
// service's client settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createHighlightsStore } from "./createHighlightsStore.js";
import { createHighlightsApi } from "./highlightsApi.js";
import { fakeServiceClient } from "./fakeServiceClient.js";

const DEFAULT_APP = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"].map(
  (color) => ({ color, label: "" }),
);

// Project client settings in `settings` (key -> value); app highlights in `app`.
function fakeApi({ settings = {}, app = DEFAULT_APP } = {}) {
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
    setClientSetting: async (key, value) => {
      calls.push(["setClientSetting", key, value]);
      settings[key] = value;
    },
    deleteClientSetting: async (key) => {
      calls.push(["deleteClientSetting", key]);
      delete settings[key];
    },
  };
  return api;
}

const labels = (store) => get(store.palette).map((h) => `${h.label}${h.scope ? ` (${h.scope})` : ""}`);

test("a project's labels win over the app's", async () => {
  const app = DEFAULT_APP.map((h, i) => (i === 2 ? { ...h, label: "Revisit" } : i === 0 ? { ...h, label: "Auth" } : h));
  const api = fakeApi({ app, settings: { "ledger.highlight.3": "IDOR candidate" } });
  const store = createHighlightsStore(api);
  await store.readApp();

  await store.loadProject();

  assert.deepEqual(labels(store).slice(0, 4), ["Auth (app)", "Orange", "IDOR candidate (project)", "Green"]);
});

test("renaming for this project writes ledger.highlight.<n>", async () => {
  const api = fakeApi({ settings: { "ledger.highlight_migrated": true } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.loadProject();

  await store.rename(4, "  Leaks tokens ", { allProjects: false });

  assert.deepEqual(api.calls, [["setClientSetting", "ledger.highlight.4", "Leaks tokens"]]);
  assert.equal(labels(store)[3], "Leaks tokens (project)");
});

test("renaming for all projects writes the app label and drops the project's", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.4": "Old" } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.loadProject();

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
  const api = fakeApi({ settings: { "ledger.highlight.4": "Old" } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.loadProject();

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
  const api = fakeApi({ settings: { "ledger.highlight.2": "Mine" } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.loadProject();

  await store.rename(2, "  ", { allProjects: false });

  assert.deepEqual(api.calls, [["deleteClientSetting", "ledger.highlight.2"]]);
  assert.equal(labels(store)[1], "Orange");
});

test("resync reads the project's labels again", async () => {
  const api = fakeApi({ settings: { "ledger.highlight.3": "IDOR candidate" } });
  const store = createHighlightsStore(api);
  await store.readApp();
  await store.loadProject();
  // Another client renamed one and dropped the other.
  delete api.settings["ledger.highlight.3"];
  api.settings["ledger.highlight.5"] = "Secrets";
  await store.resync();
  assert.deepEqual(get(store.projectLabels), { 5: "Secrets" });
});

test("loadProject drops labels that arrive for a project no longer open", async () => {
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const api = fakeApi({ settings: { "ledger.highlight.1": "Old" } });
  const list = api.listClientSettings;
  let first = true;
  api.listClientSettings = async (prefix) => {
    if (first) {
      first = false;
      await slow;
      return [{ key: "ledger.highlight.1", value: "Old" }];
    }
    return list(prefix);
  };
  const store = createHighlightsStore(api);
  const opening = store.loadProject();
  store.clear();
  api.settings["ledger.highlight.1"] = "New";
  await store.loadProject();
  release();
  await opening;
  assert.deepEqual(get(store.projectLabels), { 1: "New" });
});

test("over the service, the project's labels are client settings ledger.highlight.<n>", async () => {
  const settings = { "ledger.highlight.2": "Auth bypass", "ledger.other": "x" };
  const writes = [];
  const client = fakeServiceClient({
    "GET /client-settings/marasi-app": (query) => ({
      items: Object.keys(settings)
        .filter((key) => key.startsWith(query.prefix ?? ""))
        .sort()
        .map((key) => ({ client: "marasi-app", key, value: settings[key], updated_at: "2026-11-06T18:07:12Z" })),
    }),
    "PUT /client-settings/marasi-app/ledger.highlight.4": (_, body) => {
      writes.push(["PUT", body]);
      return { client: "marasi-app", key: "ledger.highlight.4", value: body.value };
    },
    "DELETE /client-settings/marasi-app/ledger.highlight.2": () => {
      writes.push(["DELETE"]);
      return { client: "marasi-app", key: "ledger.highlight.2" };
    },
  });
  const appConfig = {
    getHighlights: async () => DEFAULT_APP,
    saveHighlights: async (list) => list,
    resetHighlights: async () => DEFAULT_APP,
  };
  const store = createHighlightsStore(createHighlightsApi(client, appConfig));
  await store.readApp();
  await store.loadProject();
  assert.deepEqual(get(store.projectLabels), { 2: "Auth bypass" });
  assert.deepEqual(client.calls[0].query, { prefix: "ledger.highlight." });

  await store.rename(4, "  Revisit ");
  await store.rename(2, "");
  assert.deepEqual(writes, [["PUT", { value: "Revisit" }], ["DELETE"]]);
  assert.deepEqual(get(store.projectLabels), { 4: "Revisit" });
});
