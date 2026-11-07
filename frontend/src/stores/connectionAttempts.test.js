// The connection store when an older attempt answers late: each connect,
// switch, Retry or edited address begins a new session, and what an older
// session's effects learn after an await changes nothing (the service
// client, /events, the stores, the state).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const alpha = { id: "alpha", kind: "remote", name: "Alpha", url: "http://10.0.0.1:9000" };
const beta = { id: "beta", kind: "remote", name: "Beta", url: "http://10.0.0.2:9000" };
const localUrl = "http://127.0.0.1:51391";
const statusOf = (project) => ({ version: "dev", api: 1, run_id: `run-${project}`, project });

// A fake api whose async calls stay pending until the test resolves them:
// `fake.next(name)` is the oldest pending call of `name`.
function fakeApi(saved) {
  const calls = [];
  const pending = [];
  const handlers = {};
  let client = null;
  const held = (name, args) =>
    new Promise((resolve, reject) => {
      calls.push([name, ...args]);
      pending.push({ name, args, resolve, reject });
    });
  const api = {
    listConnections: async () => saved(),
    connectLocal: () => held("connectLocal", []),
    connectionPassword: (id) => held("connectionPassword", [id]),
    readStatus: () => held("readStatus", [client?.url]),
    confirmSwitch: async () => true,
    confirmFollow: async () => true,
    setActive: async () => {},
    clearStores: async () => calls.push(["clearStores"]),
    use: (connection) => {
      client = connection;
      calls.push(["use", connection.url]);
    },
    openEvents: (h) => {
      Object.assign(handlers, h);
      calls.push(["openEvents"]);
    },
    closeEvents: () => calls.push(["closeEvents"]),
    loadProject: async (status) => calls.push(["loadProject", status.project]),
    reloadProject: async (status) => calls.push(["reloadProject", status.project]),
    resync: async () => calls.push(["resync"]),
    loadDeclined: () => {},
    holdWrites: () => {},
  };
  const timers = {
    waiting: null,
    setTimeout(fn) {
      this.waiting = fn;
      return 1;
    },
    clearTimeout() {
      this.waiting = null;
    },
  };
  return {
    api,
    calls,
    timers,
    client: () => client,
    handlers,
    next(name) {
      const at = pending.findIndex((call) => call.name === name);
      assert.notEqual(at, -1, `no pending ${name}`);
      return pending.splice(at, 1)[0];
    },
  };
}

// Lets every settled promise run its continuation.
const settle = () => new Promise((r) => setTimeout(r, 0));

async function startedOn(activeId, connections = [local, alpha, beta]) {
  let list = connections;
  const fake = fakeApi(() => ({ connections: list, activeId }));
  const store = createConnectionStore(fake.api, fake.timers);
  store.start();
  await settle();
  return { store, ...fake, setConnections: (next) => (list = next) };
}

// Switches to remote `id` and lets it connect with `project`.
async function switchAndConnect(fake, store, id, project) {
  store.switchTo(id);
  await settle();
  fake.next("connectionPassword").resolve(`pw-${id}`);
  await settle();
  fake.next("readStatus").resolve(statusOf(project));
  await settle();
}

test("a remote's password arriving after a switch leaves the client on the connection switched to", async () => {
  const fake = await startedOn("alpha");
  const { store } = fake;
  const alphaPassword = fake.next("connectionPassword");

  await switchAndConnect(fake, store, "beta", "/srv/beta.marasi");
  assert.equal(get(store).phase, "connected");
  assert.equal(fake.client().url, beta.url);
  fake.calls.length = 0;

  alphaPassword.resolve("pw-alpha");
  await settle();

  assert.equal(fake.client().url, beta.url);
  assert.deepEqual(fake.calls, []);
  assert.equal(get(store).connection.id, "beta");
  assert.equal(get(store).url, beta.url);
  assert.equal(get(store).project, "/srv/beta.marasi");
});

test("a failure arriving after a switch doesn't fail the connection switched to", async () => {
  const fake = await startedOn("alpha");
  const { store } = fake;
  const alphaPassword = fake.next("connectionPassword");

  store.switchTo("beta");
  await settle();
  alphaPassword.reject(new Error("keychain locked"));
  await settle();

  assert.equal(get(store).phase, "connecting");
  assert.equal(get(store).error, null);
});

test("an edited address begins a new attempt, and the old attempt's answers change nothing", async () => {
  const fake = await startedOn("alpha");
  const { store } = fake;
  const first = fake.next("connectionPassword");

  const moved = { ...alpha, url: "http://10.0.0.9:9000" };
  fake.setConnections([local, moved, beta]);
  await store.load();
  await settle();
  const second = fake.next("connectionPassword");

  // The first attempt answers first: it neither points the client at the
  // old address nor connects there.
  first.resolve("pw-alpha");
  await settle();
  assert.equal(fake.client(), null);
  assert.equal(get(store).phase, "connecting");

  second.resolve("pw-alpha");
  await settle();
  assert.equal(fake.client().url, moved.url);
  fake.next("readStatus").resolve(statusOf("/srv/alpha.marasi"));
  await settle();
  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).url, moved.url);
});

