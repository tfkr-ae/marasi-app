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

const status = { version: "dev", api: 1, run_id: "run-1", project: "/p/scratchpad.marasi", proxy_listener: "127.0.0.1:8080" };
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

const connected = [{ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status }];

// Runs `actions` after connecting, and returns the steps they added, with
// their details.
function after(...actions) {
  let state = run(...connected).state;
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

test("a dropped stream reconnects after a second, and the pages stay", () => {
  const { state, steps, types } = after({ type: "STREAM_DROPPED" });
  assert.equal(state.phase, "reconnecting");
  assert.equal(state.attempt, 1);
  assert.equal(state.project, "/p/scratchpad.marasi");
  assert.deepEqual(types, ["close-events", "wait"]);
  assert.equal(steps.at(-1).ms, 1000);
});

test("each failed attempt waits twice as long, up to 30 seconds", () => {
  const drops = Array.from({ length: 8 }, () => [{ type: "RECONNECT_NOW" }, { type: "STREAM_DROPPED" }]).flat();
  const { state, steps } = after({ type: "STREAM_DROPPED" }, ...drops);
  const waits = steps.filter((step) => step.type === "wait").map((step) => step.ms / 1000);
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 30, 30, 30, 30]);
  assert.equal(state.attempt, 9);
});

test("the wait's end or Retry now reaches the service again, once at a time", () => {
  const { state, types, refusals } = after({ type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, { type: "RECONNECT_NOW" });
  assert.equal(state.phase, "reconnecting");
  assert.deepEqual(types, ["close-events", "wait", "cancel-wait", "reconnect"]);
  assert.equal(refusals.length, 1);
});

test("a queue overflow drop reconnects like any other drop", () => {
  const { state, types } = after({ type: "STREAM_DROPPED", reason: "overflow" });
  assert.equal(state.phase, "reconnecting");
  assert.deepEqual(types, ["close-events", "wait"]);
});

const reconnected = (patch = {}) => ({
  type: "RECONNECTED",
  url: "http://127.0.0.1:51391",
  status: { ...status, ...patch },
});

test("reconnecting to the same run resumes the stream from the last event, with no resync", () => {
  const { state, steps, types } = after({ type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected());
  assert.equal(state.phase, "connected");
  assert.equal(state.attempt, 0);
  assert.equal(types.at(-1), "open-events");
  assert.equal(steps.at(-1).resume, true);
  assert.equal(types.includes("resync"), false);
});

test("the first connect opens a fresh stream", () => {
  const { steps } = reduce(run(connected[0], connected[1]).state, connected[2]);
  assert.deepEqual(steps[0], { type: "open-events", resume: false });
});

for (const reason of ["expired", "invalid"]) {
  test(`a resume the service answers with a ${reason} stream reset resyncs every store in place`, () => {
    const { state, types } = after(
      { type: "STREAM_DROPPED" },
      { type: "RECONNECT_NOW" },
      reconnected(),
      { type: "STREAM_RESET", reason },
    );
    assert.equal(state.phase, "connected");
    assert.equal(types.at(-1), "resync");
  });
}

test("a restarted stream reset asks about unsaved work, then loads the project in full", () => {
  const asked = after({ type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected(), { type: "STREAM_RESET", reason: "restarted" });
  assert.equal(asked.state.phase, "project-changed");
  assert.equal(asked.state.pendingProject, status.project);
  assert.deepEqual(asked.types.slice(-2), ["close-events", "confirm-load"]);

  const loaded = after(
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected(),
    { type: "STREAM_RESET", reason: "restarted" },
    { type: "LOAD_CONFIRMED" },
  );
  assert.equal(loaded.state.phase, "connected");
  assert.deepEqual(loaded.types.slice(-3), ["open-events", "reload-project", "refresh-status"]);
  assert.equal(loaded.steps.at(-3).resume, false);
});

test("the run a refreshed status reports is the one the next reconnect compares against", () => {
  const { types } = after(
    { type: "STREAM_RESET", reason: "restarted" },
    { type: "LOAD_CONFIRMED" },
    { type: "STATUS_REFRESHED", status: { ...status, run_id: "run-2" } },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ run_id: "run-2" }),
  );
  assert.equal(types.at(-1), "open-events");
});

test("a stream reset only counts while connected", () => {
  const { refusals } = after({ type: "STREAM_DROPPED" }, { type: "STREAM_RESET", reason: "expired" });
  assert.equal(refusals.length, 1);
});

test("a service without a run id resyncs in place on a reconnect", () => {
  const noRun = { ...status, run_id: undefined };
  const { steps } = run(
    { type: "APP_STARTED" },
    up(true),
    { type: "CONNECTED", status: noRun },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ run_id: undefined }),
  );
  assert.deepEqual(steps.slice(-2), ["open-events", "resync"]);
});

