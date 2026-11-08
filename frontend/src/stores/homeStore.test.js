// Home: the dashboard counts, scope, listener status and live log, read from
// the service through createHomeApi (over a fake service client) and kept
// by createHomeStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createHomeApi } from "./homeApi.js";
import { createHomeStore, DASHBOARD_SETTLE_MS } from "./createHomeStore.js";

// A fake service client answering GETs from `routes` (path → body or a
// function of the query), recording each call.
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    post: async (path, body) => {
      calls.push([path, body]);
      const answer = routes[`POST ${path}`];
      if (answer === undefined) throw new Error(`POST ${path}: not_found: HTTP 404`);
      return typeof answer === "function" ? answer(body) : answer;
    },
    get: async (path, query) => {
      calls.push([path, query]);
      const answer = routes[path];
      if (answer === undefined) throw new Error(`GET ${path}: not_found: HTTP 404`);
      return typeof answer === "function" ? answer(query) : answer;
    },
  };
}

const serviceRoutes = () => ({
  "/dashboard": { pairs: 1200, notes: 3, launchpads: 2, intercepted: 7, intercepted_count: { complete: false } },
  "/scope": {
    default_allow: false,
    include: [{ pattern: "example\\.com", match_type: "host" }],
    exclude: [
      { pattern: ".*\\.gstatic\\.com", match_type: "host" },
      { pattern: "/logout", match_type: "url" },
    ],
  },
  // Newest first, as the service pages them.
  "/logs": {
    items: [
      { id: "l2", timestamp: "2026-11-06T22:14:34+04:00", level: "WARN", message: "second", context: {}, request_id: "r1", extension_id: "e1" },
      { id: "l1", timestamp: "2026-11-06T22:14:33+04:00", level: "INFO", message: "first", context: {}, request_id: null, extension_id: null },
    ],
    next_cursor: null,
  },
  "/extension": { items: [{ id: "e1", name: "compass", enabled: true }] },
  "/listener/status": { status: "active", proxy_listener: "127.0.0.1:52062" },
});

function setup(routes = serviceRoutes()) {
  const client = fakeClient(routes);
  const store = createHomeStore(createHomeApi(client));
  return { client, store };
}

test("populate reads the dashboard counts the Dashboard shows", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).dashboard, {
    requests: 1200,
    notes: 3,
    launchpads: 2,
    intercepted: 7,
    interceptedComplete: false,
  });
});

test("populate counts the scope's rules", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).scope, { defaultAllow: false, includeCount: 1, excludeCount: 2 });
});

test("populate reads the log oldest first, in the fields the log table reads", async () => {
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

test("populate names extensions by id for the log's Extension column", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).extensionNames, { e1: "compass" });
});

test("populate reads the proxy listener's address and status", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).listener, { status: true, address: "127.0.0.1", port: "52062" });
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

test("listener events keep the listener status current", async () => {
  const { store } = setup();
  await store.populate();
  store.onListener({ status: "inactive", proxy_listener: null, reason: "requested" });
  assert.equal(get(store).listener.status, false);
  store.onListener({ status: "active", proxy_listener: "0.0.0.0:9090" });
  assert.deepEqual(get(store).listener, { status: true, address: "0.0.0.0", port: "9090" });
});

test("the intercepted count is read again once its job completes", async () => {
  let reads = 0;
  const routes = serviceRoutes();
  routes["/dashboard"] = () => {
    reads++;
    return { pairs: 1, notes: 0, launchpads: 0, intercepted: reads === 1 ? 5 : 9, intercepted_count: { complete: reads > 1 } };
  };
  const { store } = setup(routes);
  await store.populate();

  await store.onJobComplete({ name: "sitemap", project: "/p" });
  assert.equal(reads, 1);
  await store.onJobComplete({ name: "intercepted_count", project: "/p" });
  assert.deepEqual(
    [get(store).dashboard.intercepted, get(store).dashboard.interceptedComplete],
    [9, true],
  );
});

test("a part that fails to load leaves the others", async () => {
  const routes = serviceRoutes();
  delete routes["/scope"];
  const { store } = setup(routes);
  const quiet = console.error;
  console.error = () => {};
  try {
    await store.populate();
  } finally {
    console.error = quiet;
  }
  assert.equal(get(store).dashboard.requests, 1200);
  assert.equal(get(store).scope, null);
});

