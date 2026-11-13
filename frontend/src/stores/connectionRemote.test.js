// The connection store with remote connections: reaching a remote with its
// saved password, a refused password, and switching between connections
// behind the unsaved-work guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore, initialConnection, reduce } from "./createConnectionStore.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const lab = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };
const saved = { type: "CONNECTIONS_LOADED", connections: [local, lab], activeId: "local" };
const status = { version: "dev", project: "/p/scratchpad.marasi", proxy_listener: "127.0.0.1:8080" };
const labStatus = { version: "dev", project: "/srv/acme.marasi", proxy_listener: "0.0.0.0:8080", instance: "default" };
const refused = Object.assign(new Error("GET /service/status: unauthorized: send the control password"), {
  status: 401,
  code: "unauthorized",
});

function run(...actions) {
  let state = initialConnection();
  const steps = [];
  const refusals = [];
  for (const action of actions) {
    const next = reduce(state, action);
    if (next.refusal) refusals.push(next.refusal);
    state = next.state;
    steps.push(...next.steps);
  }
  return { state, steps, types: steps.map((step) => step.type), refusals };
}

test("the saved connections load, and the active one is reached on start", () => {
  const { state, types } = run({ ...saved, activeId: "remote-1" }, { type: "APP_STARTED" });
  assert.deepEqual(
    state.connections.map((c) => c.id),
    ["local", "remote-1"],
  );
  assert.equal(state.connection.id, "remote-1");
  assert.equal(state.phase, "connecting");
  assert.deepEqual(types, ["connect-remote"]);
});

test("an unknown active id falls back to the local connection", () => {
  const { state } = run({ ...saved, activeId: "gone" });
  assert.equal(state.connection.id, "local");
});

test("a remote connects, loads its project and keeps its kind", () => {
  const { state, types } = run({ ...saved, activeId: "remote-1" }, { type: "APP_STARTED" }, {
    type: "CONNECTED",
    id: "remote-1",
    url: lab.url,
    status: labStatus,
  });
  assert.equal(state.phase, "connected");
  assert.equal(state.connection.kind, "remote");
  assert.equal(state.url, lab.url);
  assert.equal(state.owned, false);
  assert.deepEqual(types, ["connect-remote", "open-events", "load-project"]);
});

test("a refused password asks for it and never retries on a timer", () => {
  const { state, types } = run({ ...saved, activeId: "remote-1" }, { type: "APP_STARTED" }, {
    type: "AUTH_REJECTED",
    id: "remote-1",
  });
  assert.equal(state.phase, "auth-failed");
  assert.equal(types.includes("wait"), false);
});

test("a password refused while reconnecting stops the reconnects", () => {
  const { state, types } = run(
    { ...saved, activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "CONNECTED", id: "remote-1", url: lab.url, status: labStatus },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    { type: "AUTH_REJECTED", id: "remote-1" },
  );
  assert.equal(state.phase, "auth-failed");
  assert.equal(state.attempt, 0);
  assert.equal(types.at(-1), "cancel-wait");
});

test("entering the password saves it, then connects again", () => {
  const { state, steps, types } = run(
    { ...saved, activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "AUTH_REJECTED", id: "remote-1" },
    { type: "ENTER_PASSWORD", password: "right" },
  );
  assert.equal(types.at(-1), "save-password");
  assert.deepEqual(steps.at(-1), { type: "save-password", id: "remote-1", password: "right" });
  assert.equal(JSON.stringify(state).includes("right"), false);

  const after = reduce(state, { type: "PASSWORD_SAVED", id: "remote-1" });
  assert.equal(after.state.phase, "connecting");
  assert.deepEqual(after.steps.map((s) => s.type), ["connect-remote"]);
});

test("a password entered after a refused reconnect resumes the reconnect", () => {
  const { state } = run(
    { ...saved, activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "CONNECTED", id: "remote-1", url: lab.url, status: labStatus },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    { type: "AUTH_REJECTED", id: "remote-1" },
    { type: "ENTER_PASSWORD", password: "right" },
  );
  const after = reduce(state, { type: "PASSWORD_SAVED", id: "remote-1" });
  assert.equal(after.state.phase, "reconnecting");
  assert.deepEqual(after.steps.map((s) => s.type), ["reconnect"]);
});

