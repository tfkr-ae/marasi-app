import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createProjectStore } from "./createProjectStore.js";
import { createProjectApi, projectTarget } from "./projectApi.js";
import { openingScreen } from "../lib/openProgress.js";
import { serviceError } from "../lib/service/errors.js";

const projects = "/cfg/projects";
const scratchpad = `${projects}/scratchpad.marasi`;
const acme = `${projects}/acme.marasi`;

// A fake service client: routes answer from a table, every call is
// recorded, and `emit` sends an event to the handlers `on` registered.
function fakeClient(routes = {}) {
  const calls = [];
  const handlers = new Map();
  const answer = async (method, path, body) => {
    calls.push(body === undefined ? `${method} ${path}` : `${method} ${path} ${JSON.stringify(body)}`);
    const route = routes[`${method} ${path}`];
    if (!route) throw new Error(`no route for ${method} ${path}`);
    return route(body);
  };
  return {
    calls,
    get: (path) => answer("GET", path),
    post: (path, body) => answer("POST", path, body),
    on(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== handler));
    },
    emit: (name, data) => (handlers.get(name) ?? []).forEach((handler) => handler(data)),
    listening: (name) => (handlers.get(name) ?? []).length,
  };
}

// The routes of a service with the scratchpad open and nothing held, whose
// open of `path` publishes `events` before answering.
function serviceRoutes(client, { held = [], events = [], refuse = null } = {}) {
  return {
    "GET /checkpoint": () => ({ items: held.map((id) => ({ id })), intercept: false, websocket_intercept: false }),
    "GET /project/list": () => ({
      items: [
        { name: "acme", project: acme, modified_at: "2026-11-06T09:00:00+04:00" },
        { name: "scratchpad", project: scratchpad, modified_at: "2026-11-06T10:00:00+04:00" },
      ],
    }),
    "POST /project/open": (body) => {
      const path = body.path ?? `${projects}/${body.name}.marasi`;
      for (const [name, data] of events) client.emit(name, { project: path, ...data });
      if (refuse) throw refuse;
      return { project: path };
    },
  };
}

// The project store over the fake client, with the native prompt answering
// `confirm`, a load that records what it loaded, and timers run by hand.
function setup({ held, events, refuse, confirm = true, load = async () => {}, recents = [] } = {}) {
  const routes = {};
  const client = fakeClient(routes);
  Object.assign(routes, serviceRoutes(client, { held, events, refuse }));
  const loads = [];
  const prompts = [];
  const timers = [];
  const api = createProjectApi(client, {
    confirmSwitch: async () => {
      prompts.push("Switch Project");
      return confirm;
    },
    loadProject: async (path, part) => {
      loads.push(path);
      await load(path, part);
    },
    recentProjects: async () => recents,
  });
  const store = createProjectStore(api, {
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
  });
  store.loaded(scratchpad);
  return { client, store, loads, prompts, timers };
}

const steps = (state) => openingScreen(state.opening).steps.map((step) => `${step.label}:${step.mark}`);

test("the service's open project is the loaded one, named after its file", () => {
  const { store } = setup();

  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad });
  assert.equal(get(store).opening, null);
});

test("opening a project by name opens it on the service, loads it and reports it opened", async () => {
  const { client, store, loads, prompts } = setup();

  const result = await store.open({ name: "acme" });

  assert.deepEqual(result, { status: "opened", project: { name: "acme", path: acme } });
  assert.deepEqual(client.calls, ["GET /checkpoint", 'POST /project/open {"name":"acme"}']);
  assert.deepEqual(prompts, ["Switch Project"]);
  assert.deepEqual(loads, [acme]);
  assert.deepEqual(get(store).loaded, { name: "acme", path: acme });
  assert.equal(get(store).opening, null, "the opening screen closes");
  assert.equal(get(store).generation, 1, "the pages remount on the new project");
});

test("a path from the file picker opens by path", async () => {
  const { client, store } = setup();
  const picked = "/Users/r/Engagements/client.marasi";

  const result = await store.open({ path: picked });

  assert.deepEqual(result.project, { name: "client", path: picked });
  assert.equal(client.calls.at(-1), `POST /project/open {"path":"${picked}"}`);
});