test("a newer populate wins over a slower older one", async () => {
  let release;
  let first = true;
  const routes = serviceRoutes();
  routes["/dashboard"] = () => {
    if (first) {
      first = false;
      return new Promise((resolve) => {
        release = () => resolve({ pairs: 1, notes: 0, launchpads: 0, intercepted: 0, intercepted_count: { complete: true } });
      });
    }
    return { pairs: 2, notes: 0, launchpads: 0, intercepted: 0, intercepted_count: { complete: true } };
  };
  const { store } = setup(routes);
  const older = store.populate();
  await store.populate();
  release();
  await older;
  assert.equal(get(store).dashboard.requests, 2);
});

test("refreshDashboard reads the counts and scope again, not the log", async () => {
  const { store, client } = setup();
  await store.populate();
  const before = client.calls.length;
  await store.refreshDashboard();
  assert.deepEqual(
    client.calls.slice(before).map(([path]) => path).sort(),
    ["/dashboard", "/scope"],
  );
});

test("setListener moves an active listener on the service and shows the new address", async () => {
  const routes = serviceRoutes();
  routes["POST /listener/update"] = (body) => ({ status: "active", proxy_listener: `${body.address}:${body.port}` });
  const { store, client } = setup(routes);
  await store.populate();

  await store.setListener("0.0.0.0", "9090");

  assert.deepEqual(client.calls.at(-1), ["/listener/update", { address: "0.0.0.0", port: 9090 }]);
  assert.deepEqual(get(store).listener, { status: true, address: "0.0.0.0", port: "9090" });
});

test("setListener starts a listener that is off", async () => {
  const routes = serviceRoutes();
  routes["/listener/status"] = { status: "inactive", proxy_listener: null };
  routes["POST /listener/start"] = (body) => ({ status: "active", proxy_listener: `${body.address}:${body.port}` });
  const { store, client } = setup(routes);
  await store.populate();

  await store.setListener("127.0.0.1", "8080");

  assert.deepEqual(client.calls.at(-1), ["/listener/start", { address: "127.0.0.1", port: 8080 }]);
  assert.equal(get(store).listener.status, true);
});

// A start the service refuses because the port is taken.
const portTaken = (body) => {
  if (body.port !== 0) throw new Error("POST /listener/start: listener_unavailable: listener_unavailable");
  return { status: "active", proxy_listener: `${body.address}:61234` };
};

test("starting on the default port falls back to a free port when it is taken", async () => {
  const routes = serviceRoutes();
  routes["/listener/status"] = { status: "inactive", proxy_listener: null };
  routes["POST /listener/start"] = portTaken;
  const { store, client } = setup(routes);
  await store.populate();

  const listener = await store.setListener("127.0.0.1", "8080", { fallback: true });

  assert.deepEqual(client.calls.slice(-2), [
    ["/listener/start", { address: "127.0.0.1", port: 8080 }],
    ["/listener/start", { address: "127.0.0.1", port: 0 }],
  ]);
  assert.deepEqual(listener, { status: true, address: "127.0.0.1", port: "61234" });
  assert.deepEqual(get(store).listener, listener);
});

test("a port the researcher chose that is taken is refused, not moved", async () => {
  const routes = serviceRoutes();
  routes["/listener/status"] = { status: "inactive", proxy_listener: null };
  routes["POST /listener/start"] = portTaken;
  const { store, client } = setup(routes);
  await store.populate();

  await assert.rejects(store.setListener("127.0.0.1", "9090"), /listener_unavailable/);
  assert.equal(client.calls.filter(([path]) => path === "/listener/start").length, 1);
});

test("a refused listener change rejects and leaves the listener as it was", async () => {
  const { store } = setup();
  await store.populate();
  await assert.rejects(store.setListener("127.0.0.1", "80"), /not_found/);
  assert.deepEqual(get(store).listener, { status: true, address: "127.0.0.1", port: "52062" });
});

test("resync replaces the counts and log in place, keeping the old ones until the new arrive", async () => {
  const routes = serviceRoutes();
  const { store } = setup(routes);
  await store.populate();

  let answer;
  routes["/dashboard"] = () => new Promise((resolve) => (answer = resolve));
  routes["/logs"] = {
    items: [{ id: "l3", timestamp: "2026-11-06T22:20:00+04:00", level: "INFO", message: "while away", context: {} }, ...routes["/logs"].items],
    next_cursor: null,
  };
  const resynced = store.resync();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(get(store).dashboard.requests, 1200, "nothing blanks while the service answers");

  answer({ pairs: 1300, notes: 3, launchpads: 2, intercepted: 7, intercepted_count: { complete: true } });
  await resynced;
  assert.equal(get(store).dashboard.requests, 1300);
  assert.deepEqual(get(store).logs.map((log) => log.ID), ["l1", "l2", "l3"]);
});