test("a password can only be entered while one is asked for", () => {
  const { refusals } = run(saved, { type: "ENTER_PASSWORD", password: "x" });
  assert.equal(refusals.length, 1);
});

test("switching asks about unsaved work first", () => {
  const { state, steps, refusals } = run(saved, { type: "APP_STARTED" }, { type: "SWITCH_CONNECTION", id: "remote-1" });
  assert.deepEqual(refusals, []);
  assert.deepEqual(steps.at(-1), { type: "confirm-leave", id: "remote-1" });
  assert.equal(state.connection.id, "local");
});

test("a confirmed switch closes the stream, clears the stores and reaches the other service", () => {
  const { state, types } = run(
    saved,
    { type: "APP_STARTED" },
    { type: "INSTANCE_UP", url: "http://127.0.0.1:51391", password: "pw", startedByApp: true },
    { type: "CONNECTED", status },
    { type: "SWITCH_CONNECTION", id: "remote-1" },
    { type: "SWITCH_CONFIRMED", id: "remote-1" },
  );
  assert.equal(state.connection.id, "remote-1");
  assert.equal(state.phase, "connecting");
  assert.equal(state.project, null);
  // The local instance keeps running until quit: still the app's to stop.
  assert.equal(state.owned, true);
  assert.deepEqual(types.slice(-5), ["close-events", "cancel-wait", "set-active", "clear-stores", "connect-remote"]);

  const connected = reduce(state, { type: "CONNECTED", id: "remote-1", url: lab.url, status: labStatus });
  // The pages remount on the other service's project.
  assert.deepEqual(connected.steps.map((s) => s.type), ["open-events", "reload-project"]);
});

test("switching to the active or an unknown connection is refused", () => {
  const { refusals } = run(saved, { type: "SWITCH_CONNECTION", id: "local" }, { type: "SWITCH_CONNECTION", id: "nope" });
  assert.equal(refusals.length, 2);
});

test("a result for the connection switched away from is ignored", () => {
  const { state, refusals } = run(
    { ...saved, activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "SWITCH_CONNECTION", id: "local" },
    { type: "SWITCH_CONFIRMED", id: "local" },
    { type: "AUTH_REJECTED", id: "remote-1" },
  );
  assert.equal(state.phase, "starting");
  assert.equal(refusals.length, 1);
});

test("an edited address of the active remote reaches it again", () => {
  const { state, types } = run(
    { ...saved, activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "AUTH_REJECTED", id: "remote-1" },
    { type: "CONNECTIONS_LOADED", connections: [local, { ...lab, url: "http://10.0.0.7:9000" }], activeId: "remote-1" },
  );
  assert.equal(state.connection.url, "http://10.0.0.7:9000");
  assert.equal(state.phase, "connecting");
  assert.equal(types.at(-1), "connect-remote");
});

// The store, with a fake api.
function fakeApi(overrides = {}) {
  const calls = [];
  let onDrop = null;
  const passwords = { "remote-1": "pw-lab" };
  const api = {
    listConnections: async () => ({ connections: [local, lab], activeId: "local" }),
    connectLocal: async () => {
      calls.push("connectLocal");
      return { url: "http://127.0.0.1:51391", password: "pw", startedByApp: true };
    },
    connectionPassword: async (id) => {
      calls.push(["connectionPassword", id]);
      return passwords[id];
    },
    savePassword: async (id, password) => {
      calls.push(["savePassword", id]);
      passwords[id] = password;
    },
    setActive: async (id) => calls.push(["setActive", id]),
    clearStores: async () => calls.push("clearStores"),
    use: (connection) => calls.push(["use", connection]),
    readStatus: async () => {
      calls.push("readStatus");
      return overrides.readStatus ? overrides.readStatus() : status;
    },
    openEvents: (handlers) => {
      calls.push("openEvents");
      onDrop = handlers.onDrop;
    },
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async (loaded) => calls.push(["loadProject", loaded.project]),
    resync: async () => calls.push("resync"),
    confirmSwitch: async () => {
      calls.push("confirmSwitch");
      return overrides.confirmSwitch ? overrides.confirmSwitch() : true;
    },
    reloadProject: async (loaded) => calls.push(["reloadProject", loaded.project]),
  };
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  return { api, calls, timers, passwords, drop: () => onDrop?.({ status: null }) };
}

