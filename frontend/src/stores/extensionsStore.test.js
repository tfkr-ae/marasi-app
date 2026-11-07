// Extensions and Workshop: the extension list, GUI, logs, calls and ad-hoc
// Lua, read from the service through createExtensionsApi (over a fake
// service client) and kept by createExtensionsStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { createExtensionsApi } from "./extensionsApi.js";
import { createExtensionsStore } from "./createExtensionsStore.js";

// A fake service client answering from `routes` ("METHOD path" → body, or a
// function of the body or query; an Error is thrown), recording each call.
function fakeClient(routes) {
  const calls = [];
  async function answer(method, path, arg) {
    calls.push([method, path, arg]);
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw Object.assign(new Error(`${method} ${path}: not_found: HTTP 404`), { code: "not_found" });
    const value = typeof route === "function" ? route(arg) : route;
    if (value instanceof Error) throw value;
    return value;
  }
  return {
    calls,
    get: (path, query) => answer("GET", path, query),
    post: (path, body) => answer("POST", path, body),
  };
}

function refusal(code, message) {
  return Object.assign(new Error(`POST /x: ${code}: ${message}`), { code, body: { error: code, message } });
}

const CHECKPOINT = "0190-checkpoint";
const WORKSHOP = "0190-workshop";
const PANEL = "0190-panel";

const summary = (id, name, enabled = true) => ({
  id,
  name,
  enabled,
  author: "Marasi",
  description: `${name} extension`,
  source_url: "",
  updated_at: "2026-11-06T22:07:49.626213+04:00",
});

const serviceRoutes = () => ({
  "GET /extension": {
    items: [summary(CHECKPOINT, "checkpoint"), summary(WORKSHOP, "workshop"), summary(PANEL, "panel")],
  },
  [`GET /extension/${CHECKPOINT}`]: {
    ...summary(CHECKPOINT, "checkpoint"),
    lua_content: "-- rules",
    settings: {},
    ui_code: "",
    version: "",
  },
  [`GET /extension/${WORKSHOP}`]: { ...summary(WORKSHOP, "workshop"), lua_content: "print('hi')", settings: {} },
  [`GET /extension/${PANEL}`]: {
    ...summary(PANEL, "panel"),
    lua_content: "-- draws its own web component",
    settings: { depth: 2 },
    ui_code: 'customElements.define("panel-extension-1", class extends HTMLElement {})',
    version: "1",
  },
  [`GET /extension/${CHECKPOINT}/ui`]: { id: CHECKPOINT, name: "checkpoint", renders: {}, state: {} },
  [`GET /extension/${WORKSHOP}/ui`]: { id: WORKSHOP, name: "workshop", renders: {}, state: {} },
  [`GET /extension/${PANEL}/ui`]: {
    id: PANEL,
    name: "panel",
    renders: { main: { type: "text", value: { bind: "count" } }, icon: { type: "icon" } },
    state: { count: 3, query: "server" },
  },
});

function setup(routes = serviceRoutes()) {
  const client = fakeClient(routes);
  const list = writable([]);
  const ui = writable({});
  const toasts = [];
  const store = createExtensionsStore(createExtensionsApi(client), { list, ui, toast: (t) => toasts.push(t) });
  return { client, store, list, ui, toasts };
}

const callsTo = (client, method, path) => client.calls.filter(([m, p]) => m === method && p === path);

test("populate lists the extensions in the fields the pages read", async () => {
  const { store, list } = setup();
  await store.populate();
  assert.deepEqual(get(list)[2], {
    ID: PANEL,
    Name: "panel",
    Enabled: true,
    Author: "Marasi",
    Description: "panel extension",
    SourceURL: "",
    UpdatedAt: "2026-11-06T22:07:49.626213+04:00",
    UICode: 'customElements.define("panel-extension-1", class extends HTMLElement {})',
    Version: "1",
  });
  // The web component comes from the service's ui_code, never the Lua text.
  assert.equal(get(list)[0].UICode, "");
  assert.equal(get(list)[1].UICode, "");
});

test("extension.updated rereads the extension, so a new web component replaces the old", async () => {
  const routes = serviceRoutes();
  const { store, list } = setup(routes);
  await store.populate();
  routes[`GET /extension/${PANEL}`] = {
    ...routes[`GET /extension/${PANEL}`],
    ui_code: 'customElements.define("panel-extension-2", class extends HTMLElement {})',
    version: "2",
  };
  await store.onChanged(summary(PANEL, "panel"));
  const panel = get(list).find((e) => e.ID === PANEL);
  assert.deepEqual([panel.UICode, panel.Version], ['customElements.define("panel-extension-2", class extends HTMLElement {})', "2"]);
});

