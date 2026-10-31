// The window's project switches: one it starts, and one another client of
// its instance (the CLI, another window) starts, followed through Marasi's
// project.* events, with the opening screen they show.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createProjectSwitchStore } from "./createProjectSwitchStore.js";
import { openingScreen } from "../lib/openProgress.js";
import { NotPorted } from "../lib/bindings/notPorted.js";

const projects = "/cfg/Marasi/projects";
const acmePath = `${projects}/acme.marasi`;

// A promise and its settle calls, for answers the test hands back later.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A fake api: the POST answers through `opens`, the opening screen's delay
// through `timers`, and each load is recorded.
function fakeApi({ remote = false, instances = [], loadError = null } = {}) {
  const calls = { opened: [], loads: [], windows: [], checkpoint: 0, busy: [] };
  const opens = [];
  const timers = [];
  const api = {
    openProject: (target) => {
      calls.opened.push(target);
      const answer = deferred();
      opens.push(answer);
      return answer.promise;
    },
    listProjects: async () => [
      { name: "acme", project: acmePath, modified_at: "2026-10-31T11:00:00Z" },
      { name: "build", project: `${projects}/build.marasi`, modified_at: "2026-10-31T10:00:00Z" },
    ],
    localInstances: async () => instances,
    isRemote: () => remote,
    load: async (project, loadPart) => {
      calls.loads.push(project);
      loadPart("traffic");
      if (loadError) throw loadError;
    },
    busy: (isBusy) => calls.busy.push(isBusy),
    openInstanceWindow: async (instance) => calls.windows.push(instance),
    showCheckpoint: () => calls.checkpoint++,
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: (id) => {
      timers[id - 1] = null;
    },
  };
  const fireTimers = () => timers.splice(0).forEach((fn) => fn?.());
  return { api, calls, opens, fireTimers };
}

// A window that has the scratchpad open and loaded, as after startup.
async function started(options) {
  const fake = fakeApi(options);
  const store = createProjectSwitchStore(fake.api);
  await store.openConnected({ project: `${projects}/scratchpad.marasi` });
  fake.calls.loads.length = 0;
  fake.calls.busy.length = 0;
  return { ...fake, store };
}

const screen = (store) => openingScreen(get(store).opening);

test("startup loads the instance's open project with the opening screen up from the start", async () => {
  const fake = fakeApi();
  const store = createProjectSwitchStore(fake.api);
  const loading = store.openConnected({ project: acmePath });
  assert.equal(get(store).shown, true);

  assert.deepEqual(await loading, { name: "acme", path: acmePath });
  assert.deepEqual(fake.calls.loads, [{ name: "acme", path: acmePath }]);
  assert.deepEqual(fake.calls.opened, []);
  assert.deepEqual(get(store), { opening: null, shown: false, loaded: { name: "acme", path: acmePath } });
});

test("a load that stops on a call not ported yet still finishes, so the pages draw with what they have", async () => {
  const fake = fakeApi({ loadError: new NotPorted("GetExtensions") });
  const store = createProjectSwitchStore(fake.api);
  assert.deepEqual(await store.openConnected({ project: acmePath }), { name: "acme", path: acmePath });

  const switching = store.open("build");
  fake.opens[0].resolve(`${projects}/build.marasi`);
  assert.deepEqual(await switching, { name: "build", path: `${projects}/build.marasi` });
  assert.deepEqual(get(store), { opening: null, shown: false, loaded: { name: "build", path: `${projects}/build.marasi` } });
});

test("a load that fails otherwise shows the failure, and Stay in stays in the project that opened", async () => {
  const fake = fakeApi({ loadError: new Error("reading the log: boom") });
  const store = createProjectSwitchStore(fake.api);
  assert.equal(await store.openConnected({ project: acmePath }), null);
  assert.equal(screen(store).failure.error, "Error: reading the log: boom");

  store.stay();
  assert.deepEqual(get(store), { opening: null, shown: false, loaded: { name: "acme", path: acmePath } });
});

