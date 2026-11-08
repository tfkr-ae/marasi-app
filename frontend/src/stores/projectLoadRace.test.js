// A project load that a newer one supersedes: the real connection store
// drives the real project store, whose loads run the real projectData
// registry over fake stores that answer when the test says. A connection
// switch or a newer open, reload or load supersedes the running one, which
// then changes nothing: not the opening screen, the loaded project or the
// generation, even when its stores finish late or fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";
import { createProjectStore } from "./createProjectStore.js";
import { createProjectData } from "./projectData.js";

const alpha = { id: "alpha", kind: "remote", name: "Alpha", url: "http://10.0.0.1:9000" };
const beta = { id: "beta", kind: "remote", name: "Beta", url: "http://10.0.0.2:9000" };
const statusOf = (project) => ({ version: "dev", api: 1, run_id: `run-${project}`, project });

// Lets every settled promise run its continuation.
const settle = () => new Promise((r) => setTimeout(r, 0));

// The connection store and project store wired as connectionStore.js wires
// them, with `stores` registered in the registry. Every service call and
// every store load stays pending until the test resolves it:
// `next(name)` is the oldest pending call of `name`.
function setup(stores = ["home"]) {
  const pending = [];
  const calls = [];
  const outcomes = [];
  const held = (name, args = []) =>
    new Promise((resolve, reject) => {
      calls.push([name, ...args]);
      pending.push({ name, args, resolve, reject });
    });

  const data = createProjectData();
  for (const name of stores) {
    data.register(name, { clear: () => calls.push([`${name}.clear`]), load: () => held(`${name}.load`) });
  }

  const projectStore = createProjectStore(
    {
      heldCheckpointIDs: async () => [],
      confirmSwitch: async () => true,
      open: async (target) => target.path,
      listProjects: async () => [],
      loadProject: (path, part, live) => data.load(part, live),
      onProjectEvent: () => () => {},
    },
    { setTimeout: () => 0, clearTimeout: () => {} },
  );

  // Records how each load ended, so a throw shows.
  const record = (promise) =>
    promise.then(
      (result) => outcomes.push(result?.status ?? "done"),
      (error) => {
        outcomes.push(`threw ${error.message}`);
        throw error;
      },
    );
  const connectionStore = createConnectionStore(
    {
      listConnections: async () => ({ connections: [alpha, beta], activeId: "alpha" }),
      connectionPassword: (id) => held("connectionPassword", [id]),
      readStatus: () => held("readStatus"),
      confirmSwitch: async () => true,
      confirmFollow: async () => true,
      setActive: async () => {},
      clearStores: () => data.clear(),
      use: () => {},
      openEvents: () => {},
      closeEvents: () => {},
      loadProject: (status, options) => record(projectStore.loadService(status.project, options)),
      reloadProject: (status, options) => record(projectStore.reload(status.project, options)),
      resync: async () => {},
      loadDeclined: () => projectStore.closeFollowed(),
      holdWrites: () => {},
    },
    { setTimeout: () => 1, clearTimeout: () => {} },
  );

  return {
    connectionStore,
    projectStore,
    calls,
    outcomes,
    next(name) {
      const at = pending.findIndex((call) => call.name === name);
      assert.notEqual(at, -1, `no pending ${name}`);
      return pending.splice(at, 1)[0];
    },
    has: (name) => pending.some((call) => call.name === name),
  };
}

// Connects to Alpha with `project` loaded in every store.
async function connectedToAlpha(fake, project, stores = ["home"]) {
  fake.connectionStore.start();
  await settle();
  fake.next("connectionPassword").resolve("pw-alpha");
  await settle();
  fake.next("readStatus").resolve(statusOf(project));
  await settle();
  for (const name of stores) {
    fake.next(`${name}.load`).resolve();
    await settle();
  }
  assert.equal(get(fake.projectStore).loaded.path, project);
}

// Another client opened `project` on Alpha: the app follows it after the
// prompt, and its reload starts.
async function followed(fake, project) {
  fake.connectionStore.followSwitch(project);
  await settle();
  fake.next("readStatus").resolve(statusOf(project));
  await settle();
  await settle();
}

// Switches to Beta, which connects with `project`; its reload starts.
async function switchedToBeta(fake, project) {
  fake.connectionStore.switchTo("beta");
  await settle();
  fake.next("connectionPassword").resolve("pw-beta");
  await settle();
  fake.next("readStatus").resolve(statusOf(project));
  await settle();
}