test("populate draws what each extension last rendered, with its state", async () => {
  const { store, ui } = setup();
  await store.populate();
  assert.deepEqual(get(ui).panel, {
    main: { type: "text", value: { bind: "count" } },
    icon: { type: "icon" },
    state: { count: 3, query: "server" },
  });
});

test("a UI call posts the function with the extension's state to its call route", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/call`]: { status: "called" } };
  const { store, client } = setup(routes);
  await store.populate();
  await store.call("panel", "refresh");
  assert.deepEqual(callsTo(client, "POST", `/extension/${PANEL}/call`), [
    ["POST", `/extension/${PANEL}/call`, { function: "refresh", args: [{ count: 3, query: "server" }] }],
  ]);
});

test("a call finds the extension by name in the service's list before the first load", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/call`]: { status: "called" } };
  const { store, client } = setup(routes);
  await store.call("panel", "refresh");
  assert.deepEqual(callsTo(client, "POST", `/extension/${PANEL}/call`)[0][2], { function: "refresh", args: [{}] });
});

test("leaving an extension's page syncs its state through the sync function", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/call`]: { status: "called" } };
  const { store, client } = setup(routes);
  await store.populate();
  store.edit("panel", "query", "admin");
  await store.sync("panel");
  assert.deepEqual(callsTo(client, "POST", `/extension/${PANEL}/call`), [
    ["POST", `/extension/${PANEL}/call`, { function: "sync", args: [{ count: 3, query: "admin" }] }],
  ]);
});

test("sync sends nothing for an extension with no state", async () => {
  const { store, client } = setup();
  await store.populate();
  await store.sync("workshop");
  assert.equal(callsTo(client, "POST", `/extension/${WORKSHOP}/call`).length, 0);
});

test("sync is quiet for an extension without a sync function", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/call`]: () => refusal("function_not_found", "") };
  const { store } = setup(routes);
  await store.populate();
  await store.sync("panel");
});