test("scope.updated counts the new rules from the event, without reading the scope", async () => {
  const { store, client } = setup();
  await store.populate();
  const reads = client.calls.length;
  store.onScope({ default_allow: true, include: [], exclude: [{ pattern: "/admin", match_type: "url" }] });
  assert.deepEqual(get(store).scope, { defaultAllow: true, includeCount: 0, excludeCount: 1 });
  assert.equal(client.calls.length, reads);
});

test("another client's notes, launchpads and deletes read the dashboard counts again, once per burst", async (t) => {
  const routes = serviceRoutes();
  const { store, client } = setup(routes);
  await store.populate();
  routes["/dashboard"] = { ...routes["/dashboard"], notes: 4, launchpads: 3 };
  const dashboardReads = () => client.calls.filter(([path]) => path === "/dashboard").length;
  const before = dashboardReads();

  t.mock.timers.enable({ apis: ["setTimeout"] });
  store.onCountsChanged();
  store.onCountsChanged();
  t.mock.timers.tick(DASHBOARD_SETTLE_MS);
  t.mock.timers.reset();
  await store.settled();
  assert.equal(dashboardReads(), before + 1);
  assert.equal(get(store).dashboard.notes, 4);
  assert.equal(get(store).dashboard.launchpads, 3);
});

// Advances the mocked clock in steps of `step` ms up to `total`, letting the
// dashboard reads the steps start run between them.
async function tickBy(t, total, step, each = () => {}) {
  for (let at = 0; at < total; at += step) {
    each();
    t.mock.timers.tick(step);
    await Promise.resolve();
  }
}

test("a steady stream of captured requests reads the counts once per settle window while it lasts", async (t) => {
  const routes = serviceRoutes();
  let pairs = 1200;
  routes["/dashboard"] = () => ({ pairs: ++pairs, notes: 3, launchpads: 2, intercepted: 7, intercepted_count: { complete: true } });
  const { store, client } = setup(routes);
  await store.populate();
  const dashboardReads = () => client.calls.filter(([path]) => path === "/dashboard").length;
  const before = dashboardReads();
  const request = { id: "t1", number: 1, scheme: "https", method: "GET", host: "example.com", path: "/", metadata: {} };

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const step = DASHBOARD_SETTLE_MS / 5;
  // A request every step, closer together than the settle window.
  await tickBy(t, DASHBOARD_SETTLE_MS, step, () => store.onRequest(request));
  assert.equal(dashboardReads(), before + 1, "the first window ends in a read, though requests keep coming");

  await tickBy(t, 3 * DASHBOARD_SETTLE_MS, step, () => store.onRequest(request));
  t.mock.timers.reset();
  await store.settled();
  assert.equal(dashboardReads(), before + 4, "one read per window, no more");
  assert.equal(get(store).dashboard.requests, 1205);
});

test("an intercepted response reads the counts again; one that wasn't intercepted doesn't", async (t) => {
  const routes = serviceRoutes();
  const { store, client } = setup(routes);
  await store.populate();
  routes["/dashboard"] = { ...routes["/dashboard"], intercepted: 8 };
  const dashboardReads = () => client.calls.filter(([path]) => path === "/dashboard").length;
  const before = dashboardReads();
  const response = (metadata) => ({ id: "t1", status: "200 OK", status_code: 200, metadata });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  store.onResponse(response({}));
  store.onResponse(response({ intercepted: false }));
  t.mock.timers.tick(DASHBOARD_SETTLE_MS);
  await store.settled();
  assert.equal(dashboardReads(), before, "a response Checkpoint didn't hold leaves the counts alone");

  store.onResponse(response({ intercepted: true }));
  t.mock.timers.tick(DASHBOARD_SETTLE_MS);
  t.mock.timers.reset();
  await store.settled();
  assert.equal(dashboardReads(), before + 1);
  assert.equal(get(store).dashboard.intercepted, 8);
});
