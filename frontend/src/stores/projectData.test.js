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

test("a load clears every store, then loads each, reporting its part to the opening screen", async () => {
  const calls = [];
  const data = createProjectData();
  data.register("home", { signal: "logs", ...recorder(calls, "home") });
  data.register("ledger", { signal: "traffic", ...recorder(calls, "ledger") });

  await data.load((signal) => calls.push(`part ${signal}`));

  assert.deepEqual(calls, ["home.clear", "ledger.clear", "part logs", "home.load", "part traffic", "ledger.load"]);
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