test("opening by name switches the instance, shows the screen only once the switch is slow, and loads the project", async () => {
  const { store, calls, opens, fireTimers } = await started();
  const opening = store.open("acme");
  assert.deepEqual(calls.opened, ["acme"]);
  assert.equal(get(store).shown, false);
  assert.deepEqual(calls.busy, [true]);

  store.onOpening({ project: acmePath });
  fireTimers();
  assert.equal(get(store).shown, true);
  assert.deepEqual(screen(store).project, { name: "acme", path: acmePath });

  // The event usually comes first, but the POST's answer does the load.
  store.onOpened({ project: acmePath });
  await settle();
  assert.deepEqual(calls.loads, []);
  opens[0].resolve(acmePath);

  assert.deepEqual(await opening, { name: "acme", path: acmePath });
  assert.deepEqual(calls.loads, [{ name: "acme", path: acmePath }]);
  assert.deepEqual(calls.busy, [true, false]);
  assert.deepEqual(get(store), { opening: null, shown: false, loaded: { name: "acme", path: acmePath } });
});

test("opening by a path on the instance machine sends the path, and a quick switch never shows the screen", async () => {
  const { store, calls, opens } = await started();
  const opening = store.open("/srv/engagements/acme.marasi");
  opens[0].resolve("/srv/engagements/acme.marasi");

  assert.deepEqual(await opening, { name: "acme", path: "/srv/engagements/acme.marasi" });
  assert.deepEqual(calls.opened, ["/srv/engagements/acme.marasi"]);
  assert.equal(get(store).shown, false);
});

test("a switch that waits on held Checkpoint items shows what it waits for, and finishes once they are resolved", async () => {
  const { store, calls, opens, fireTimers } = await started();
  const opening = store.open("acme");
  store.onOpening({ project: acmePath });
  store.onWaiting({ project: acmePath, waiting_for: [{ kind: "checkpoint", id: "a", type: "request", summary: "GET / HTTP/1.1" }] });
  fireTimers();
  assert.equal(screen(store).sentence, "Waiting for 1 held Checkpoint item.");

  // Checkpoint answers during the switch, so the screen steps aside for it.
  store.showCheckpoint();
  assert.equal(get(store).shown, false);
  assert.equal(calls.checkpoint, 1);

  store.onOpened({ project: acmePath });
  opens[0].resolve(acmePath);
  assert.deepEqual(await opening, { name: "acme", path: acmePath });
  assert.deepEqual(get(store).loaded, { name: "acme", path: acmePath });
});

test("a switch the CLI makes shows the opening screen with its upgrade progress, and reloads the window on project.opened", async () => {
  const { store, calls, fireTimers } = await started();
  store.onOpening({ project: acmePath });
  assert.deepEqual(calls.busy, [true]);
  fireTimers();
  assert.equal(get(store).shown, true);
  assert.deepEqual(screen(store).project, { name: "acme", path: acmePath });
  assert.deepEqual(screen(store).actions, null);

  store.onUpgrading({ project: acmePath, migration: "00003_notes.sql", applied: 3, total: 27 });
  assert.deepEqual(screen(store).upgrade, { migration: "00003_notes.sql", applied: 3, total: 27 });

  await store.onOpened({ project: acmePath });
  assert.deepEqual(calls.loads, [{ name: "acme", path: acmePath }]);
  assert.deepEqual(calls.busy, [true, false]);
  assert.deepEqual(get(store), { opening: null, shown: false, loaded: { name: "acme", path: acmePath } });
});

test("project.opened with no project.opening seen, as after the stream reopened mid-switch, still reloads the window", async () => {
  const { store, calls } = await started();
  await store.onOpened({ project: acmePath });

  assert.deepEqual(calls.loads, [{ name: "acme", path: acmePath }]);
  assert.deepEqual(get(store).loaded, { name: "acme", path: acmePath });
});

