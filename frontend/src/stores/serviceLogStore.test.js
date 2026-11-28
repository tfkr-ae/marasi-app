// The Service log: the service's own messages and the extensions' names,
// read through createServiceLogApi (over a fake service client) and kept by
// createServiceLogStore, live with log.added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceLogApi } from "./serviceLogApi.js";
import { createServiceLogStore } from "./createServiceLogStore.js";

// A fake service client answering GETs from `routes` (path → body or a
// function of the query), recording each call.
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    get: async (path, query) => {
      calls.push([path, query]);
      const answer = routes[path];
      if (answer === undefined) throw new Error(`GET ${path}: not_found: HTTP 404`);
      return typeof answer === "function" ? answer(query) : answer;
    },
  };
}

const serviceRoutes = () => ({
  // Newest first, as the service pages them.
  "/logs": {
    items: [
      { id: "l2", timestamp: "2026-11-06T22:14:34+04:00", level: "WARN", message: "second", context: {}, request_id: "r1", extension_id: "e1" },
      { id: "l1", timestamp: "2026-11-06T22:14:33+04:00", level: "INFO", message: "first", context: {}, request_id: null, extension_id: null },
    ],
    next_cursor: null,
  },
  "/extension": { items: [{ id: "e1", name: "compass", enabled: true }] },
  "/traffic/r1": { id: "r1", number: 17 },
});

function setup(routes = serviceRoutes()) {
  const client = fakeClient(routes);
  const store = createServiceLogStore(createServiceLogApi(client));
  return { client, store };
}

test("populate reads the log oldest first, in the fields the Service log reads", async () => {
  const { store, client } = setup();
  await store.populate();
  const logs = get(store).logs;
  assert.deepEqual(
    logs.map((log) => [log.ID, log.Level, log.Message, log.RequestID, log.ExtensionID]),
    [
      ["l1", "INFO", "first", null, null],
      ["l2", "WARN", "second", "r1", "e1"],
    ],
  );
  assert.equal(logs[0].Timestamp, "2026-11-06T22:14:33+04:00");
  assert.ok(client.calls.some(([path, query]) => path === "/logs" && query?.limit === 500));
});

test("populate names extensions by id for a line's source", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).extensionNames, { e1: "compass" });
});

test("a log line from the stream is added after the others", async () => {
  const { store } = setup();
  await store.populate();
  store.onLog({ id: "l3", timestamp: "2026-11-06T22:15:00+04:00", level: "ERROR", message: "live", context: {}, request_id: null, extension_id: null });
  assert.deepEqual(
    get(store).logs.map((log) => log.ID),
    ["l1", "l2", "l3"],
  );
  assert.equal(get(store).logs[2].Level, "ERROR");
});

test("a log line already read isn't added twice", async () => {
  const { store } = setup();
  await store.populate();
  store.onLog({ id: "l2", timestamp: "2026-11-06T22:14:34+04:00", level: "WARN", message: "second", context: {} });
  assert.equal(get(store).logs.length, 2);
});

test("resync keeps the lines until the new ones arrive, then replaces them", async () => {
  const routes = serviceRoutes();
  const { store } = setup(routes);
  await store.populate();

  let answer;
  routes["/logs"] = () => new Promise((resolve) => (answer = resolve));
  const resynced = store.resync();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(get(store).logs.length, 2, "nothing blanks while the service answers");

  answer({
    items: [{ id: "l3", timestamp: "2026-11-06T22:20:00+04:00", level: "INFO", message: "while away", context: {} }, ...serviceRoutes()["/logs"].items],
    next_cursor: null,
  });
  await resynced;
  assert.deepEqual(get(store).logs.map((log) => log.ID), ["l1", "l2", "l3"]);
});

test("a failed read leaves the other part", async () => {
  const routes = serviceRoutes();
  delete routes["/extension"];
  const { store } = setup(routes);
  const quiet = console.error;
  console.error = () => {};
  try {
    await store.populate();
  } finally {
    console.error = quiet;
  }
  assert.equal(get(store).logs.length, 2);
  assert.deepEqual(get(store).extensionNames, {});
});

test("clear forgets the last project's lines and drops a read still in flight", async () => {
  const routes = serviceRoutes();
  let answer;
  routes["/logs"] = () => new Promise((resolve) => (answer = resolve));
  const { store } = setup(routes);
  const loading = store.populate();
  store.clear();
  answer(serviceRoutes()["/logs"]);
  await loading;
  assert.deepEqual(get(store).logs, []);
});

test("pairNumber reads the number of the pair a line names, null when it's gone", async () => {
  const { store, client } = setup();
  assert.equal(await store.pairNumber("r1"), 17);
  assert.equal(await store.pairNumber("gone"), null);
  const [, query] = client.calls.find(([path]) => path === "/traffic/r1");
  assert.deepEqual(query, { raw: false, prettified: false }, "without bodies");
});
