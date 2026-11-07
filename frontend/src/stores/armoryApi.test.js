// The Armory over the service: templates, runs, wordlists and run traffic,
// read through createArmoryApi (over a fake service client) and kept by
// createArmoryStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createArmoryApi } from "./armoryApi.js";
import { activeCountsOf, activeRunIdsOf, createArmoryStore } from "./createArmoryStore.js";

// A fake service client answering from `routes` ("METHOD path" → body, or a
// function of (query or body, path)), recording each call. A thrown
// answer is a refusal.
function fakeClient(routes) {
  const calls = [];
  const answer = (method, path, arg) => {
    calls.push([method, path, arg]);
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new Error(`${method} ${path}: not_found: HTTP 404`);
    return typeof route === "function" ? route(arg, path) : route;
  };
  return {
    calls,
    get: async (path, query) => answer("GET", path, query),
    post: async (path, body, query) => answer("POST", path, body ?? query),
    del: async (path, body) => answer("DELETE", path, body),
  };
}

const T1 = "0190a000-0000-7000-8000-000000000001";
const T2 = "0190a000-0000-7000-8000-000000000002";

function run(id, templateId, status, extra = {}) {
  return {
    id,
    template_id: templateId,
    template_snapshot: "GET / HTTP/1.1",
    use_https: true,
    wordlists: ["words.txt"],
    status,
    attack_type: "harpoon",
    max_concurrent: 10,
    created_at: "2026-11-06T22:00:00+04:00",
    started_at: null,
    finished_at: null,
    ...extra,
  };
}

// GET /armory/run lists every template's runs, narrowed by ?status=; here
// it reads the per-template run routes, so a test changing those changes it.
function serviceRoutes() {
  const routes = {
  "GET /armory/template": {
    items: [
      { id: T2, name: "Second", description: "" },
      { id: T1, name: "First", description: "login" },
    ],
  },
  [`GET /armory/template/${T1}`]: { id: T1, name: "First", description: "login", raw_template: "POST /login HTTP/1.1" },
  [`GET /armory/template/${T2}`]: { id: T2, name: "Second", description: "", raw_template: "GET / HTTP/1.1" },
  [`GET /armory/template/${T1}/run`]: { items: [run("r1", T1, "complete"), run("r2", T1, "in_progress")] },
  [`GET /armory/template/${T2}/run`]: { items: [run("r3", T2, "in_progress"), run("r4", T2, "draft")] },
  "GET /wordlist": { items: [{ name: "words.txt", size: 120 }] },
  };
  routes["GET /armory/run"] = (query = {}) => {
    const runs = Object.entries(routes)
      .filter(([key]) => /^GET \/armory\/template\/[^/]+\/run$/.test(key))
      .flatMap(([, list]) => list.items);
    return { items: query.status ? runs.filter((r) => r.status === query.status) : runs };
  };
  return routes;
}

function setup(routes = serviceRoutes()) {
  const client = fakeClient(routes);
  const store = createArmoryStore(createArmoryApi(client));
  return { client, store, routes };
}

test("populate reads every template with its raw text, sorted by id", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).templates, [
    { ID: T1, Name: "First", Description: "login", RawTemplate: "POST /login HTTP/1.1" },
    { ID: T2, Name: "Second", Description: "", RawTemplate: "GET / HTTP/1.1" },
  ]);
});

test("populate reads the active runs across templates with one GET /armory/run?status=in_progress", async () => {
  const { store, client } = setup();
  await store.populate();
  assert.deepEqual(activeRunIdsOf(get(store)).sort(), ["r2", "r3"]);
  const runReads = client.calls.filter(([m, p]) => m === "GET" && /\/run$/.test(p));
  assert.deepEqual(runReads, [["GET", "/armory/run", { status: "in_progress" }]]);
});

test("the active runs count per template, for the rail and the template list", async () => {
  const routes = serviceRoutes();
  routes[`GET /armory/template/${T1}/run`].items.push(run("r5", T1, "in_progress"));
  const { store } = setup(routes);
  await store.populate();
  assert.deepEqual(activeCountsOf(get(store)), { total: 3, byTemplate: { [T1]: 2, [T2]: 1 } });
});

test("populate reads the wordlists with their names and sizes", async () => {
  const { store } = setup();
  await store.populate();
  assert.deepEqual(get(store).wordlists, [{ Name: "words.txt", Size: 120 }]);
});

