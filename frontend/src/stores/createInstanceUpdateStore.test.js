import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createInstanceUpdateStore } from "./createInstanceUpdateStore.js";
import { MarasiError, NeedsNewerMarasi } from "../lib/bindings/marasi.js";

const status = (extra = {}) => ({
  status: "running",
  version: "v0.9.0",
  channel: "release",
  instance: "work",
  restart_required: false,
  ...extra,
});

const updateBody = (extra = {}) => ({
  installed: { version: "v0.9.0", channel: "release" },
  development: false,
  channel: "release",
  auto_check: true,
  last_check: null,
  available: null,
  install: { state: "idle" },
  restart_required: false,
  install_path: "/opt/marasi/marasi",
  ...extra,
});

const refusal = (what, status, body) => new MarasiError(what, status, body);

// A fake client and bridge. `routes` answers each "METHOD /path" with a
// value, or a function of the body; `calls` records each call.
function fakeApi({ routes = {}, bundled = "/app/resources/bin/marasi", remote = false } = {}) {
  const calls = [];
  const answer = async (method, path, body) => {
    calls.push(body === undefined ? `${method} ${path}` : `${method} ${path} ${JSON.stringify(body)}`);
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new Error(`no fake for ${method} ${path}`);
    const value = typeof route === "function" ? route(body) : route;
    if (value instanceof Error) throw value;
    return value;
  };
  const api = {
    get: (path) => answer("GET", path),
    post: (path, body) => answer("POST", path, body),
    put: (path, body) => answer("PUT", path, body),
    delete: (path, body) => answer("DELETE", path, body),
    connection: () => ({ instance: "work", remote }),
    runsBundled: async (installPath) => installPath === bundled,
  };
  return { api, calls };
}