test("the project a switch loaded is the one a reconnect compares against", () => {
  const { types } = after(
    { type: "PROJECT_LOADED", path: "/p/acme.marasi" },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ project: "/p/acme.marasi" }),
  );
  assert.equal(types.at(-1), "open-events");
});

for (const [why, actions, patch] of [
  ["the service opened another project", [], { project: "/p/other.marasi" }],
  ["the service restarted (a new run id)", [], { run_id: "run-2" }],
]) {
  test(`when ${why}, a reconnect asks about unsaved work before the full load`, () => {
    const asked = after(...actions, { type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected(patch));
    assert.equal(asked.state.phase, "project-changed");
    assert.deepEqual(asked.types.at(-1), "confirm-load");
    assert.equal(asked.steps.at(-1).status.project, patch.project ?? status.project);

    const loaded = after(
      ...actions,
      { type: "STREAM_DROPPED" },
      { type: "RECONNECT_NOW" },
      reconnected(patch),
      { type: "LOAD_CONFIRMED" },
    );
    assert.equal(loaded.state.phase, "connected");
    assert.deepEqual(loaded.types.slice(-2), ["open-events", "reload-project"]);
    assert.equal(loaded.steps.at(-1).status.project, patch.project ?? status.project);
  });
}

test("declining the load keeps the pages and offers the load again", () => {
  const { state, types } = after(
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ project: "/p/other.marasi" }),
    { type: "LOAD_DECLINED" },
    { type: "LOAD_PROJECT" },
  );
  assert.equal(state.phase, "project-changed");
  assert.equal(state.project, "/p/scratchpad.marasi");
  assert.equal(state.pendingProject, "/p/other.marasi");
  assert.deepEqual(types.slice(-2), ["confirm-load", "confirm-load"]);
});

test("a restart's run id is the one the next reconnect compares against", () => {
  const { types } = after(
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ run_id: "run-2" }),
    { type: "LOAD_CONFIRMED" },
    { type: "STREAM_DROPPED" },
    { type: "RECONNECT_NOW" },
    reconnected({ run_id: "run-2" }),
  );
  assert.equal(types.at(-1), "open-events");
});

test("an action out of turn is refused and changes nothing", () => {
  const { state, refusals } = run({ type: "APP_STARTED" }, { type: "CONNECTED", status }, { type: "RETRY" });
  assert.equal(state.phase, "starting");
  assert.equal(refusals.length, 2);
});

// The store performs each step through `api`, recorded in `calls`. Timers
// are fake: `timers.fire()` ends the pending wait.
function fakeApi({ connectLocal, readStatus, confirmSwitch, confirmFollow } = {}) {
  const calls = [];
  let onDrop = null;
  let onReset = null;
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
      calls.push(handlers.resume ? "resumeEvents" : "openEvents");
      onDrop = handlers.onDrop;
      onReset = handlers.onReset;
    },
    closeEvents: () => calls.push("closeEvents"),
    loadProject: async (loaded) => calls.push(["loadProject", loaded.project]),
    resync: async () => calls.push("resync"),
    confirmSwitch: async () => {
      calls.push("confirmSwitch");
      return confirmSwitch ? confirmSwitch() : true;
    },
    confirmFollow: async (project) => {
      calls.push(["confirmFollow", project]);
      return confirmFollow ? confirmFollow() : true;
    },
    loadDeclined: () => calls.push("loadDeclined"),
    reloadProject: async (loaded) => calls.push(["reloadProject", loaded.project]),
    holdWrites: (on) => calls.push(["holdWrites", on]),
  };
  const pending = new Map();
  let nextTimer = 0;
  const timers = {
    setTimeout: (fn, ms) => {
      pending.set(++nextTimer, { fn, ms });
      return nextTimer;
    },
    clearTimeout: (id) => pending.delete(id),
    waits: () => [...pending.values()].map((timer) => timer.ms),
    fire() {
      const [[id, timer]] = pending;
      pending.delete(id);
      timer.fn();
    },
  };
  return { api, calls, timers, drop: () => onDrop?.({ status: null }), reset: (reason) => onReset?.(reason) };
}

