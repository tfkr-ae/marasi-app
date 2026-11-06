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
function setup({ held, events, refuse, confirm = true, load = async () => {} } = {}) {
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
