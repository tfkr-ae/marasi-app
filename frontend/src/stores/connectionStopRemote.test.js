// Stopping a remote from inside the app: the service's own stop route
// (POST /service/stop), after a warning that the app can't start it again.
// The remote then sits in `stopped`, which only Retry leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore, initialConnection, reduce } from "./createConnectionStore.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const lab = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };
const labStatus = { version: "dev", api: 1, run_id: "run-1", project: "/srv/acme.marasi", proxy_listener: "0.0.0.0:8080" };

// Runs `actions` through the reducer from a connected remote and returns
// the last state, the steps and the refusals.
function fromRemote(...actions) {
  let state = initialConnection();
  for (const action of [
    { type: "CONNECTIONS_LOADED", connections: [local, lab], activeId: "remote-1" },
    { type: "APP_STARTED" },
    { type: "CONNECTED", id: "remote-1", url: lab.url, status: labStatus },
  ])
    state = reduce(state, action).state;
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

test("a remote's Stop always asks first, since the app can't start it again", () => {
  const asked = fromRemote({ type: "STOP" });
  assert.deepEqual(asked.refusals, []);
  assert.equal(asked.state.stopAsk, true);
  assert.deepEqual(asked.types, []);
  assert.equal(asked.state.phase, "connected");

  const cancelled = fromRemote({ type: "STOP" }, { type: "CANCEL_STOP" });
  assert.equal(cancelled.state.stopAsk, false);
  assert.equal(cancelled.state.phase, "connected");
  assert.deepEqual(cancelled.types, []);
});

test("a confirmed remote Stop goes through the service's stop route and leads to stopped", () => {
  const stopping = fromRemote({ type: "STOP" }, { type: "STOP", confirmed: true });
  assert.deepEqual(stopping.types, ["close-events", "stop-service"]);
  assert.equal(stopping.state.busy, "stop");

  const { state, refusals } = fromRemote(
    { type: "STOP" },
    { type: "STOP", confirmed: true },
    { type: "STREAM_DROPPED" },
    { type: "INSTANCE_STOPPED" },
  );
  assert.deepEqual(refusals, []);
  assert.equal(state.phase, "stopped");
  assert.equal(state.connection.id, "remote-1");
});

test("a stopped remote offers no Start, and Retry reconnects", () => {
  const stopped = fromRemote({ type: "STOP", confirmed: true }, { type: "INSTANCE_STOPPED" });
  assert.equal(stopped.state.phase, "stopped");
  assert.notEqual(reduce(stopped.state, { type: "START" }).refusal, null);

  const retried = reduce(stopped.state, { type: "RETRY" });
  assert.equal(retried.state.phase, "connecting");
  assert.deepEqual(
    retried.steps.map((s) => s.type),
    ["connect-remote"],
  );
});

test("a refused remote Stop keeps the connection and resumes the stream, saying why", () => {
  const { state, steps, types } = fromRemote(
    { type: "STOP", confirmed: true },
    { type: "STOP_FAILED", error: "POST /service/stop: forbidden: origin not allowed" },
  );
  assert.equal(state.phase, "connected");
  assert.equal(state.busy, null);
  assert.equal(state.stopError, "POST /service/stop: forbidden: origin not allowed");
  assert.deepEqual(types, ["close-events", "stop-service", "open-events"]);
  assert.equal(steps.at(-1).resume, true);
});

// A fake api over the Go bindings and the service client, recording calls.
function fakeApi() {
  const calls = [];
  let onDrop = null;
  const link = { bound: true };
  const api = {
    listConnections: async () => ({ connections: [local, lab], activeId: "remote-1" }),
    connectionPassword: async (id) => {
      calls.push(["connectionPassword", id]);
      return "pw";
    },
    use: (connection) => calls.push(["use", connection?.url ?? null]),
    bind: () => link,
    sessionBegan: () => {},
    readStatus: async () => {
      calls.push("readStatus");
      return labStatus;
    },
    stopService: async (bound) => calls.push(["stopService", bound === link]),
    stopLocal: async (id) => calls.push(["stopLocal", id]),
    serviceStopped: async () => calls.push("serviceStopped"),
    openEvents: (handlers) => {
      calls.push(handlers.resume ? "resumeEvents" : "openEvents");
      onDrop = handlers.onDrop;
    },
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async (loaded) => calls.push(["loadProject", loaded.project]),
    reloadProject: async (loaded) => calls.push(["reloadProject", loaded.project]),
  };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  return { api, calls, timers, drop: () => onDrop?.({ status: null }) };
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

async function connectedRemote() {
  const fake = fakeApi();
  const store = createConnectionStore(fake.api, fake.timers);
  store.start();
  await reached(store, "connected");
  await settle();
  fake.calls.length = 0;
  return { store, ...fake };
}

test("confirmStop() on a remote posts the service's stop through the bound client, and Retry reconnects", async () => {
  const { store, calls, drop } = await connectedRemote();

  store.stop();
  assert.equal(get(store).stopAsk, true);
  store.confirmStop();
  await reached(store, "stopped");
  drop();
  await settle();
  assert.deepEqual(calls, ["closeEvents", ["stopService", true], "serviceStopped"]);
  assert.equal(get(store).phase, "stopped");

  calls.length = 0;
  store.retry();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(calls.slice(0, 3), [["connectionPassword", "remote-1"], ["use", lab.url], "readStatus"]);
});

test("a service that refuses the stop leaves the remote connected with the error", async () => {
  const { store, api, calls } = await connectedRemote();
  api.stopService = async () => {
    throw new Error("POST /service/stop: forbidden: origin not allowed");
  };

  store.confirmStop();
  await settle();
  await settle();
  const state = get(store);
  assert.equal(state.phase, "connected");
  assert.equal(state.stopError, "POST /service/stop: forbidden: origin not allowed");
  assert.deepEqual(calls, ["closeEvents", "resumeEvents"]);
});