test("a template made from a pair is named after its request and holds its raw text", async () => {
  const routes = serviceRoutes();
  routes["GET /traffic/p1"] = {
    id: "p1",
    request: { scheme: "https", method: "POST", host: "api.acme.test", path: "/login?x=1", raw: btoa("POST /login?x=1 HTTP/1.1\r\nHost: api.acme.test\r\n\r\n") },
  };
  routes["POST /armory/template"] = (body) => ({ id: "t9", ...body });
  const { store, client } = setup(routes);
  await store.populate();
  const template = await store.createTemplateFromRequest("p1");
  const posted = client.calls.find(([m, p]) => m === "POST" && p === "/armory/template")[2];
  assert.deepEqual(posted, {
    name: "POST api.acme.test/login?x=1",
    description: "Imported from request history",
    raw_template: "POST /login?x=1 HTTP/1.1\r\nHost: api.acme.test\r\n\r\n",
  });
  assert.equal(template.ID, "t9");
  assert.ok(get(store).templates.some((t) => t.ID === "t9" && t.Name === "POST api.acme.test/login?x=1"));
});

// Traffic summaries as GET /traffic lists them.
function summary(n, { status = 200, run = "r2" } = {}) {
  return {
    id: `p${String(n).padStart(4, "0")}`,
    number: n,
    scheme: "https",
    method: "GET",
    host: "api.acme.test",
    path: `/${n}`,
    status: `${status} OK`,
    status_code: status,
    content_type: "text/html",
    length: "100",
    metadata: { armory_run_id: run },
    requested_at: "2026-11-06T22:00:00+04:00",
    responded_at: "2026-11-06T22:00:01+04:00",
    highlight: null,
    upstream_proxy: null,
  };
}

test("a run's traffic is the pairs its metadata names, oldest first, any content type", async () => {
  const routes = serviceRoutes();
  // Each page comes in reverse display order.
  routes["GET /traffic"] = () => ({ items: [summary(2), summary(1)], next_cursor: null, as_of: "p0002", index: { complete: true } });
  const { store, client } = setup(routes);
  await store.runTraffic.open("r2");
  const [, , query] = client.calls.find(([m, p]) => m === "GET" && p === "/traffic");
  assert.equal(query.q, 'metadata.armory_run_id = "r2"');
  assert.equal(query.order_by, "requested_at");
  assert.equal(query.exclude, undefined);
  const rows = get(store.runTraffic).list.rows;
  assert.deepEqual(rows.map((r) => [r.ID, r.Number, r.StatusCode, r.Length]), [
    ["p0001", 1, 200, "100"],
    ["p0002", 2, 200, "100"],
  ]);
  assert.equal(get(store.runTraffic).list.asOf, "p0002");
});

test("a read over the service's page limit is split into pages under one as_of", async () => {
  const routes = serviceRoutes();
  const pages = [];
  routes["GET /traffic"] = (query) => {
    pages.push(query);
    const start = query.cursor ? Number(query.cursor) : 0;
    const items = Array.from({ length: query.limit }, (_, i) => summary(start + i + 1)).reverse();
    return { items, next_cursor: String(start + query.limit), as_of: "p9999", index: { complete: true } };
  };
  const api = createArmoryApi(fakeClient(routes));
  const page = await api.QueryArmoryRunTraffic("r2", { Limit: 700 });
  assert.deepEqual(pages.map((q) => [q.limit, q.cursor, q.as_of]), [
    [500, undefined, undefined],
    [200, "500", "p9999"],
  ]);
  assert.equal(page.Items.length, 700);
  assert.equal(page.Items[0].Number, 1);
  assert.equal(page.Items[699].Number, 700);
  assert.equal(page.NextCursor, "700");
  assert.equal(page.AsOf, "p9999");
});

test("a group's rows narrow the run's query", async () => {
  const routes = serviceRoutes();
  routes["GET /traffic"] = () => ({ items: [], next_cursor: null, as_of: null, index: { complete: true } });
  const client = fakeClient(routes);
  await createArmoryApi(client).QueryArmoryRunTraffic("r2", { Query: "status_code = 403", OrderBy: "length desc" });
  const [, , query] = client.calls.at(-1);
  assert.equal(query.q, 'metadata.armory_run_id = "r2" AND (status_code = 403)');
  assert.equal(query.order_by, "length desc");
});