test("a held Checkpoint item refuses the switch before the prompt, and nothing changes", async () => {
  const { client, store, prompts, loads } = setup({ held: ["c1", "c2"] });

  const result = await store.open({ name: "acme" });

  assert.deepEqual(result, { status: "held", ids: ["c1", "c2"] });
  assert.deepEqual(client.calls, ["GET /checkpoint"]);
  assert.deepEqual(prompts, []);
  assert.deepEqual(loads, []);
  assert.equal(get(store).opening, null);
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad });
});

test("a switch cancelled at the unsaved-work prompt opens nothing and shows nothing", async () => {
  const { client, store } = setup({ confirm: false });

  const result = await store.open({ name: "acme" });

  assert.deepEqual(result, { status: "cancelled" });
  assert.deepEqual(client.calls, ["GET /checkpoint"]);
  assert.equal(get(store).opening, null);
  assert.equal(get(store).shown, false);
});

test("the opening screen follows the service's project events while the open runs", async () => {
  let during;
  const { store } = setup({
    events: [
      ["project.opening", {}],
      ["project.upgrading", { migration: "00022_pair_number.sql", applied: 1, total: 2 }],
    ],
    load: async () => (during = get(store)),
  });

  await store.open({ name: "acme" });

  assert.deepEqual(steps(during), ["Lock:done", "Open:done", "Upgrade:done", "Wait:done", "Loading:current"]);
  assert.deepEqual(openingScreen(during.opening).log, [
    `project.opening project=${acme}`,
    `project.upgrading project=${acme} migration=00022_pair_number.sql applied=1 total=2`,
  ]);
});

test("the open stops listening for project events once it ends", async () => {
  const { client, store } = setup();

  await store.open({ name: "acme" });

  for (const name of ["project.opening", "project.upgrading", "project.waiting", "project.opened", "project.opening_failed"]) {
    assert.equal(client.listening(name), 0, name);
  }
});

test("the load reports its parts to the opening screen", async () => {
  let during;
  const { store } = setup({
    load: async (path, part) => {
      part("extensions");
      during = get(store);
    },
  });

  await store.open({ name: "acme" });

  assert.equal(openingScreen(during.opening).load.part, "Extensions");
});

test("a quick switch never shows the screen; a slow one shows it once the delay passes", async () => {
  let release;
  const { store, timers } = setup({ load: () => new Promise((resolve) => (release = resolve)) });

  const pending = store.open({ name: "acme" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get(store).shown, false);
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(get(store).shown, true);
  release();
  await pending;
  assert.equal(get(store).shown, false);
});

test("a locked project fails the Lock step, keeps the open project loaded, and lists the service's projects", async () => {
  const locked = serviceError({ method: "POST", path: "/project/open", status: 409, body: { error: "project_already_open" } });
  const { store, loads } = setup({
    events: [
      ["project.opening", {}],
      ["project.opening_failed", { error: `project already open: ${acme}` }],
    ],
    refuse: locked,
  });

  const result = await store.open({ name: "acme" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.status, "failed");
  assert.deepEqual(loads, []);
  const state = get(store);
  assert.equal(state.shown, true, "a failure always shows");
  assert.deepEqual(steps(state), ["Locked:failed", "Open:todo", "Upgrade:todo", "Wait:todo", "Load:todo"]);
  const screen = openingScreen(state.opening);
  assert.deepEqual(screen.project, { name: "acme", path: acme });
  assert.deepEqual(screen.actions, { stayIn: "scratchpad", tryAgain: true });
  assert.deepEqual(screen.choices, [], "the target and the open project aren't choices");
  assert.deepEqual(state.opening.recents.map((r) => r.name), ["scratchpad", "acme"]);

  store.stay();
  assert.equal(get(store).opening, null);
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad });
});

test("Try again re-runs the failed open", async () => {
  const refuse = serviceError({ method: "POST", path: "/project/open", status: 409, body: { error: "project_already_open" } });
  const { client, store } = setup({ refuse });
  await store.open({ name: "acme" });

  await store.retry();

  assert.equal(client.calls.filter((call) => call.startsWith("POST /project/open")).length, 2);
});