test("a call that fails in Lua rejects with the service's message", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/call`]: () => refusal("lua_error", "attempt to index a nil value") };
  const { store } = setup(routes);
  await store.populate();
  await assert.rejects(store.call("panel", "refresh"), /lua_error: attempt to index a nil value/);
});

test("extension.gui.rendered draws the schema at its target", async () => {
  const { store, ui } = setup();
  await store.populate();
  store.onRendered({ id: PANEL, name: "panel", target: "panel", schema: { type: "vstack" } });
  assert.deepEqual(get(ui).panel.panel, { type: "vstack" });
  assert.deepEqual(get(ui).panel.state, { count: 3, query: "server" });
});

test("extension.gui.rendered at the toast target shows a toast and draws nothing", async () => {
  const { store, ui, toasts } = setup();
  await store.populate();
  store.onRendered({ id: PANEL, name: "panel", target: "toast", schema: { message: "Done", variant: "success" } });
  assert.deepEqual(toasts, [{ message: "Done", variant: "success" }]);
  assert.equal(get(ui).panel.toast, undefined);
});

test("extension.gui.updated sets one key of the extension's state", async () => {
  const { store, ui } = setup();
  await store.populate();
  store.onUpdated({ id: PANEL, name: "panel", key: "count", value: 4 });
  assert.deepEqual(get(ui).panel.state, { count: 4, query: "server" });
});

test("disabling an extension takes its drawing away; enabling draws it again", async () => {
  const routes = {
    ...serviceRoutes(),
    [`POST /extension/${PANEL}/enable`]: ({ enabled }) => summary(PANEL, "panel", enabled),
  };
  const { store, list, ui } = setup(routes);
  await store.populate();
  await store.setEnabled("panel", false);
  assert.equal(get(list)[2].Enabled, false);
  assert.equal(get(ui).panel, undefined);
  await store.onChanged(summary(PANEL, "panel", true));
  assert.equal(get(list)[2].Enabled, true);
  assert.deepEqual(get(ui).panel.state, { count: 3, query: "server" });
});

test("settings save through the service and come back as stored", async () => {
  const routes = { ...serviceRoutes(), [`POST /extension/${PANEL}/settings`]: ({ settings }) => ({ settings }) };
  const { store, client } = setup(routes);
  await store.populate();
  assert.deepEqual(await store.saveSettings("panel", { depth: 3 }), { depth: 3 });
  assert.deepEqual(callsTo(client, "POST", `/extension/${PANEL}/settings`)[0][2], { settings: { depth: 3 } });
});

test("an extension's logs read its stored lines, then follow extension.log", async () => {
  const routes = {
    ...serviceRoutes(),
    [`GET /extension/${PANEL}/logs`]: { items: [{ time: "2026-11-06T22:00:00+04:00", text: "loaded\n" }] },
  };
  const { store } = setup(routes);
  await store.populate();
  const seen = [];
  const stop = await store.watchLogs("panel", (lines) => seen.push(lines));
  store.onLog({ id: PANEL, name: "panel", time: "2026-11-06T22:00:01+04:00", text: "scan done" });
  store.onLog({ id: WORKSHOP, name: "workshop", time: "2026-11-06T22:00:02+04:00", text: "other" });
  stop();
  store.onLog({ id: PANEL, name: "panel", time: "2026-11-06T22:00:03+04:00", text: "after" });
  assert.deepEqual(seen.at(-1), [
    { Time: "2026-11-06T22:00:00+04:00", Text: "loaded\n" },
    { Time: "2026-11-06T22:00:01+04:00", Text: "scan done" },
  ]);
});

function workshopSetup(routes) {
  const workshop = writable("");
  const client = fakeClient(routes);
  const store = createExtensionsStore(createExtensionsApi(client), { workshop });
  return { client, store, workshop };
}

test("populate opens Workshop on its stored code", async () => {
  const { store, workshop } = workshopSetup(serviceRoutes());
  await store.populate();
  assert.equal(get(workshop), "print('hi')");
});

test("Workshop runs its Lua through the service, which stores it when it runs", async () => {
  const routes = {
    ...serviceRoutes(),
    [`POST /extension/${WORKSHOP}`]: ({ lua_content }) => ({ ...summary(WORKSHOP, "workshop"), lua_content, settings: {} }),
  };
  const { store, client } = workshopSetup(routes);
  await store.populate();
  await store.run("workshop", "print('scan')");
  assert.deepEqual(callsTo(client, "POST", `/extension/${WORKSHOP}`), [
    ["POST", `/extension/${WORKSHOP}`, { lua_content: "print('scan')" }],
  ]);
});

test("code reads an extension's stored Lua by name", async () => {
  const { store } = workshopSetup(serviceRoutes());
  assert.equal(await store.code("checkpoint"), "-- rules");
});

test("a Workshop run that fails rejects with the Lua error", async () => {
  const routes = {
    ...serviceRoutes(),
    [`POST /extension/${WORKSHOP}`]: () => refusal("lua_error", "<string>:1: unexpected symbol"),
  };
  const { store } = workshopSetup(routes);
  await store.populate();
  await assert.rejects(store.run("workshop", "print("), (err) => err.body.message === "<string>:1: unexpected symbol");
});

test("resync replaces the drawings and keeps the Workshop draft and unsent inputs", async () => {
  const routes = serviceRoutes();
  const workshop = writable("");
  const ui = writable({});
  const client = fakeClient(routes);
  const store = createExtensionsStore(createExtensionsApi(client), { workshop, ui });
  await store.populate();
  workshop.set("-- my draft");
  store.edit("panel", "query", "admin");
  routes[`GET /extension/${PANEL}/ui`] = {
    id: PANEL,
    name: "panel",
    renders: { main: { type: "text", value: "v2" } },
    state: { count: 9, query: "server" },
  };
  await store.resync();
  assert.equal(get(workshop), "-- my draft");
  assert.deepEqual(get(ui).panel, { main: { type: "text", value: "v2" }, state: { count: 9, query: "admin" } });
});

test("clear forgets the last project's extensions", async () => {
  const { store, list, ui } = setup();
  await store.populate();
  store.clear();
  assert.deepEqual(get(list), []);
  assert.deepEqual(get(ui), {});
});

test("Compass's editor opens on its stored rules, keeps a draft over a resync and clears with the project", async () => {
  const COMPASS = "0190-compass";
  const routes = serviceRoutes();
  routes["GET /extension"].items.push(summary(COMPASS, "compass"));
  routes[`GET /extension/${COMPASS}`] = { ...summary(COMPASS, "compass"), lua_content: "-- scope rules", settings: {} };
  routes[`GET /extension/${COMPASS}/ui`] = { id: COMPASS, name: "compass", renders: {}, state: {} };
  const compass = writable("");
  const store = createExtensionsStore(createExtensionsApi(fakeClient(routes)), { editors: { compass } });
  await store.populate();
  assert.equal(get(compass), "-- scope rules");
  compass.set("-- my rules");
  await store.resync();
  assert.equal(get(compass), "-- my rules");
  store.clear();
  assert.equal(get(compass), "");
});
