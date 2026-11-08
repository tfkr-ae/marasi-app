// Stop and Start from inside the app: the connection store's `stopped`
// phase, reached by stopping the active connection's instance and left only
// by the researcher's Start (local) or Retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore, initialConnection, reduce } from "./createConnectionStore.js";

const status = {
  version: "dev",
  api: 1,
  run_id: "run-1",
  project: "/p/engagement.marasi",
  proxy_listener: "127.0.0.1:8080",
};
const remote = {
  id: "remote-1",
  kind: "remote",
  name: "Lab",
  url: "http://10.0.0.5:8443",
};

// Runs `actions` through the reducer from a connected local connection
// (`owned` says whether the run is the app's) and returns the last state,
// the step types and the refusals.
function from(owned, ...actions) {
  let state = initialConnection();
  const all = [
    { type: "APP_STARTED" },
    {
      type: "INSTANCE_UP",
      url: "http://127.0.0.1:51391",
      password: "pw",
      startedByApp: owned,
    },
    { type: "CONNECTED", status },
  ];
  for (const action of all) state = reduce(state, action).state;
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

test("Stop of an owned run closes the stream and stops the instance, then the store is stopped", () => {
  const stopping = from(true, { type: "STOP" });
  assert.deepEqual(stopping.types, ["close-events", "stop-instance"]);
  assert.equal(stopping.steps[1].id, "local");

  const { state, refusals } = from(true, { type: "STOP" }, { type: "STREAM_DROPPED" }, { type: "INSTANCE_STOPPED" });
  assert.deepEqual(refusals, []);
  assert.equal(state.phase, "stopped");
  assert.equal(state.owned, false);
  // The pages keep the project they show, which Start opens again.
  assert.equal(state.project, "/p/engagement.marasi");
});

test("Stop of a run the app doesn't own asks first, and Cancel keeps it running", () => {
  const asked = from(false, { type: "STOP" });
  assert.equal(asked.state.stopAsk, true);
  assert.deepEqual(asked.types, []);
  assert.equal(asked.state.phase, "connected");

  const cancelled = from(false, { type: "STOP" }, { type: "CANCEL_STOP" });
  assert.equal(cancelled.state.stopAsk, false);
  assert.deepEqual(cancelled.types, []);

  const confirmed = from(false, { type: "STOP" }, { type: "STOP", confirmed: true }, { type: "INSTANCE_STOPPED" });
  assert.deepEqual(confirmed.types, ["close-events", "stop-instance"]);
  assert.equal(confirmed.state.phase, "stopped");
  assert.equal(confirmed.state.stopAsk, false);
});

test("a failed Stop keeps the connection and resumes the stream, saying why", () => {
  const { state, types } = from(true, { type: "STOP" }, { type: "STOP_FAILED", error: "permission denied" });
  assert.equal(state.phase, "connected");
  assert.equal(state.busy, null);
  assert.equal(state.stopError, "permission denied");
  assert.deepEqual(types, ["close-events", "stop-instance", "open-events"]);
  assert.equal(from(true, { type: "STOP" }, { type: "STOP_FAILED", error: "x" }).steps.at(-1).resume, true);
});

test("nothing leaves stopped by itself", () => {
  const { state, types } = from(
    true,
    { type: "STOP" },
    { type: "INSTANCE_STOPPED" },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    { type: "STREAM_RESET", reason: "restarted" },
    { type: "FOLLOW_SWITCH", path: "/p/other.marasi" },
    { type: "STATUS_REFRESHED", status },
    { type: "SERVICE_RESTARTING" },
  );
  assert.equal(state.phase, "stopped");
  assert.deepEqual(types, ["close-events", "stop-instance"]);
});

test("Start from stopped begins a session that starts the instance on its project", () => {
  const stopped = from(true, { type: "STOP" }, { type: "INSTANCE_STOPPED" });
  const { state, steps } = reduce(stopped.state, { type: "START" });
  assert.equal(state.phase, "starting");
  assert.equal(state.session, stopped.state.session + 1);
  assert.deepEqual(steps, [{ type: "start-local", id: "local", project: "/p/engagement.marasi" }]);
});

test("Start is only for a stopped local connection; a stopped remote offers Retry", () => {
  assert.equal(from(true, { type: "START" }).refusals.length, 1);

  const stoppedRemote = {
    ...initialConnection(),
    phase: "stopped",
    connection: remote,
    connections: [remote],
  };
  assert.notEqual(reduce(stoppedRemote, { type: "START" }).refusal, null);
  const retried = reduce(stoppedRemote, { type: "RETRY" });
  assert.equal(retried.state.phase, "connecting");
  assert.deepEqual(
    retried.steps.map((s) => s.type),
    ["connect-remote"],
  );
});

// A fake api over the Go bindings and the service client, recording calls.
function fakeApi({ connectLocal } = {}) {
  const calls = [];
  let onDrop = null;
  const pending = new Map();
  let nextTimer = 0;
  const api = {
    connectLocal: async (id) => {
      calls.push(["connectLocal", id]);
      return connectLocal ? connectLocal() : { url: "http://127.0.0.1:51391", password: "pw", startedByApp: true };
    },
    stopLocal: async (id) => calls.push(["stopLocal", id]),
    startLocal: async (id, project) => calls.push(["startLocal", id, project]),
    use: (connection) => calls.push(["use", connection?.url ?? null]),
    readStatus: async () => {
      calls.push("readStatus");
      return status;
    },
    openEvents: (handlers) => {
      calls.push(handlers.resume ? "resumeEvents" : "openEvents");
      onDrop = handlers.onDrop;
    },
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async (loaded) => calls.push(["loadProject", loaded.project]),
    reloadProject: async (loaded) => calls.push(["reloadProject", loaded.project]),
  };
  const timers = {
    setTimeout: (fn, ms) => {
      pending.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearTimeout: (id) => pending.delete(id),
    waits: () => [...pending.values()].map((timer) => timer.ms),
  };
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

async function connectedStore(options) {
  const fake = fakeApi(options);
  const store = createConnectionStore(fake.api, fake.timers);
  store.start();
  await reached(store, "connected");
  await settle();
  fake.calls.length = 0;
  return { store, ...fake };
}

test("stop() stops the local instance through Go and the store stays stopped after the stream drops", async () => {
  const { store, calls, timers, drop } = await connectedStore();

  assert.equal(store.stop(), null);
  await reached(store, "stopped");
  drop();
  await settle();

  assert.deepEqual(calls, ["closeEvents", ["stopLocal", "local"]]);
  assert.equal(get(store).phase, "stopped");
  assert.deepEqual(timers.waits(), []);
});

test("start() from stopped starts the instance on its project and loads it in full", async () => {
  const { store, calls } = await connectedStore();
  store.stop();
  await reached(store, "stopped");
  calls.length = 0;

  store.startInstance();
  const connected = await reached(store, "connected");
  await settle();

  assert.deepEqual(calls, [
    ["startLocal", "local", "/p/engagement.marasi"],
    ["connectLocal", "local"],
    ["use", "http://127.0.0.1:51391"],
    "readStatus",
    "openEvents",
    ["reloadProject", "/p/engagement.marasi"],
  ]);
  assert.equal(connected.owned, true);
});

test("a failed Start shows the error, and Retry tries to reach the instance again", async () => {
  const { store, api } = await connectedStore();
  store.stop();
  await reached(store, "stopped");
  api.startLocal = async () => {
    throw new Error("starting the local instance: instance_failed (): no such file");
  };

  store.startInstance();
  const failed = await reached(store, "failed");
  assert.match(failed.error, /no such file/);
});