function reached(store, phase) {
  return new Promise((resolve) => {
    const stop = store.subscribe((state) => {
      if (state.phase !== phase) return;
      queueMicrotask(() => stop());
      resolve(state);
    });
  });
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("the store switches to a remote and back, with the guard each time", async () => {
  let onRemote = false;
  const fake = fakeApi({ readStatus: () => (onRemote ? labStatus : status) });
  const store = createConnectionStore(fake.api, fake.timers);
  await store.load();
  store.start();
  await reached(store, "connected");
  await settle();
  fake.calls.length = 0;

  onRemote = true;
  store.switchTo("remote-1");
  await reached(store, "connected");
  await settle();
  assert.deepEqual(fake.calls, [
    "confirmSwitch",
    "closeEvents",
    ["setActive", "remote-1"],
    "clearStores",
    ["connectionPassword", "remote-1"],
    ["use", { url: lab.url, password: "pw-lab" }],
    "readStatus",
    "openEvents",
    ["reloadProject", "/srv/acme.marasi"],
  ]);
  assert.equal(get(store).connection.kind, "remote");

  fake.calls.length = 0;
  onRemote = false;
  store.switchTo("local");
  await reached(store, "connected");
  await settle();
  assert.equal(fake.calls[0], "confirmSwitch");
  assert.equal(fake.calls.includes("connectLocal"), true);
  assert.deepEqual(fake.calls.at(-1), ["reloadProject", "/p/scratchpad.marasi"]);
});

test("declining the guard stays on the connection", async () => {
  const fake = fakeApi({ confirmSwitch: () => false });
  const store = createConnectionStore(fake.api, fake.timers);
  await store.load();
  store.start();
  await reached(store, "connected");
  await settle();
  fake.calls.length = 0;

  store.switchTo("remote-1");
  await settle();
  await settle();
  assert.deepEqual(fake.calls, ["confirmSwitch"]);
  assert.equal(get(store).connection.id, "local");
  assert.equal(get(store).phase, "connected");
});

test("a refused password asks, and the right one connects", async () => {
  let password = "pw-lab";
  const fake = fakeApi({
    readStatus: () => {
      if (password !== "right") throw refused;
      return labStatus;
    },
  });
  fake.api.listConnections = async () => ({ connections: [local, lab], activeId: "remote-1" });
  fake.api.use = (connection) => {
    password = connection.password;
    fake.calls.push(["use", connection]);
  };
  const store = createConnectionStore(fake.api, fake.timers);
  await store.load();
  store.start();
  const asked = await reached(store, "auth-failed");
  assert.match(asked.error, /refused the password/);

  store.enterPassword("right");
  await reached(store, "connected");
  await settle();
  assert.equal(fake.passwords["remote-1"], "right");
  assert.deepEqual(fake.calls.at(-1), ["loadProject", "/srv/acme.marasi"]);
});

test("a phone starts on its first saved remote, not the local instance", () => {
  const { state, types } = run(saved, { type: "APP_STARTED", remoteOnly: true });
  assert.equal(state.connection.id, "remote-1");
  assert.equal(state.phase, "connecting");
  assert.deepEqual(types, ["set-active", "connect-remote"]);
});

test("a phone with no remote waits unpaired, reaching for nothing", () => {
  const { state, types } = run(
    { type: "CONNECTIONS_LOADED", connections: [local], activeId: "local" },
    { type: "APP_STARTED", remoteOnly: true },
  );
  assert.equal(state.phase, "unpaired");
  assert.deepEqual(types, []);
});

test("pairing a remote from unpaired switches to it", () => {
  const { state, types } = run(
    { type: "CONNECTIONS_LOADED", connections: [local], activeId: "local" },
    { type: "APP_STARTED", remoteOnly: true },
    { type: "CONNECTIONS_LOADED", connections: [local, lab], activeId: "local" },
    { type: "SWITCH_CONNECTION", id: "remote-1" },
    { type: "SWITCH_CONFIRMED", id: "remote-1" },
  );
  assert.equal(state.connection.id, "remote-1");
  assert.equal(state.phase, "connecting");
  assert.ok(types.includes("connect-remote"));
});