test("a reload that a connection switch superseded, finishing first, leaves the switch's load to finish it", async () => {
  const fake = setup();
  await connectedToAlpha(fake, "/a.marasi");
  await followed(fake, "/a-new.marasi");
  const alphaLoad = fake.next("home.load");
  await switchedToBeta(fake, "/b.marasi");
  const betaLoad = fake.next("home.load");
  const generation = get(fake.projectStore).generation;
  assert.equal(get(fake.projectStore).opening.path, "/b.marasi");

  alphaLoad.resolve();
  await settle();

  const during = get(fake.projectStore);
  assert.equal(during.opening?.path, "/b.marasi");
  assert.equal(during.loaded.path, "/a.marasi");
  assert.equal(during.generation, generation);

  betaLoad.resolve();
  await settle();

  const after = get(fake.projectStore);
  assert.equal(after.opening, null);
  assert.equal(after.loaded.path, "/b.marasi");
  assert.equal(after.generation, generation + 1);
  assert.deepEqual(fake.outcomes, ["done", "superseded", "opened"]);
});

test("a superseded reload finishing after the switch's load changes nothing", async () => {
  const fake = setup();
  await connectedToAlpha(fake, "/a.marasi");
  await followed(fake, "/a-new.marasi");
  const alphaLoad = fake.next("home.load");
  await switchedToBeta(fake, "/b.marasi");
  const betaLoad = fake.next("home.load");

  betaLoad.resolve();
  await settle();
  const loaded = get(fake.projectStore);
  assert.equal(loaded.opening, null);
  assert.equal(loaded.loaded.path, "/b.marasi");

  alphaLoad.resolve();
  await settle();

  assert.deepEqual(get(fake.projectStore), loaded);
  assert.deepEqual(fake.outcomes, ["done", "opened", "superseded"]);
});

test("a switch during the registry's load: the superseded load's late stores, even a failing one, change nothing", async () => {
  const stores = ["home", "ledger", "logbook"];
  const fake = setup(stores);
  await connectedToAlpha(fake, "/a.marasi", stores);
  await followed(fake, "/a-new.marasi");
  const alpha = Object.fromEntries(stores.map((name) => [name, fake.next(`${name}.load`)]));
  alpha.home.resolve();
  await settle();

  await switchedToBeta(fake, "/b.marasi");
  const generation = get(fake.projectStore).generation;
  alpha.ledger.reject(new Error("ledger is down"));
  alpha.logbook.resolve();
  await settle();

  const during = get(fake.projectStore);
  assert.equal(during.opening?.path, "/b.marasi");
  assert.equal(during.opening.failure, null);
  assert.equal(during.loaded.path, "/a.marasi");
  assert.equal(during.generation, generation);

  for (const name of stores) fake.next(`${name}.load`).resolve();
  await settle();

  assert.equal(get(fake.projectStore).loaded.path, "/b.marasi");
  assert.equal(get(fake.projectStore).opening, null);
  assert.equal(get(fake.projectStore).generation, generation + 1);
  assert.deepEqual(fake.outcomes, ["done", "superseded", "opened"]);
});

test("an open begun during a reload supersedes it", async () => {
  const fake = setup();
  await connectedToAlpha(fake, "/a.marasi");
  await followed(fake, "/a-new.marasi");
  const reloading = fake.next("home.load");
  const opening = fake.projectStore.open({ path: "/c.marasi" });
  await settle();
  const openLoad = fake.next("home.load");

  reloading.resolve();
  await settle();
  assert.equal(get(fake.projectStore).opening?.path, "/c.marasi");
  assert.equal(get(fake.projectStore).loaded.path, "/a.marasi");

  openLoad.resolve();
  assert.equal((await opening).status, "opened");
  assert.equal(get(fake.projectStore).loaded.path, "/c.marasi");
  assert.equal(get(fake.projectStore).opening, null);
  assert.deepEqual(fake.outcomes, ["done", "superseded"]);
});

test("a superseded reload closes its own opening screen when nothing replaced it", async () => {
  const fake = setup();
  await connectedToAlpha(fake, "/a.marasi");
  await followed(fake, "/a-new.marasi");
  const reloading = fake.next("home.load");
  const generation = get(fake.projectStore).generation;
  fake.connectionStore.switchTo("beta");
  await settle();

  reloading.resolve();
  await settle();

  const state = get(fake.projectStore);
  assert.equal(state.opening, null);
  assert.equal(state.shown, false);
  assert.equal(state.loaded.path, "/a.marasi");
  assert.equal(state.generation, generation);
});