test("a switch the CLI makes that fails shows the failure at once, and Stay in keeps the open project", async () => {
  const { store, calls } = await started();
  store.onOpening({ project: acmePath });
  store.onOpeningFailed({ project: acmePath, error: "opening project database: migrating: disk full" });
  await settle();

  assert.equal(get(store).shown, true);
  assert.equal(screen(store).failure.error, "opening project database: migrating: disk full");
  assert.deepEqual(screen(store).actions, { stayIn: "scratchpad", tryAgain: false, owner: null });
  assert.deepEqual(screen(store).choices.map((choice) => choice.name), ["build"]);
  assert.deepEqual(calls.busy, [true, false]);

  store.stay();
  assert.deepEqual(get(store), {
    opening: null,
    shown: false,
    loaded: { name: "scratchpad", path: `${projects}/scratchpad.marasi` },
  });
  assert.deepEqual(calls.loads, []);
});

test("a failed switch the window started shows Marasi's error rather than the POST's bare code", async () => {
  const { store, opens } = await started();
  const opening = store.open("acme");
  store.onOpening({ project: acmePath });
  store.onOpeningFailed({ project: acmePath, error: "opening project database: migrating: disk full" });
  opens[0].reject(Object.assign(new Error("POST /project/open: internal_server_error: HTTP 500"), { code: "internal_server_error" }));

  assert.equal(await opening, null);
  assert.equal(screen(store).failure.error, "opening project database: migrating: disk full");
});

test("a locked project on a local connection names its owner, and connecting opens the owner in a new window", async () => {
  const instances = [
    { instance: "default", project: `${projects}/scratchpad.marasi` },
    { instance: "acme-cli", project: acmePath },
  ];
  const { store, calls, opens } = await started({ instances });
  const opening = store.open("acme");
  store.onOpening({ project: acmePath });
  store.onOpeningFailed({ project: acmePath, error: `project already open: ${acmePath}` });
  opens[0].reject(Object.assign(new Error("POST /project/open: project_already_open: HTTP 409"), { code: "project_already_open" }));
  await opening;
  await settle();

  assert.equal(screen(store).sentence, "The project is open on acme-cli.");
  assert.deepEqual(screen(store).actions, { stayIn: "scratchpad", tryAgain: true, owner: "acme-cli" });

  await store.connectOwner();
  assert.deepEqual(calls.windows, ["acme-cli"]);
  // This window stays on its project.
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: `${projects}/scratchpad.marasi` });
  assert.equal(get(store).opening, null);
});

test("a locked project opened by name with no event still finds its owner by the instance's project path", async () => {
  const instances = [{ instance: "acme-cli", project: acmePath }];
  const { store, opens } = await started({ instances });
  const opening = store.open("acme");
  opens[0].reject(Object.assign(new Error("POST /project/open: project_already_open: HTTP 409"), { code: "project_already_open" }));
  await opening;
  await settle();

  assert.equal(screen(store).actions.owner, "acme-cli");
});

test("a locked project on a remote connection offers no owner, as other machines can't be asked", async () => {
  const { store, opens } = await started({ remote: true, instances: [{ instance: "acme-cli", project: acmePath }] });
  const opening = store.open(acmePath);
  opens[0].reject(Object.assign(new Error("POST /project/open: project_already_open: HTTP 409"), { code: "project_already_open" }));
  await opening;
  await settle();

  assert.equal(screen(store).failure.kind, "locked");
  assert.equal(screen(store).actions.owner, null);
});

test("Try again re-runs the last open", async () => {
  const { store, calls, opens } = await started();
  const first = store.open("acme");
  opens[0].reject(Object.assign(new Error("POST /project/open: project_already_open: HTTP 409"), { code: "project_already_open" }));
  await first;

  const again = store.retry();
  assert.deepEqual(calls.opened, ["acme", "acme"]);
  opens[1].resolve(acmePath);
  assert.deepEqual(await again, { name: "acme", path: acmePath });
});
