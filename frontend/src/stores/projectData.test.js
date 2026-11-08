// The registry of stores that hold the service's project data: the full
// load after a switch, and the in-place resync after a reconnect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectData } from "./projectData.js";

// A store that records what the registry asks of it.
function recorder(calls, name, { fails = false } = {}) {
  return {
    clear: () => calls.push(`${name}.clear`),
    load: async () => calls.push(`${name}.load`),
    resync: async () => {
      calls.push(`${name}.resync`);
      if (fails) throw new Error(`${name} is down`);
    },
  };
}

test("a load clears every store, then loads each", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "home"));
  data.register("ledger", recorder(calls, "ledger"));

  await data.load();

  assert.deepEqual(calls, ["home.clear", "ledger.clear", "home.load", "ledger.load"]);
});

test("a resync runs every store's resync and clears nothing", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "home"));
  data.register("ledger", recorder(calls, "ledger"));

  await data.resync();

  assert.deepEqual(calls.sort(), ["home.resync", "ledger.resync"]);
});

test("a store with nothing local resyncs by loading again", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("scope", { load: async () => calls.push("scope.load") });

  await data.resync();

  assert.deepEqual(calls, ["scope.load"]);
});

test("one store's failed resync doesn't stop the others", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "home", { fails: true }));
  data.register("ledger", recorder(calls, "ledger"));

  const failures = await data.resync();

  assert.deepEqual(calls, ["home.resync", "ledger.resync"]);
  assert.deepEqual(failures.map((f) => f.name), ["home"]);
});

test("registering a name again replaces it, so a reloaded module isn't counted twice", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "old"));
  data.register("home", recorder(calls, "home"));

  await data.resync();

  assert.deepEqual(calls, ["home.resync"]);
});

test("clear() forgets every store's data and loads nothing, as when leaving a connection", () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "home"));
  data.register("ledger", recorder(calls, "ledger"));

  data.clear();

  assert.deepEqual(calls, ["home.clear", "ledger.clear"]);
});

// A store whose load stays pending until the test settles it.
function heldStore(calls, name) {
  const store = { settle: null, fail: null };
  store.entry = {
    clear: () => calls.push(`${name}.clear`),
    load: () =>
      new Promise((resolve, reject) => {
        calls.push(`${name}.load`);
        store.settle = resolve;
        store.fail = reject;
      }),
  };
  return store;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test("a load starts every store's load before any one of them resolves", async () => {
  const calls = [];
  const data = createProjectData();
  const stores = ["home", "ledger", "logbook"].map((name) => {
    const store = heldStore(calls, name);
    data.register(name, store.entry);
    return store;
  });

  const loading = data.load();
  await flush();

  assert.deepEqual(calls, ["home.clear", "ledger.clear", "logbook.clear", "home.load", "ledger.load", "logbook.load"]);
  stores.forEach((store) => store.settle());
  await loading;
});

test("the opening screen's part is the earliest store still loading, and every store's part is reported in order", async () => {
  const calls = [];
  const parts = [];
  const data = createProjectData();
  const [traffic, logs, scope] = [
    ["ledger", "traffic"],
    ["home", "logs"],
    ["waypoints", "scope"],
  ].map(([name, signal]) => {
    const store = heldStore(calls, name);
    data.register(name, { signal, ...store.entry });
    return store;
  });
  data.register("jobs", { load: async () => {} });

  const loading = data.load((signal) => parts.push(signal));
  await flush();
  assert.deepEqual(parts, ["traffic"]);

  scope.settle();
  await flush();
  assert.deepEqual(parts, ["traffic"], "a later store finishing first doesn't move the screen on");

  traffic.settle();
  await flush();
  assert.deepEqual(parts, ["traffic", "logs"]);

  logs.settle();
  await loading;
  assert.deepEqual(parts, ["traffic", "logs", "scope"]);
});

test("one store's failed load doesn't stop the others; the load then fails with the first store's error", async () => {
  const calls = [];
  const data = createProjectData();
  const home = heldStore(calls, "home");
  const ledger = heldStore(calls, "ledger");
  const logbook = heldStore(calls, "logbook");
  data.register("home", home.entry);
  data.register("ledger", ledger.entry);
  data.register("logbook", logbook.entry);
  data.register("scope", {
    load: () => {
      throw new Error("scope is down");
    },
  });
  let ended = null;
  const loading = data.load().then(
    () => (ended = "resolved"),
    (error) => (ended = error.message),
  );
  await flush();

  ledger.fail(new Error("ledger is down"));
  await flush();
  assert.equal(ended, null, "the load waits for every store");

  home.settle();
  logbook.settle();
  await loading;
  assert.deepEqual(calls.filter((call) => call.endsWith(".load")), ["home.load", "ledger.load", "logbook.load"]);
  assert.equal(ended, "ledger is down");
});

test("a load superseded while its stores load reports no more parts and surfaces no failure", async () => {
  const calls = [];
  const parts = [];
  let live = true;
  const data = createProjectData();
  const ledger = heldStore(calls, "ledger");
  const home = heldStore(calls, "home");
  data.register("ledger", { signal: "traffic", ...ledger.entry });
  data.register("home", { signal: "logs", ...home.entry });

  const loading = data.load((signal) => parts.push(signal), () => live);
  await flush();
  live = false;
  ledger.settle();
  home.fail(new Error("home is down"));

  assert.equal(await loading, undefined);
  assert.deepEqual(parts, ["traffic"]);
});

test("a load superseded as its stores start starts no further store", async () => {
  const calls = [];
  let live = true;
  const data = createProjectData();
  data.register("home", {
    load: async () => {
      calls.push("home.load");
      live = false;
    },
  });
  data.register("ledger", { load: async () => calls.push("ledger.load") });

  await data.load(() => {}, () => live);

  assert.deepEqual(calls, ["home.load"]);
});

test("a load superseded before it begins clears and loads nothing", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", recorder(calls, "home"));

  await data.load(() => {}, () => false);

  assert.deepEqual(calls, []);
});