test("grouped by status, the run's pairs are counted by the service", async () => {
  const routes = serviceRoutes();
  routes["GET /traffic/count/by-field"] = { items: [{ value: "200", count: 7 }, { value: "403", count: 2 }], as_of: "p0009", index: { complete: true } };
  routes["GET /traffic"] = (query) => ({
    items: query.q.includes("403") ? [summary(9, { status: 403 })] : [summary(1)],
    next_cursor: null,
    as_of: query.as_of,
    index: { complete: true },
  });
  const { store, client } = setup(routes);
  await store.runTraffic.groupBy("status");
  await store.runTraffic.open("r2");
  const [, , query] = client.calls.find(([m, p]) => p === "/traffic/count/by-field");
  assert.deepEqual(query, { q: 'metadata.armory_run_id = "r2"', field: "status_code", as_of: undefined });
  assert.deepEqual(get(store.runTraffic).grouping.counts, [
    { value: "200", count: 7 },
    { value: "403", count: 2 },
  ]);
  assert.equal(get(store.runTraffic).grouping.asOf, "p0009");
});

test("a run event keeps its template's runs and the active runs current", async () => {
  const { store } = setup();
  await store.populate();
  await store.loadRuns(T1);
  store.onRun(run("r2", T1, "complete"));
  assert.equal(get(store).runsByTemplate[T1].find((r) => r.ID === "r2").Status, "complete");
  assert.deepEqual(activeRunIdsOf(get(store)), ["r3"]);
  store.onRun(run("r5", T1, "in_progress"));
  assert.deepEqual(get(store).runsByTemplate[T1].map((r) => r.ID), ["r1", "r2", "r5"]);
  assert.deepEqual(activeRunIdsOf(get(store)).sort(), ["r3", "r5"]);
});

test("a deleted run leaves its template's runs and the selection", async () => {
  const { store } = setup();
  await store.populate();
  await store.loadRuns(T1);
  store.selectRun(T1, "r1");
  store.onRunDeleted({ id: "r1" });
  assert.deepEqual(get(store).runsByTemplate[T1].map((r) => r.ID), ["r2"]);
  assert.equal(get(store).selectedRunByTemplate[T1], null);
});

test("template events add, change and remove templates", async () => {
  const { store } = setup();
  await store.populate();
  store.onTemplate({ id: "t3", name: "Third", description: "", raw_template: "GET /3 HTTP/1.1" });
  store.onTemplate({ id: T1, name: "Renamed", description: "login", raw_template: "POST /login HTTP/1.1" });
  store.onTemplateDeleted({ id: T2 });
  assert.deepEqual(get(store).templates.map((t) => [t.ID, t.Name]), [
    [T1, "Renamed"],
    ["t3", "Third"],
  ]);
});

test("wordlist events replace the wordlists", async () => {
  const { store } = setup();
  await store.populate();
  store.onWordlists({ items: [{ name: "a.txt", size: 1 }, { name: "words.txt", size: 120 }] });
  assert.deepEqual(get(store).wordlists.map((w) => w.Name), ["a.txt", "words.txt"]);
});

test("starting a run marks it running without polling", async () => {
  const routes = serviceRoutes();
  routes["POST /armory/run/r4/start"] = run("r4", T2, "in_progress");
  routes["GET /armory/run/r4"] = run("r4", T2, "in_progress");
  const { store } = setup(routes);
  await store.populate();
  await store.loadRuns(T2);
  const started = await store.startRun("r4");
  assert.equal(started.Status, "in_progress");
  assert.equal(get(store).runsByTemplate[T2].find((r) => r.ID === "r4").Status, "in_progress");
  assert.ok(activeRunIdsOf(get(store)).includes("r4"));
});

test("resync reads the runs again, so a run started while away shows as running", async () => {
  const routes = serviceRoutes();
  const { store } = setup(routes);
  await store.populate();
  await store.loadRuns(T2);
  // While the app was disconnected, r4 started and r3 finished.
  routes[`GET /armory/template/${T2}/run`] = { items: [run("r3", T2, "complete"), run("r4", T2, "in_progress")] };
  await store.resync();
  assert.deepEqual(get(store).runsByTemplate[T2].map((r) => [r.ID, r.Status]), [
    ["r3", "complete"],
    ["r4", "in_progress"],
  ]);
  assert.deepEqual(activeRunIdsOf(get(store)).sort(), ["r2", "r4"]);
});