// The calls minus the write holds around a project change.
const withoutHolds = (calls) => calls.filter((call) => call[0] !== "holdWrites");

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

const settle = () => new Promise((r) => setTimeout(r, 0));

test("start() reaches the service through the api and loads its project", async () => {
  const { api, calls } = fakeApi();
  const store = createConnectionStore(api);

  store.start();
  await reached(store, "connected");
  await settle();

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

// A store connected through a fake api, with its calls cleared. `options`
// apply from then on, so the first connect reaches `status`.
async function connectedStore(options = {}) {
  let connectedYet = false;
  const later = (name) => (...args) => (connectedYet && options[name] ? options[name](...args) : undefined);
  const fake = fakeApi({
    connectLocal: () => later("connectLocal")() ?? { url: "http://127.0.0.1:51391", password: "pw", startedByApp: true },
    readStatus: () => later("readStatus")() ?? status,
    confirmSwitch: () => later("confirmSwitch")() ?? true,
    confirmFollow: () => later("confirmFollow")() ?? true,
  });
  const store = createConnectionStore(fake.api, fake.timers);
  store.start();
  await reached(store, "connected");
  await settle();
  connectedYet = true;
  fake.calls.length = 0;
  return { store, ...fake };
}

test("a dropped stream waits, reaches the local instance again and resumes the stream, with no resync", async () => {
  const { store, calls, timers, drop } = await connectedStore();

  drop();
  assert.equal(get(store).phase, "reconnecting");
  assert.deepEqual(timers.waits(), [1000]);
  assert.deepEqual(calls, ["closeEvents"]);

  timers.fire();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(calls, [
    "closeEvents",
    "connectLocal",
    ["use", { url: "http://127.0.0.1:51391", password: "pw" }],
    "readStatus",
    "resumeEvents",
  ]);
  assert.equal(get(store).attempt, 0);
});

test("a failed attempt backs off, and Retry now skips the wait", async () => {
  let down = true;
  const { store, calls, timers, drop } = await connectedStore({
    readStatus: () => {
      if (down) throw Object.assign(new Error("GET /service/status: http_error: HTTP 503"), { status: 503 });
      return status;
    },
  });
  drop();
  timers.fire();
  await settle();
  assert.equal(get(store).attempt, 2);
  assert.deepEqual(timers.waits(), [2000]);

  down = false;
  store.retryNow();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(timers.waits(), []);
  assert.equal(calls.at(-1), "resumeEvents");
});

test("an overflow drop (the stream simply ends) resumes the same way", async () => {
  const { store, calls, timers, drop } = await connectedStore();
  drop();
  timers.fire();
  await reached(store, "connected");
  await settle();
  assert.equal(calls.at(-1), "resumeEvents");
  assert.equal(calls.includes("resync"), false);
});

for (const reason of ["expired", "invalid"]) {
  test(`a ${reason} stream reset after a resume resyncs every store in place`, async () => {
    const { store, calls, timers, drop, reset } = await connectedStore();
    drop();
    timers.fire();
    await reached(store, "connected");
    await settle();
    reset(reason);
    await settle();
    assert.deepEqual(calls.slice(-2), ["resumeEvents", "resync"]);
  });
}

test("a restarted stream reset loads the project in full once the guard agrees, and reads the new run id", async () => {
  let runID = "run-1";
  const { store, calls, timers, drop, reset } = await connectedStore({ readStatus: () => ({ ...status, run_id: runID }) });
  drop();
  timers.fire();
  await reached(store, "connected");
  await settle();
  runID = "run-2";
  reset("restarted");
  await settle();
  await settle();
  assert.deepEqual(withoutHolds(calls).slice(-5), ["closeEvents", "confirmSwitch", "openEvents", ["reloadProject", "/p/scratchpad.marasi"], "readStatus"]);
  assert.equal(get(store).runId, "run-2");
});

test("a project the service opened meanwhile loads in full once the guard agrees", async () => {
  const { store, calls, timers, drop } = await connectedStore({
    readStatus: () => ({ ...status, project: "/p/other.marasi" }),
  });
  drop();
  timers.fire();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(withoutHolds(calls).slice(-3), ["confirmSwitch", "openEvents", ["reloadProject", "/p/other.marasi"]]);
  assert.equal(get(store).project, "/p/other.marasi");
  assert.equal(calls.includes("resync"), false);
});

test("a service restarted meanwhile (a new run id) loads the project in full", async () => {
  const { store, calls, timers, drop } = await connectedStore({ readStatus: () => ({ ...status, run_id: "run-2" }) });
  drop();
  timers.fire();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(withoutHolds(calls).slice(-3), ["confirmSwitch", "openEvents", ["reloadProject", "/p/scratchpad.marasi"]]);
  assert.equal(calls.includes("resync"), false);
});

test("declining the guard holds writes and keeps the stream closed until Load is chosen", async () => {
  let agree = false;
  const { store, calls, timers, drop } = await connectedStore({
    readStatus: () => ({ ...status, project: "/p/other.marasi" }),
    confirmSwitch: () => agree,
  });
  drop();
  timers.fire();
  await reached(store, "project-changed");
  await settle();
  assert.deepEqual(calls.filter((call) => call === "openEvents" || call[0] === "holdWrites"), [["holdWrites", true]]);

  agree = true;
  store.loadPending();
  await reached(store, "connected");
  await settle();
  const after = calls.slice(calls.findIndex((call) => call === "confirmSwitch" ) + 1);
  assert.deepEqual(after.slice(-3), [["holdWrites", false], "openEvents", ["reloadProject", "/p/other.marasi"]]);
});

test("declining the guard keeps the pages until Load is chosen", async () => {
  let agree = false;
  const { store, calls, timers, drop } = await connectedStore({
    readStatus: () => ({ ...status, project: "/p/other.marasi" }),
    confirmSwitch: () => agree,
  });
  drop();
  timers.fire();
  await reached(store, "project-changed");
  await settle();
  assert.equal(calls.some((call) => call[0] === "reloadProject"), false);
  assert.equal(get(store).project, "/p/scratchpad.marasi");

  agree = true;
  store.loadPending();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(calls.at(-1), ["reloadProject", "/p/other.marasi"]);
});

// The API level warning: a service outside the API levels the app supports
// (SUPPORTED_API, 1..1) warns without blocking.
const connectedTo = (api) => [{ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status: { ...status, api } }];

test("a service in the supported API range doesn't warn", () => {
  const { state } = run(...connectedTo(1));
  assert.equal(state.api, 1);
  assert.equal(state.apiWarning, null);
});

test("a service with no API level is too old, and connects with a warning", () => {
  const { state } = run(...connectedTo(undefined));
  assert.equal(state.phase, "connected");
  assert.equal(state.apiWarning, "Service is too old for this app");
});

test("a service above the supported API range warns that it is newer", () => {
  assert.equal(run(...connectedTo(2)).state.apiWarning, "Service is newer than this app (API level 2)");
});

test("a reconnect to an updated service clears the warning", () => {
  const old = connectedTo(undefined);
  const before = run(...old, { type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" });
  const { state } = run(...old, { type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected({ api: 1, run_id: "run-2" }));
  assert.equal(before.state.apiWarning !== null, true);
  assert.equal(state.apiWarning, null);
});

test("the details name the service's instance", () => {
  const { state } = run({ type: "APP_STARTED" }, up(true), { type: "CONNECTED", status: { ...status, instance: "default" } });
  assert.equal(state.instance, "default");
});

test("a resume with no event id to send resyncs every store in place", () => {
  const { types } = after({ type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected(), { type: "STREAM_RESET", reason: "none" });
  assert.equal(types.at(-1), "resync");
});

// Another client (the Marasi CLI, another app) switches the service's
// project while the app is connected: the project store's standing listener
// hands the opened path on (followSwitch).
const other = "/p/other.marasi";

test("a project another client opened loads in full once the guard agrees", async () => {
  const { store, calls } = await connectedStore({ readStatus: () => ({ ...status, project: other }) });

  store.followSwitch(other);
  await reached(store, "connected");
  await settle();

  assert.deepEqual(withoutHolds(calls), [
    "readStatus",
    "closeEvents",
    ["confirmFollow", other],
    "openEvents",
    ["reloadProject", other],
  ]);
  assert.equal(get(store).project, other);
});

test("staying on a project another client replaced keeps the declined-load state until Load it", async () => {
  let agree = false;
  const { store, calls } = await connectedStore({
    readStatus: () => ({ ...status, project: other }),
    confirmFollow: () => agree,
  });

  store.followSwitch(other);
  await reached(store, "project-changed");
  await settle();

  assert.deepEqual(calls, [
    "readStatus",
    ["holdWrites", true],
    "closeEvents",
    ["confirmFollow", other],
    "loadDeclined",
  ]);
  assert.equal(get(store).project, "/p/scratchpad.marasi");
  assert.equal(get(store).pendingProject, other);

  agree = true;
  store.loadPending();
  await reached(store, "connected");
  await settle();
  assert.deepEqual(calls.at(-1), ["reloadProject", other]);
});

test("a replayed switch the service has since undone changes nothing", async () => {
  const { store, calls } = await connectedStore();

  store.followSwitch(other);
  await settle();

  assert.deepEqual(calls, ["readStatus"]);
  assert.equal(get(store).phase, "connected");
});

test("a followed switch counts only while connected, so a reconnect's own load isn't doubled", () => {
  const status2 = { ...status, project: other };
  const reconnecting = after({ type: "STREAM_DROPPED" }, { type: "FOLLOW_SWITCH", path: other });
  assert.deepEqual(reconnecting.types, ["close-events", "wait"]);
  assert.equal(reconnecting.refusals.length, 1);

  const pending = after(
    { type: "STREAM_RESET", reason: "restarted" },
    { type: "FOLLOW_SWITCH", path: other },
    { type: "SWITCH_CHECKED", status: status2 },
  );
  assert.deepEqual(pending.types, ["close-events", "confirm-load"]);
  assert.equal(pending.refusals.length, 2);
});

const restarting = { type: "SERVICE_RESTARTING", restart: { instance: "default", project: status.project } };

test("a restart announced by the service shows until the restarted service answers", () => {
  const announced = after(restarting);
  assert.equal(announced.state.restarting, true);
  assert.deepEqual(announced.types, []);

  const dropped = after(restarting, { type: "STREAM_DROPPED" });
  assert.equal(dropped.state.phase, "reconnecting");
  assert.equal(dropped.state.restarting, true);

  const back = after(restarting, { type: "STREAM_DROPPED" }, { type: "RECONNECT_NOW" }, reconnected({ run_id: "run-2" }));
  assert.equal(back.state.restarting, false);
  assert.equal(back.state.phase, "project-changed", "the new run loads the project in full");
});

test("a failed restart ends the restart with its error", () => {
  const { state } = after(restarting, { type: "SERVICE_RESTART_FAILED", failure: { instance: "default", error: "checkpoint has held items" } });
  assert.equal(state.restarting, false);
  assert.equal(state.restartError, "checkpoint has held items");
});

test("the next restart forgets the last one's error", () => {
  const { state } = after(restarting, { type: "SERVICE_RESTART_FAILED", failure: { error: "boom" } }, restarting);
  assert.equal(state.restartError, null);
  assert.equal(state.restarting, true);
});