test("a load that fails after the switch leaves the target as the project to stay in", async () => {
  const { store } = setup({
    load: async () => {
      throw new Error("loading Home: boom");
    },
  });

  const result = await store.open({ name: "acme" });

  assert.equal(result.status, "failed");
  assert.deepEqual(openingScreen(get(store).opening).actions, { stayIn: "acme", tryAgain: false });
  store.stay();
  assert.deepEqual(get(store).loaded, { name: "acme", path: acme });
});

test("the service's projects list as recents, most recent first", async () => {
  const { store } = setup();

  assert.deepEqual(await store.list(), [
    { name: "scratchpad", path: scratchpad, modifiedAt: "2026-11-06T10:00:00+04:00" },
    { name: "acme", path: acme, modifiedAt: "2026-11-06T09:00:00+04:00" },
  ]);
});

test("this connection's recent projects list first, then the service's others", async () => {
  const client = "/srv/client.marasi";
  const { store } = setup({
    recents: [
      { name: "client", path: client, opened: "2026-11-06T11:00:00Z" },
      { name: "acme", path: acme, opened: "2026-11-06T08:00:00Z" },
    ],
  });

  assert.deepEqual(await store.list(), [
    { name: "client", path: client, modifiedAt: "2026-11-06T11:00:00Z" },
    { name: "acme", path: acme, modifiedAt: "2026-11-06T08:00:00Z" },
    { name: "scratchpad", path: scratchpad, modifiedAt: "2026-11-06T10:00:00+04:00" },
  ]);
});

test("the project picker reads the held Checkpoint items from the service", async () => {
  assert.deepEqual(await setup({ held: ["c1"] }).store.held(), ["c1"]);
  assert.deepEqual(await setup().store.held(), []);
});

test("what the picker gives opens by path when it names a directory, else by name", () => {
  assert.deepEqual(projectTarget("acme"), { name: "acme" });
  assert.deepEqual(projectTarget(" acme.marasi "), { name: "acme" });
  assert.deepEqual(projectTarget("/Users/r/client.marasi"), { path: "/Users/r/client.marasi" });
  assert.deepEqual(projectTarget("/Users/r/client"), { path: "/Users/r/client.marasi" });
  assert.deepEqual(projectTarget("C:\\Users\\r\\client.marasi"), { path: "C:\\Users\\r\\client.marasi" });
});

test("reloading the project the service has open loads it afresh, without opening or prompting", async () => {
  const { client, store, loads, prompts } = setup();

  const result = await store.reload(acme);

  assert.deepEqual(result, { status: "opened", project: { name: "acme", path: acme } });
  assert.deepEqual(client.calls, [], "the service already has it open");
  assert.deepEqual(prompts, [], "the connection store asked already");
  assert.deepEqual(loads, [acme]);
  assert.deepEqual(get(store).loaded, { name: "acme", path: acme });
  assert.equal(get(store).generation, 1, "the pages remount");
});

test("a reload that fails shows the opening screen's failure", async () => {
  const { store } = setup({
    load: async () => {
      throw new Error("GET /dashboard: fetch failed");
    },
  });

  const result = await store.reload(acme);

  assert.equal(result.status, "failed");
  assert.equal(get(store).shown, true);
});

// Following opens another client (the CLI, another app) starts.
function following(options) {
  const env = setup(options);
  const opened = [];
  const failed = [];
  const stop = env.store.follow({
    opened: (path) => opened.push(path),
    failed: (name, error) => failed.push([name, error]),
  });
  return { ...env, opened, failed, stop };
}

test("an open another client starts shows the opening screen, following the service's steps", () => {
  const { client, store, timers } = following();

  client.emit("project.opening", { project: acme });
  client.emit("project.upgrading", { project: acme, migration: "00022_pair_number.sql", applied: 1, total: 2 });

  const state = get(store);
  assert.equal(state.shown, false, "a quick open never shows it");
  timers.at(-1)();
  assert.equal(get(store).shown, true);
  assert.deepEqual(steps(get(store)), ["Lock:done", "Open:done", "Upgrading:current", "Wait:todo", "Load:todo"]);
  assert.deepEqual(openingScreen(state.opening).project, { name: "acme", path: acme });
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad }, "the pages stay until the load");
});