test("an older attempt's status read answering during the newer one is ignored", async () => {
  const fake = await startedOn("alpha");
  const { store } = fake;
  fake.next("connectionPassword").resolve("pw-alpha");
  await settle();
  const oldStatus = fake.next("readStatus");

  const moved = { ...alpha, url: "http://10.0.0.9:9000" };
  fake.setConnections([local, moved, beta]);
  await store.load();
  await settle();

  oldStatus.resolve(statusOf("/srv/old.marasi"));
  await settle();
  assert.equal(get(store).phase, "connecting");
  assert.equal(fake.calls.some(([name]) => name === "openEvents"), false);

  fake.next("connectionPassword").resolve("pw-alpha");
  await settle();
  fake.next("readStatus").resolve(statusOf("/srv/alpha.marasi"));
  await settle();
  assert.equal(get(store).url, moved.url);
  assert.equal(get(store).project, "/srv/alpha.marasi");
});

// Connected to the local instance, with the calls cleared.
async function connectedLocal() {
  const fake = await startedOn("local");
  fake.next("connectLocal").resolve({ url: localUrl, password: "pw", startedByApp: true });
  await settle();
  fake.next("readStatus").resolve(statusOf("/p/scratchpad.marasi"));
  await settle();
  assert.equal(get(fake.store).phase, "connected");
  fake.calls.length = 0;
  return fake;
}

test("a reconnect that reaches the local instance after a switch leaves the client and stream alone", async () => {
  const fake = await connectedLocal();
  const { store } = fake;
  fake.handlers.onDrop({ status: null });
  fake.timers.waiting();
  await settle();
  const reconnect = fake.next("connectLocal");

  await switchAndConnect(fake, store, "beta", "/srv/beta.marasi");
  fake.calls.length = 0;

  reconnect.resolve({ url: localUrl, password: "pw", startedByApp: false });
  await settle();
  assert.equal(fake.client().url, beta.url);
  assert.deepEqual(fake.calls, []);
});

test("a reconnect's status read answering after a switch is ignored", async () => {
  const fake = await connectedLocal();
  const { store } = fake;
  fake.handlers.onDrop({ status: null });
  fake.timers.waiting();
  await settle();
  fake.next("connectLocal").resolve({ url: localUrl, password: "pw", startedByApp: false });
  await settle();
  const reconnectStatus = fake.next("readStatus");

  store.switchTo("beta");
  await settle();
  fake.calls.length = 0;

  // Beta is still connecting: the old reconnect's answer must not connect it.
  reconnectStatus.resolve({ ...statusOf("/p/scratchpad.marasi"), run_id: undefined });
  await settle();
  assert.equal(get(store).phase, "connecting");
  assert.deepEqual(fake.calls, []);
});

test("a followed switch read after a switch of connection loads nothing", async () => {
  const fake = await connectedLocal();
  const { store } = fake;
  store.followSwitch("/p/other.marasi");
  const check = fake.next("readStatus");

  await switchAndConnect(fake, store, "beta", "/srv/beta.marasi");
  fake.calls.length = 0;

  check.resolve(statusOf("/p/other.marasi"));
  await settle();
  assert.deepEqual(fake.calls, []);
  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).project, "/srv/beta.marasi");
});

test("a drop from the stream of the connection switched away from is ignored", async () => {
  const fake = await connectedLocal();
  const { store } = fake;
  const oldDrop = fake.handlers.onDrop;
  const oldReset = fake.handlers.onReset;

  await switchAndConnect(fake, store, "beta", "/srv/beta.marasi");
  fake.calls.length = 0;

  oldDrop({ status: null });
  oldReset("expired");
  await settle();
  assert.equal(get(store).phase, "connected");
  assert.deepEqual(fake.calls, []);
});

test("a project load still running when the app switches learns that its attempt has ended", async () => {
  const fake = await startedOn("local");
  const { store } = fake;
  let loading = null;
  fake.api.loadProject = (status, options) => {
    loading = options;
    return new Promise(() => {});
  };
  fake.next("connectLocal").resolve({ url: localUrl, password: "pw", startedByApp: true });
  await settle();
  fake.next("readStatus").resolve(statusOf("/p/scratchpad.marasi"));
  await settle();
  assert.equal(loading.current(), true);

  store.switchTo("beta");
  await settle();
  assert.equal(loading.current(), false);
});
