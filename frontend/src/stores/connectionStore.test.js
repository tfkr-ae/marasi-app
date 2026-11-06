// The connection store: reaching the local instance's service, as a pure
// reducer (state + steps) and the store that performs the steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore, initialConnection, reduce } from "./createConnectionStore.js";

// Runs `actions` through the reducer from the start, and returns the last
// state, every step in order, and the refusals.
function run(...actions) {
  let state = initialConnection();
  const steps = [];
  const refusals = [];
  for (const action of actions) {
    const next = reduce(state, action);
    if (next.refusal) refusals.push(next.refusal);
    state = next.state;
    steps.push(...next.steps.map((step) => step.type));
  }
  return { state, steps, refusals };
}

const status = { version: "dev", project: "/p/scratchpad.marasi", proxy_listener: "127.0.0.1:8080" };
const up = (startedByApp) => ({
  type: "INSTANCE_UP",
  url: "http://127.0.0.1:51391",
  password: "pw",
  startedByApp,
});

test("opening the app starts the local instance, connects and loads its project", () => {
  const { state, steps } = run({ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status });

  assert.equal(state.phase, "connected");
  assert.equal(state.owned, true);
  assert.equal(state.project, "/p/scratchpad.marasi");
  assert.equal(state.version, "dev");
  assert.deepEqual(steps, ["connect-local", "use", "read-status", "open-events", "load-project"]);
});

test("each phase on the way reads as starting, then connecting", () => {
  assert.equal(run({ type: "APP_STARTED" }).state.phase, "starting");
  assert.equal(run({ type: "APP_STARTED" }, up(false)).state.phase, "connecting");
});

test("an instance the app attached to isn't the app's to stop", () => {
  const { state } = run({ type: "APP_STARTED" }, up(false), { type: "CONNECTED", status });
  assert.equal(state.owned, false);
});

test("the password never lands in the store's state", () => {
  const { state } = run({ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status });
  assert.equal(JSON.stringify(state).includes('"pw"'), false);
});

test("a local instance that fails to start shows the CLI's error, and Retry starts again", () => {
  const failed = run({ type: "APP_STARTED" }, { type: "INSTANCE_FAILED", error: "address already in use" });
  assert.equal(failed.state.phase, "failed");
  assert.equal(failed.state.error, "address already in use");

  const retried = run(
    { type: "APP_STARTED" },
    { type: "INSTANCE_FAILED", error: "address already in use" },
    { type: "RETRY" },
  );
  assert.equal(retried.state.phase, "starting");
  assert.equal(retried.state.error, null);
  assert.deepEqual(retried.steps, ["connect-local", "connect-local"]);
});

test("a service that can't be reached fails the connection", () => {
  const { state } = run({ type: "APP_STARTED" }, up(true), { type: "CONNECT_FAILED", error: "unauthorized" });
  assert.equal(state.phase, "failed");
  assert.equal(state.error, "unauthorized");
});

test("a dropped stream fails the connection and closes the stream", () => {
  const { state, steps } = run({ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status }, { type: "STREAM_DROPPED" });
  assert.equal(state.phase, "failed");
  assert.equal(steps.at(-1), "close-events");
});

test("an action out of turn is refused and changes nothing", () => {
  const { state, refusals } = run({ type: "APP_STARTED" }, { type: "CONNECTED", status }, { type: "RETRY" });
  assert.equal(state.phase, "starting");
  assert.equal(refusals.length, 2);
});

// The store performs each step through `api`, recorded in `calls`.
function fakeApi({ connectLocal, readStatus } = {}) {
  const calls = [];
  let onDrop = null;
  const api = {
    connectLocal: async () => {
      calls.push("connectLocal");
      return connectLocal ? connectLocal() : { url: "http://127.0.0.1:51391", password: "pw", startedByApp: true };
    },
    use: (connection) => calls.push(["use", connection]),
    readStatus: async () => {
      calls.push("readStatus");
      return readStatus ? readStatus() : status;
    },
    openEvents: (handlers) => {
      calls.push("openEvents");
      onDrop = handlers.onDrop;
    },
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async (loaded) => calls.push(["loadProject", loaded.project]),
  };
  return { api, calls, drop: () => onDrop?.({ status: null }) };
}

// Resolves once the store reaches `phase`.
function reached(store, phase) {
  return new Promise((resolve) => {
    const stop = store.subscribe((state) => {
      if (state.phase !== phase) return;
      queueMicrotask(() => stop());
      resolve(state);
    });
  });
}

test("start() reaches the service through the api and loads its project", async () => {
  const { api, calls } = fakeApi();
  const store = createConnectionStore(api);

  store.start();
  await reached(store, "connected");
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(calls, [
    "connectLocal",
    ["use", { url: "http://127.0.0.1:51391", password: "pw" }],
    "readStatus",
    "openEvents",
    ["loadProject", "/p/scratchpad.marasi"],
  ]);
  assert.equal(get(store).owned, true);
});

test("a failed start shows the error, and retry() reaches the service", async () => {
  let attempts = 0;
  const { api } = fakeApi({
    connectLocal: () => {
      attempts++;
      if (attempts === 1) throw new Error("starting the local instance: instance_failed (): address already in use");
      return { url: "http://127.0.0.1:51391", password: "pw", startedByApp: false };
    },
  });
  const store = createConnectionStore(api);

  store.start();
  const failed = await reached(store, "failed");
  assert.match(failed.error, /address already in use/);

  store.retry();
  const connected = await reached(store, "connected");
  assert.equal(connected.owned, false);
});

test("a refused status fails the connection with the service's error", async () => {
  const { api } = fakeApi({
    readStatus: () => {
      throw new Error("GET /service/status: unauthorized: send the control password");
    },
  });
  const store = createConnectionStore(api);
  store.start();
  const failed = await reached(store, "failed");
  assert.match(failed.error, /unauthorized/);
});

test("a dropped stream fails the connection", async () => {
  const fake = fakeApi();
  const store = createConnectionStore(fake.api);
  store.start();
  await reached(store, "connected");
  fake.drop();
  const failed = await reached(store, "failed");
  assert.match(failed.error, /Lost connection/);
});