test("another client's opened project is handed on to load, once", () => {
  const { client, opened, loads } = following();

  client.emit("project.opening", { project: acme });
  client.emit("project.opened", { project: acme });

  assert.deepEqual(opened, [acme]);
  assert.deepEqual(loads, [], "the connection store loads it, after asking");
});

test("another client's open that fails closes the screen, keeps the pages and reports it", () => {
  const { client, store, failed } = following();

  client.emit("project.opening", { project: acme });
  client.emit("project.opening_failed", { project: acme, error: `project already open: ${acme}` });

  assert.equal(get(store).opening, null);
  assert.equal(get(store).shown, false);
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad });
  assert.deepEqual(failed, [["acme", `project already open: ${acme}`]]);
});

test("the app's own open isn't followed as another client's", async () => {
  const { store, opened, failed } = following({
    events: [
      ["project.opening", {}],
      ["project.opened", {}],
    ],
  });

  await store.open({ name: "acme" });

  assert.deepEqual(opened, []);
  assert.deepEqual(failed, []);
  assert.deepEqual(get(store).loaded, { name: "acme", path: acme });
});

test("events for the loaded project aren't a switch, and close a followed screen", () => {
  const { client, store, opened } = following();

  client.emit("project.opened", { project: scratchpad });
  assert.deepEqual(opened, []);

  client.emit("project.opening", { project: acme });
  client.emit("project.opened", { project: scratchpad });
  assert.equal(get(store).opening, null, "the service went back to the loaded project");
});

test("following stops when asked", () => {
  const { client, opened, stop } = following();

  stop();
  client.emit("project.opened", { project: acme });

  assert.deepEqual(opened, []);
  assert.equal(client.listening("project.opened"), 0);
});

test("staying at the prompt closes the followed screen, and the full load replaces it", async () => {
  const { client, store, loads } = following();
  client.emit("project.opening", { project: acme });
  client.emit("project.opened", { project: acme });

  store.closeFollowed();
  assert.equal(get(store).opening, null);
  assert.deepEqual(get(store).loaded, { name: "scratchpad", path: scratchpad });

  client.emit("project.opening", { project: acme });
  await store.reload(acme);
  assert.deepEqual(loads, [acme]);
  assert.deepEqual(get(store).loaded, { name: "acme", path: acme });
  assert.equal(get(store).opening, null);
});

test("closing the followed screen leaves a failed open of the app's own alone", async () => {
  const refuse = serviceError({ method: "POST", path: "/project/open", status: 409, body: { error: "project_already_open" } });
  const { store } = following({ refuse });
  await store.open({ name: "acme" });

  store.closeFollowed();

  assert.equal(get(store).opening?.failure?.kind, "locked");
});

test("a late event of the app's own failed open isn't another client's", async () => {
  const refuse = serviceError({ method: "POST", path: "/project/open", status: 409, body: { error: "project_already_open" } });
  const { client, store, failed } = following({ refuse });
  await store.open({ name: "acme" });

  client.emit("project.opening", { project: acme });
  client.emit("project.opening_failed", { project: acme, error: "project already open" });

  assert.deepEqual(failed, []);
  assert.equal(get(store).opening?.failure?.kind, "locked", "the app's failure screen stays");
});

test("another client's open waiting on held Checkpoint items leaves the pages reachable", () => {
  const { client, store, timers } = following();
  client.emit("project.opening", { project: acme });
  client.emit("project.waiting", { project: acme, waiting_for: [{ kind: "checkpoint", id: "c1", type: "request", summary: "GET /a" }] });

  timers.forEach((fire) => fire());

  assert.equal(get(store).shown, false, "the screen would cover the items the service waits for");
  client.emit("project.waiting", { project: acme, waiting_for: [{ kind: "work", count: 1 }] });
  assert.equal(get(store).shown, true, "other waits show it");
});

test("another client opening the project the app's own open failed on is still followed", async () => {
  const refuse = serviceError({ method: "POST", path: "/project/open", status: 409, body: { error: "project_already_open" } });
  const { client, store, opened } = following({ refuse });
  await store.open({ name: "acme" });

  client.emit("project.opened", { project: acme });

  assert.deepEqual(opened, [acme]);
});