test("reload shows the instance's version and whether it needs a restart", async () => {
  const { api } = fakeApi({
    routes: {
      "GET /service/status": status({ version: "v0.9.1", restart_required: true }),
      "GET /update": updateBody({ restart_required: true }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  const state = get(store);
  assert.equal(state.version, "v0.9.1");
  assert.equal(state.restartRequired, true);
  assert.equal(state.canUpdate, true);
});

test("an instance running the bundled Marasi hides the update actions", async () => {
  const { api } = fakeApi({
    routes: {
      "GET /service/status": status(),
      "GET /update": updateBody({ install_path: "/app/resources/bin/marasi" }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.equal(get(store).canUpdate, false);
  assert.equal(get(store).version, "v0.9.0");
});

test("a remote instance's build is never the bundled Marasi", async () => {
  const { api } = fakeApi({
    remote: true,
    routes: {
      "GET /service/status": status(),
      "GET /update": updateBody({ install_path: "/app/resources/bin/marasi" }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.equal(get(store).canUpdate, true);
});

const available = { version: "v0.10.0", channel: "release", published: "2026-10-30T10:00:00Z", notes: "Fixes", page: "https://example.test/v0.10.0" };

test("check finds an update the instance can install", async () => {
  const { api, calls } = fakeApi({
    routes: {
      "GET /service/status": status(),
      "GET /update": updateBody(),
      "POST /update/check": updateBody({ available }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  await store.check();
  assert.ok(calls.includes("POST /update/check"));
  assert.equal(get(store).available.version, "v0.10.0");
  assert.equal(get(store).checking, false);
});

test("an update.available event shows the update", async () => {
  const { api } = fakeApi({ routes: { "GET /service/status": status(), "GET /update": updateBody() } });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  store.onAvailable({ instance: "work", ...available });
  assert.equal(get(store).available.version, "v0.10.0");
});

test("a failed check shows Marasi's reason", async () => {
  const { api } = fakeApi({
    routes: {
      "GET /service/status": status(),
      "GET /update": updateBody(),
      "POST /update/check": refusal("POST /update/check", 502, { error: "check_failed", message: "github unreachable" }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  await store.check();
  assert.match(get(store).error, /github unreachable/);
  assert.equal(get(store).checking, false);
});

// A store on an instance that found `available`.
async function withUpdate(routes = {}) {
  const fake = fakeApi({
    routes: { "GET /service/status": status(), "GET /update": updateBody({ available }), ...routes },
  });
  const store = createInstanceUpdateStore(fake.api);
  await store.reload();
  return { store, ...fake };
}

test("install follows the update's progress until it needs a restart", async () => {
  const { store, calls } = await withUpdate({
    "POST /update/install": { joined: false, install: { state: "running", version: "v0.10.0", step: "download" }, install_path: "/opt/marasi/marasi" },
  });
  await store.install();
  assert.ok(calls.includes("POST /update/install"));
  assert.equal(get(store).install.state, "running");

  store.onProgress({ instance: "work", version: "v0.10.0", step: "download", received: 50, total: 200 });
  assert.deepEqual(get(store).install, { state: "running", version: "v0.10.0", step: "download", received: 50, total: 200 });

  store.onInstalled({ instance: "work", version: "v0.10.0", install_path: "/opt/marasi/marasi" });
  assert.equal(get(store).install.state, "installed");
  assert.equal(get(store).restartRequired, true);
});

test("a refused install shows Marasi's reason and installs nothing", async () => {
  const { store } = await withUpdate({
    "POST /update/install": refusal("POST /update/install", 409, {
      error: "development_build",
      message: "a development build does not check for or install updates",
    }),
  });
  await store.install();
  assert.match(get(store).error, /development build/);
  assert.equal(get(store).install.state, "idle");
});

test("an update.failed event ends the install with its reason", async () => {
  const { store } = await withUpdate({
    "POST /update/install": { joined: false, install: { state: "running", version: "v0.10.0" }, install_path: "/opt/marasi/marasi" },
  });
  await store.install();
  store.onFailed({ instance: "work", version: "v0.10.0", kind: "checksum", step: "verify", message: "checksum mismatch" });
  assert.equal(get(store).install.state, "failed");
  assert.match(get(store).error, /checksum mismatch/);
  assert.equal(get(store).restartRequired, false);
});

test("cancel stops the running install", async () => {
  const { store, calls } = await withUpdate({
    "POST /update/install": { joined: false, install: { state: "running", version: "v0.10.0" }, install_path: "/opt/marasi/marasi" },
    "DELETE /update/install": { install: { state: "idle" } },
  });
  await store.install();
  await store.cancel();
  assert.ok(calls.includes("DELETE /update/install"));
  assert.equal(get(store).install.state, "idle");
});

test("restart hands over to the installed build and shows its version", async () => {
  let restarted = false;
  const { api, calls } = fakeApi({
    routes: {
      "GET /service/status": () => status(restarted ? { version: "v0.10.0" } : { restart_required: true }),
      "GET /update": () => updateBody(restarted ? { installed: { version: "v0.10.0", channel: "release" } } : { restart_required: true }),
      "POST /service/restart": () => {
        restarted = true;
        return { instance: "work", status: "restarted", version: "v0.10.0", proxy_listener: "127.0.0.1:8080" };
      },
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.equal(get(store).restartRequired, true);

  const result = await store.restart();
  assert.deepEqual(result, { restarted: true });
  assert.ok(calls.includes("POST /service/restart"));
  assert.equal(get(store).version, "v0.10.0");
  assert.equal(get(store).restartRequired, false);
  assert.equal(get(store).restarting, false);
});

test("restart with held Checkpoint items asks first, and force drops them", async () => {
  const held = [{ id: "c1", type: "request", summary: "GET https://example.test/" }];
  const { api, calls } = fakeApi({
    routes: {
      "GET /service/status": status({ restart_required: true }),
      "GET /update": updateBody({ restart_required: true }),
      "POST /service/restart": (body) =>
        body?.force
          ? { instance: "work", status: "restarted", version: "v0.10.0", proxy_listener: null }
          : refusal("POST /service/restart", 409, { error: "checkpoint_items_held", message: "1 item held", items: held }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.deepEqual(await store.restart(), { held });
  assert.equal(get(store).error, null);
  assert.deepEqual(await store.restart({ force: true }), { restarted: true });
  assert.ok(calls.includes('POST /service/restart {"force":true}'));
});

test("service.restarting shows the restart until the stream reopens and reloads", async () => {
  const { api } = fakeApi({ routes: { "GET /service/status": status(), "GET /update": updateBody() } });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  store.onRestarting({ instance: "work", project: "/p.marasi", proxy_listener: null });
  assert.equal(get(store).restarting, true);
  await store.reload();
  assert.equal(get(store).restarting, false);
});

test("a failed restart rolls back and shows why", async () => {
  const { api } = fakeApi({
    routes: {
      "GET /service/status": status({ restart_required: true }),
      "GET /update": updateBody({ restart_required: true }),
      "POST /service/restart": refusal("POST /service/restart", 500, { error: "restart_failed", message: "successor exited", log: "/tmp/x.log" }),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.deepEqual(await store.restart(), { restarted: false });
  assert.match(get(store).error, /successor exited/);
  assert.equal(get(store).restarting, false);
  assert.equal(get(store).restartRequired, true);
});

test("service.restart_failed shows why", async () => {
  const { api } = fakeApi({ routes: { "GET /service/status": status(), "GET /update": updateBody() } });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  store.onRestarting({ instance: "work" });
  store.onRestartFailed({ instance: "work", error: "successor exited" });
  assert.equal(get(store).restarting, false);
  assert.match(get(store).error, /successor exited/);
});

test("an instance without the /update routes shows its version and no update actions", async () => {
  const { api } = fakeApi({
    routes: {
      "GET /service/status": status({ restart_required: true }),
      "GET /update": new NeedsNewerMarasi("GET /update", 404),
    },
  });
  const store = createInstanceUpdateStore(api);
  await store.reload();
  assert.equal(get(store).version, "v0.9.0");
  assert.equal(get(store).restartRequired, true);
  assert.equal(get(store).canUpdate, false);
});

test("after a disconnect the store shows no instance", async () => {
  const fake = fakeApi({ routes: { "GET /service/status": status(), "GET /update": updateBody({ available }) } });
  let connection = { instance: "work", remote: false };
  const store = createInstanceUpdateStore({ ...fake.api, connection: () => connection });
  await store.reload();
  connection = null;
  await store.reload();
  assert.equal(get(store).version, null);
  assert.equal(get(store).available, null);
  assert.equal(get(store).canUpdate, false);
});
