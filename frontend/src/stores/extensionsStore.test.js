// The project's extensions: the list following extension.* events, the UI
// extensions draw and the state they update, toasts, live logs, and the
// calls that reach an extension.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createExtensionsStore, extensionToast } from "./createExtensionsStore.js";

const workshop = { ID: "w-1", Name: "workshop", Enabled: true, Author: "TenSoon", Description: "Lua Workshop" };
const compass = { ID: "c-1", Name: "compass", Enabled: true, Author: "Steris", Description: "Scope" };
// A summary as Marasi's extension.* events carry it.
const event = (summary, changes = {}) => ({
  id: summary.ID,
  name: summary.Name,
  enabled: summary.Enabled,
  author: summary.Author,
  description: summary.Description,
  source_url: "marasi-internal",
  updated_at: "2026-11-01T00:00:00Z",
  ...changes,
});

function setup(overrides = {}) {
  const calls = [];
  const api = {
    list: async () => (calls.push(["list"]), [compass, workshop]),
    setEnabled: async (id, enabled) => (calls.push(["setEnabled", id, enabled]), { ...workshop, Enabled: enabled }),
    getSettings: async (id) => (calls.push(["getSettings", id]), { depth: 1 }),
    saveSettings: async (id, settings) => (calls.push(["saveSettings", id, settings]), settings),
    call: async (...args) => (calls.push(["call", ...args]), { status: "called" }),
    ...overrides,
  };
  return { store: createExtensionsStore(api), calls };
}

test("reload lists the project's extensions", async () => {
  const { store } = setup();
  await store.reload();
  assert.deepEqual(get(store.list), [compass, workshop]);
});

test("an extension.enabled event changes the extension it names", async () => {
  const { store } = setup();
  await store.reload();
  store.onExtension(event(workshop, { enabled: false }));
  assert.equal(get(store.list)[1].Enabled, false);
  assert.equal(get(store.list)[0].Enabled, true);
});

test("an event for an extension not listed yet adds it", () => {
  const { store } = setup();
  store.onExtension(event(compass));
  assert.deepEqual(get(store.list).map((extension) => extension.Name), ["compass"]);
});

test("a render draws the schema on the extension's target", () => {
  const { store } = setup();
  store.onRendered({ id: "w-1", name: "workshop", target: "main", schema: { type: "text", value: "W" } });
  store.onRendered({ id: "w-1", name: "workshop", target: "icon", schema: { type: "text", value: "I" } });
  assert.deepEqual(get(store.ui).workshop, {
    state: {},
    main: { type: "text", value: "W" },
    icon: { type: "text", value: "I" },
  });
});

test("an update sets one key of the extension's UI state and keeps what it drew", () => {
  const { store } = setup();
  store.onRendered({ name: "workshop", target: "main", schema: { type: "text" } });
  store.onUpdated({ name: "workshop", key: "count", value: 3 });
  store.onUpdated({ name: "workshop", key: "label", value: "x" });
  assert.deepEqual(get(store.ui).workshop, { state: { count: 3, label: "x" }, main: { type: "text" } });
});

test("a toast render goes to the toast listeners, not the extension's UI", () => {
  const { store } = setup();
  const toasts = [];
  store.onToast((toast) => toasts.push(toast));
  store.onRendered({ name: "workshop", target: "toast", schema: { message: "hi", variant: "success" } });
  assert.deepEqual(toasts, [{ message: "hi", background: "variant-filled-success" }]);
  assert.deepEqual(get(store.ui), {});
});

test("a toast with a variant v1 didn't offer is a primary one", () => {
  assert.deepEqual(extensionToast({ message: "hi", variant: "neon" }), {
    message: "hi",
    background: "variant-filled-primary",
  });
});

test("clear forgets the extensions and what they drew", async () => {
  const { store } = setup();
  await store.reload();
  store.onUpdated({ name: "workshop", key: "count", value: 3 });
  store.clear();
  assert.deepEqual(get(store.list), []);
  assert.deepEqual(get(store.ui), {});
});

test("a log line reaches the followers of that extension only", () => {
  const { store } = setup();
  const lines = [];
  const stop = store.followLogs("workshop", (line) => lines.push(line));
  store.onLog({ id: "w-1", name: "workshop", time: "2026-11-01T01:05:27+04:00", text: "hi" });
  store.onLog({ id: "c-1", name: "compass", time: "2026-11-01T01:05:28+04:00", text: "other" });
  stop();
  store.onLog({ id: "w-1", name: "workshop", time: "2026-11-01T01:05:29+04:00", text: "late" });
  assert.deepEqual(lines, [{ Time: "2026-11-01T01:05:27+04:00", Text: "hi" }]);
});

test("call sends the function and its args to the extension", async () => {
  const { store, calls } = setup();
  await store.call("w-1", "clicked", [{ state: { count: 3 } }]);
  assert.deepEqual(calls, [["call", "w-1", "clicked", [{ state: { count: 3 } }]]]);
});

test("setEnabled keeps the summary Marasi answers", async () => {
  const { store, calls } = setup();
  await store.reload();
  await store.setEnabled("w-1", false);
  assert.deepEqual(calls.at(-1), ["setEnabled", "w-1", false]);
  assert.equal(get(store.list)[1].Enabled, false);
});

test("loadSettings and saveSettings keep the extension's settings", async () => {
  const { store, calls } = setup();
  await store.loadSettings("w-1");
  assert.deepEqual(get(store.settings), { "w-1": { depth: 1 } });
  await store.saveSettings("w-1", { depth: 2 });
  assert.deepEqual(calls.at(-1), ["saveSettings", "w-1", { depth: 2 }]);
  assert.deepEqual(get(store.settings), { "w-1": { depth: 2 } });
});

test("a settings event, which names no extension, rereads every extension's settings shown", async () => {
  const { store, calls } = setup();
  await store.loadSettings("w-1");
  await store.loadSettings("c-1");
  calls.length = 0;
  await store.onSettingsUpdated({ settings: { depth: 5 } });
  assert.deepEqual(calls, [
    ["getSettings", "w-1"],
    ["getSettings", "c-1"],
  ]);
});

test("clear forgets the settings read", async () => {
  const { store } = setup();
  await store.loadSettings("w-1");
  store.clear();
  assert.deepEqual(get(store.settings), {});
});