test("resync keeps the selection, drafts, run settings and search", async () => {
  const routes = serviceRoutes();
  const { store } = setup(routes);
  await store.populate();
  const [first] = get(store).templates;
  store.selectTemplate(first);
  store.updateTemplateDraft(T1, { name: "First", description: "login", rawTemplate: "edited, unsaved" });
  store.updateRunSettings(T1, { attackType: "broadside", useHTTPS: false, selectedWordlists: ["words.txt"], maxConcurrent: 3 });
  store.selectRun(T1, "r1");
  store.setSearch("fir");
  store.setDrawerSplit(0.6);
  routes["GET /wordlist"] = { items: [{ name: "new.txt", size: 9 }, { name: "words.txt", size: 120 }] };
  await store.resync();
  const state = get(store);
  assert.equal(state.selectedTemplateId, T1);
  assert.equal(state.templateDraft.rawTemplate, "edited, unsaved");
  assert.equal(state.runSettingsByTemplate[T1].attackType, "broadside");
  assert.equal(state.selectedRunByTemplate[T1], "r1");
  assert.equal(state.search, "fir");
  assert.equal(state.drawerSplit, 0.6);
  assert.deepEqual(state.wordlists.map((w) => w.Name), ["new.txt", "words.txt"]);
});

test("resync drops a template deleted while away", async () => {
  const routes = serviceRoutes();
  const { store } = setup(routes);
  await store.populate();
  routes["GET /armory/template"] = { items: [{ id: T1, name: "First", description: "login" }] };
  await store.resync();
  assert.deepEqual(get(store).templates.map((t) => t.ID), [T1]);
});

test("resync reads the open run's traffic again, keeping the open pair", async () => {
  const routes = serviceRoutes();
  let pairs = [summary(1)];
  routes["GET /traffic"] = () => ({ items: [...pairs].reverse(), next_cursor: null, as_of: pairs.at(-1).id, index: { complete: true } });
  const { store } = setup(routes);
  await store.populate();
  await store.runTraffic.open("r2");
  store.runTraffic.clickPair("p0001");
  pairs = [summary(1), summary(2)];
  await store.resync();
  assert.deepEqual(get(store.runTraffic).list.rows.map((r) => r.ID), ["p0001", "p0002"]);
  assert.equal(get(store.runTraffic).openId, "p0001");
});

test("cancelling the active runs cancels each and waits until none is running", async () => {
  const routes = serviceRoutes();
  const reads = { r2: 0, r3: 0 };
  for (const [id, template] of [["r2", T1], ["r3", T2]]) {
    routes[`POST /armory/run/${id}/cancel`] = run(id, template, "in_progress");
    // The run stops a moment after the cancel.
    routes[`GET /armory/run/${id}`] = () => run(id, template, ++reads[id] < 3 ? "in_progress" : "cancelled");
  }
  const { store, client } = setup(routes);
  await store.populate();
  await store.cancelActiveRuns({ sleep: async () => {} });
  const cancels = client.calls.filter(([m, p]) => m === "POST" && p.endsWith("/cancel")).map(([, p]) => p);
  assert.deepEqual(cancels.sort(), ["/armory/run/r2/cancel", "/armory/run/r3/cancel"]);
  assert.deepEqual(reads, { r2: 3, r3: 3 });
  assert.deepEqual(activeRunIdsOf(get(store)), []);
});

test("a run that stopped on its own before the cancel isn't an error", async () => {
  const routes = serviceRoutes();
  routes["POST /armory/run/r2/cancel"] = () => {
    throw Object.assign(new Error("POST /armory/run/r2/cancel: run_not_active: armory run is not active"), { code: "run_not_active" });
  };
  routes["POST /armory/run/r3/cancel"] = run("r3", T2, "in_progress");
  routes["GET /armory/run/r2"] = run("r2", T1, "complete");
  routes["GET /armory/run/r3"] = run("r3", T2, "cancelled");
  const { store } = setup(routes);
  await store.populate();
  await store.cancelActiveRuns({ sleep: async () => {} });
  assert.deepEqual(activeRunIdsOf(get(store)), []);
});

test("cancelling gives up when a run keeps running", async () => {
  const routes = serviceRoutes();
  routes[`GET /armory/template/${T2}/run`] = { items: [] };
  routes["POST /armory/run/r2/cancel"] = run("r2", T1, "in_progress");
  routes["GET /armory/run/r2"] = run("r2", T1, "in_progress");
  const { store } = setup(routes);
  await store.populate();
  let now = 0;
  await assert.rejects(
    store.cancelActiveRuns({ timeoutMs: 1000, sleep: async (ms) => (now += ms), now: () => now }),
    /timed out cancelling active Armory runs/,
  );
});

test("with nothing running, cancelling calls nothing", async () => {
  const routes = serviceRoutes();
  routes[`GET /armory/template/${T1}/run`] = { items: [] };
  routes[`GET /armory/template/${T2}/run`] = { items: [] };
  const { store, client } = setup(routes);
  await store.populate();
  await store.cancelActiveRuns({ sleep: async () => {} });
  assert.ok(!client.calls.some(([m]) => m === "POST"));
});
