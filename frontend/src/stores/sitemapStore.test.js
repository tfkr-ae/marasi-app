import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  createSitemapStore,
  hostCountLabel,
  sitemapRows,
  sitemapScope,
  FETCH_SIZE,
  STEP,
  WINDOW,
  SITEMAP_SETTLE_MS,
} from "./createSitemapStore.js";

const API = "https://api.acme.test";
const V2 = `${API}/v2`;

function child(name, pairs, { errors = 0, hasChildren = false, matching } = {}) {
  const segment = name.includes("/", name.indexOf("://") + 3) ? name.slice(name.lastIndexOf("/") + 1) : name;
  return { Name: name, Segment: segment, Pairs: pairs, Errors: errors, HasChildren: hasChildren, Matching: matching };
}

// A Marasi sitemap held in memory: children by node name ("" for the
// origins), busiest first, paged by offset. `matching` holds the children
// query mode returns instead. Calls are recorded in `api.calls`.
function fakeApi({ tree = {}, matching = {}, complete = true } = {}) {
  const calls = [];
  const api = {
    calls,
    levelCalls: [],
    tree,
    complete,
    // One call for several nodes: each node's first page, or its cursor's.
    listSitemapLevels: async (request) => {
      api.levelCalls.push(request);
      const levels = [];
      let done = true;
      for (const node of request.Nodes) {
        const page = await api.listSitemapChildren(
          { ...request, Node: node, Cursor: request.Cursors?.[node] ?? "" },
          { record: false },
        );
        done &&= page.Complete;
        levels.push({ Node: node, Children: page.Children, NextCursor: page.NextCursor, Missing: page.Missing });
      }
      return { Levels: levels, Complete: done };
    },
    listSitemapChildren: async (request, { record = true } = {}) => {
      if (record) calls.push(request);
      const source = request.Matching ? matching : api.tree;
      if (!(request.Node in source) && request.Node !== "") {
        return { Children: [], NextCursor: null, Complete: true, Missing: true };
      }
      const all = source[request.Node] ?? [];
      const from = request.Cursor ? Number(request.Cursor) : 0;
      const to = from + request.Limit;
      return {
        Children: all.slice(from, to).map((c) => ({ ...c })),
        NextCursor: to < all.length ? String(to) : null,
        Complete: api.complete,
        Missing: false,
      };
    },
  };
  return api;
}

function many(parent, count, pairsFrom = 1000) {
  return Array.from({ length: count }, (_, i) => child(`${parent}/p${i}`, pairsFrom - i));
}

const LIVE = { query: "", asOf: null, exclusion: [], ready: true };

async function loadedStore(api, context = LIVE) {
  const store = createSitemapStore(api);
  store.setContext(context);
  await store.settled();
  return store;
}

function nodeRows(state, find = "") {
  return sitemapRows(state, find)
    .filter((row) => row.kind === "node")
    .map((row) => `${"  ".repeat(row.depth)}${row.node.Segment}`);
}

test("the origins load once the ledger's first rows have", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5, { hasChildren: true }), child("https://www.acme.test", 2)] } });
  const store = createSitemapStore(api);

  store.setContext({ ...LIVE, ready: false });
  await store.settled();
  assert.equal(api.levelCalls.length, 0);

  store.setContext(LIVE);
  await store.settled();
  assert.deepEqual(nodeRows(get(store)), [API, "https://www.acme.test"]);
  assert.deepEqual(api.levelCalls, [
    { Nodes: [""], Cursors: {}, Limit: FETCH_SIZE, Query: "", AsOf: "", Matching: false, Exclusion: [] },
  ]);
  assert.equal(hostCountLabel(get(store)), "2 hosts");

  // Later reads of the table, such as a new sort, don't read it again.
  store.setContext({ ...LIVE, ready: false });
  store.setContext(LIVE);
  await store.settled();
  assert.equal(api.levelCalls.length, 1);
});

test("the sitemap reads under the ledger's exclusion, not whatever is stored yet", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5)] } });
  const store = await loadedStore(api);
  store.setContext({ ...LIVE, exclusion: ["image/*"] });
  await store.settled();
  assert.deepEqual(api.levelCalls.at(-1).Exclusion, ["image/*"]);
});

test("each level shows its busiest 10 children, then N more, 50 at a time", async () => {
  const api = fakeApi({ tree: { "": [child(API, 9999, { hasChildren: true })], [API]: many(API, 75) } });
  const store = await loadedStore(api);

  store.toggle(API);
  await store.settled();
  let rows = sitemapRows(get(store));
  assert.equal(rows.filter((row) => row.kind === "node" && row.depth === 1).length, WINDOW);
  assert.deepEqual(rows.at(-1), { kind: "more", parent: API, depth: 1, hidden: 65, partial: false });

  store.showMore(API);
  rows = sitemapRows(get(store));
  assert.equal(rows.filter((row) => row.kind === "node" && row.depth === 1).length, WINDOW + STEP);
  assert.equal(rows.at(-1).hidden, 15);

  store.showMore(API);
  rows = sitemapRows(get(store));
  assert.equal(rows.filter((row) => row.kind === "node" && row.depth === 1).length, 75);
  assert.notEqual(rows.at(-1).kind, "more");
});

test("showing more past the loaded children reads the next page by cursor", async () => {
  const api = fakeApi({ tree: { "": [child(API, 9999, { hasChildren: true })], [API]: many(API, FETCH_SIZE + 3) } });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  assert.deepEqual(sitemapRows(get(store)).at(-1), { kind: "more", parent: API, depth: 1, hidden: FETCH_SIZE - WINDOW, partial: true });

  for (let shown = WINDOW; shown < FETCH_SIZE; shown += STEP) store.showMore(API);
  await store.settled();

  const last = api.calls.at(-1);
  assert.equal(last.Node, API);
  assert.equal(last.Cursor, String(FETCH_SIZE));
  const rows = sitemapRows(get(store));
  assert.equal(rows.filter((row) => row.kind === "node" && row.depth === 1).length, FETCH_SIZE + 3);
});

test("a node's children load when it is first opened, and Collapse all closes every node", async () => {
  const api = fakeApi({
    tree: {
      "": [child(API, 3, { hasChildren: true })],
      [API]: [child(V2, 3, { hasChildren: true })],
      [V2]: [child(`${V2}/users`, 2), child(`${V2}/{int}`, 1)],
    },
  });
  const store = await loadedStore(api);

  store.toggle(API);
  await store.settled();
  store.toggle(V2);
  await store.settled();
  assert.deepEqual(nodeRows(get(store)), [API, "  v2", "    users", "    {int}"]);

  store.toggle(V2);
  store.toggle(V2);
  await store.settled();
  assert.equal(api.calls.filter((call) => call.Node === V2).length, 1);

  store.collapseAll();
  assert.deepEqual(nodeRows(get(store)), [API]);
});

test("the find box keeps nodes whose name matches, with the loaded nodes leading to them", async () => {
  const api = fakeApi({
    tree: {
      "": [child(API, 3, { hasChildren: true }), child("https://www.acme.test", 2, { hasChildren: true })],
      [API]: [child(V2, 3, { hasChildren: true })],
      [V2]: [child(`${V2}/users`, 2), child(`${V2}/orders`, 1)],
      "https://www.acme.test": [child("https://www.acme.test/about", 2)],
    },
  });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  store.toggle(V2);
  await store.settled();
  store.collapseAll();

  assert.deepEqual(nodeRows(get(store), "USERS"), [API, "  v2", "    users"]);
  assert.deepEqual(nodeRows(get(store), "www"), ["https://www.acme.test"]);
  assert.deepEqual(nodeRows(get(store), "nothing"), []);
});

test("Matching the query is only in effect while a query runs, with its results' as_of", async () => {
  const api = fakeApi({
    tree: { "": [child(API, 5), child("https://www.acme.test", 2)] },
    matching: { "": [child(API, 1)] },
  });
  const store = await loadedStore(api);
  store.setScope("matching");
  assert.equal(sitemapScope(get(store)), "all");

  store.setContext({ ...LIVE, query: "status_code >= 500", asOf: "pair-9" });
  await store.settled();
  assert.equal(sitemapScope(get(store)), "matching");
  assert.deepEqual(api.levelCalls.at(-1), {
    Nodes: [""], Cursors: {}, Limit: FETCH_SIZE, Query: "status_code >= 500", AsOf: "pair-9", Matching: true, Exclusion: [],
  });
  assert.deepEqual(nodeRows(get(store)), [API]);

  store.setContext(LIVE);
  await store.settled();
  assert.equal(sitemapScope(get(store)), "all");
  assert.equal(api.levelCalls.at(-1).Matching, false);
  assert.deepEqual(nodeRows(get(store)), [API, "https://www.acme.test"]);
});

test("All traffic with a query asks for matching counts and dims nodes without matches", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5, { matching: 2 }), child("https://www.acme.test", 2, { matching: 0 })] } });
  const store = await loadedStore(api, { ...LIVE, query: "note:*", asOf: "pair-3" });

  assert.deepEqual(api.levelCalls.at(-1), { Nodes: [""], Cursors: {}, Limit: FETCH_SIZE, Query: "note:*", AsOf: "pair-3", Matching: false, Exclusion: [] });
  const rows = sitemapRows(get(store)).filter((row) => row.kind === "node");
  assert.deepEqual(
    rows.map((row) => [row.node.Segment, row.matching, row.dimmed]),
    [[API, 2, false], ["https://www.acme.test", 0, true]],
  );
});

test("the open levels reload when the query, its as_of or the exclusion changes, and stale reads are dropped", async () => {
  const api = fakeApi({
    tree: { "": [child(API, 5, { hasChildren: true })], [API]: [child(V2, 5)] },
  });
  const store = await loadedStore(api, { ...LIVE, query: "note:*", asOf: "pair-3" });
  store.toggle(API);
  await store.settled();
  const before = api.calls.length;

  // Live traffic moves the live view's as_of; that alone reloads nothing.
  store.setContext({ ...LIVE, asOf: "pair-4" });
  store.setContext({ ...LIVE, asOf: "pair-5" });
  await store.settled();
  // One call reads every open level.
  assert.deepEqual(api.levelCalls.slice(-1).map((call) => call.Nodes), [["", API]]);
  const levelsBefore = api.levelCalls.length;

  store.setContext({ ...LIVE, asOf: "pair-6" });
  await store.settled();
  assert.equal(api.levelCalls.length, levelsBefore);

  store.setContext({ ...LIVE, asOf: "pair-6", exclusion: ["image/*"] });
  await store.settled();
  assert.equal(api.levelCalls.length, levelsBefore + 1);

  store.setContext({ ...LIVE, query: "note:*", asOf: "pair-6", exclusion: ["image/*"] });
  store.setContext({ ...LIVE, query: "note:*", asOf: "pair-7", exclusion: ["image/*"] });
  await store.settled();
  assert.deepEqual(
    api.levelCalls.slice(-1).map((call) => [call.Nodes, call.AsOf]),
    [[["", API], "pair-7"]],
    "the newest reload's answer is the one shown",
  );
  assert.equal(api.calls.length, before, "no single-level reads");
});

test("the header warns while Marasi's sitemap is still building", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5)] }, complete: false });
  const store = await loadedStore(api);
  assert.equal(get(store).complete, false);

  api.complete = true;
  store.reload();
  await store.settled();
  assert.equal(get(store).complete, true);
});

test("the header counts no hosts until the building sitemap places one", async () => {
  const api = fakeApi({ tree: { "": [] }, complete: false });
  const store = await loadedStore(api);
  assert.equal(hostCountLabel(get(store)), "", "no count while none are placed");

  api.tree[""] = [child(API, 5)];
  store.reload();
  await store.settled();
  assert.equal(hostCountLabel(get(store)), "1 host");

  api.tree[""] = [];
  api.complete = true;
  store.reload();
  await store.settled();
  assert.equal(hostCountLabel(get(store)), "0 hosts", "a finished empty sitemap still counts");
});

test("new pairs bump their leaf and its loaded ancestors in All traffic", async () => {
  const api = fakeApi({
    tree: {
      "": [child(API, 5, { hasChildren: true })],
      [API]: [child(V2, 5, { hasChildren: true })],
      [V2]: [child(`${V2}/users`, 4), child(`${V2}/{int}`, 1)],
    },
  });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  store.toggle(V2);
  await store.settled();

  store.onRequest({ ID: "a", SitemapNode: `${V2}/{int}` });
  store.onRequest({ ID: "b", SitemapNode: `${V2}/carts` });
  store.onRequest({ ID: "c", SitemapNode: "https://new.acme.test/x" });
  store.flush();

  const counts = sitemapRows(get(store))
    .filter((row) => row.kind === "node")
    .map((row) => `${row.node.Segment} ${row.node.Pairs}${row.node.HasChildren ? "+" : ""}`);
  assert.deepEqual(counts, [`${API} 7+`, "v2 7+", "users 4", "{int} 2", "carts 1", "https://new.acme.test 1+"]);
  assert.equal(hostCountLabel(get(store)), "2 hosts");
});

test("a response bumps its node's 5xx count, and drops a pair the exclusion hides", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5, { hasChildren: true })], [API]: [child(`${API}/a`, 5)] } });
  const store = await loadedStore(api, { ...LIVE, exclusion: ["image/*"] });
  store.toggle(API);
  await store.settled();

  store.onRequest({ ID: "a", SitemapNode: `${API}/a` });
  store.onRequest({ ID: "b", SitemapNode: `${API}/a` });
  store.onResponse({ ID: "a", StatusCode: 503, ContentType: "text/html" });
  store.onResponse({ ID: "b", StatusCode: 200, ContentType: "image/png" });
  store.flush();

  const rows = sitemapRows(get(store)).filter((row) => row.kind === "node");
  assert.deepEqual(rows.map((row) => [row.node.Pairs, row.node.Errors]), [[6, 1], [6, 1]]);
});

test("live pairs leave Matching the query's snapshot counts alone", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5)] }, matching: { "": [child(API, 1)] } });
  const store = await loadedStore(api, { ...LIVE, query: "note:*", asOf: "pair-1" });
  store.setScope("matching");
  await store.settled();

  store.onRequest({ ID: "a", SitemapNode: `${API}/x` });
  store.flush();

  assert.equal(sitemapRows(get(store))[0].node.Pairs, 1);
});

test("a project switch empties the sitemap until it loads again", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5, { hasChildren: true })], [API]: [child(V2, 5)] } });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();

  store.clear();
  assert.deepEqual(nodeRows(get(store)), []);

  api.tree = { "": [child("https://other.test", 1)] };
  store.setContext(LIVE);
  await store.settled();
  assert.deepEqual(nodeRows(get(store)), ["https://other.test"]);
});

test("a reload reads only the open levels; a closed one reads again when it next opens", async () => {
  const api = fakeApi({
    tree: { "": [child(API, 5, { hasChildren: true })], [API]: [child(V2, 5)] },
  });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  store.toggle(API);

  store.reload();
  await store.settled();
  assert.deepEqual(api.levelCalls.at(-1).Nodes, [""]);

  store.toggle(API);
  await store.settled();
  assert.equal(api.calls.at(-1).Node, API);
  assert.deepEqual(nodeRows(get(store)), [API, "  v2"]);
});

// Holds each read until the test releases it, recording the most reads in
// flight at once.
function gatedApi(base) {
  const waiting = [];
  let inFlight = 0;
  const gate = (read) => (request) =>
    new Promise((resolve) => {
      inFlight++;
      api.maxInFlight = Math.max(api.maxInFlight, inFlight);
      waiting.push(() => {
        inFlight--;
        resolve(read(request));
      });
    });
  const api = {
    calls: base.calls,
    levelCalls: base.levelCalls,
    maxInFlight: 0,
    waiting,
    listSitemapChildren: gate(base.listSitemapChildren),
    listSitemapLevels: gate(base.listSitemapLevels),
    async releaseAll() {
      while (waiting.length) {
        waiting.shift()();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
  return api;
}

const TREE = {
  "": [child(API, 5, { hasChildren: true })],
  [API]: [child(V2, 5, { hasChildren: true }), child(`${API}/v1`, 3, { hasChildren: true })],
  [V2]: [child(`${V2}/users`, 4)],
  [`${API}/v1`]: [child(`${API}/v1/items`, 3)],
};

async function openTree(api) {
  const store = createSitemapStore(api);
  store.setContext(LIVE);
  await api.releaseAll();
  for (const name of [API, V2, `${API}/v1`]) {
    store.toggle(name);
    await api.releaseAll();
  }
  return store;
}

test("a reload shows the open levels' old counts as stale until its read lands", async () => {
  const api = gatedApi(fakeApi({ tree: TREE }));
  const store = await openTree(api);
  store.setContext({ ...LIVE, query: "note:*", asOf: "pair-9" });
  const stale = () => sitemapRows(get(store)).filter((r) => r.kind === "node" && r.stale).map((r) => r.node.Segment);
  assert.deepEqual(stale(), [API, "v2", "users", "v1", "items"], "every loaded count is stale until the read lands");
  await api.releaseAll();
  assert.deepEqual(stale(), []);
});

test("showing more of a level doesn't mark its counts stale", async () => {
  const api = fakeApi({ tree: { "": [child(API, 5, { hasChildren: true })], [API]: many(API, FETCH_SIZE + 20) } });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  for (let i = 0; i < Math.ceil(FETCH_SIZE / STEP); i++) store.showMore(API);
  assert.ok(sitemapRows(get(store)).every((r) => !r.stale));
  await store.settled();
});

test("a reload reads every open level in one call, in groups of 64", async () => {
  const names = Array.from({ length: 70 }, (_, i) => `${API}/n${i}`);
  const tree = { "": [child(API, 70, { hasChildren: true })], [API]: names.map((n) => child(n, 1, { hasChildren: true })) };
  for (const n of names) tree[n] = [child(`${n}/leaf`, 1)];
  const api = fakeApi({ tree });
  const store = await loadedStore(api);
  store.toggle(API);
  for (const n of names) store.toggle(n);
  await store.settled();
  store.setContext({ ...LIVE, query: "note:*", asOf: "pair-9" });
  await store.settled();
  assert.deepEqual(api.levelCalls.slice(-2).map((c) => c.Nodes.length), [64, 8]);
  assert.ok(sitemapRows(get(store)).every((r) => !r.stale));
});

test("an older reload's answer arriving after a newer one's is dropped", async () => {
  const api = gatedApi(fakeApi({ tree: TREE, matching: { "": [child(API, 1)] } }));
  const store = await openTree(api);
  store.setContext({ ...LIVE, query: "a:*", asOf: "pair-9" });
  store.setScope("matching");
  // Answer the newer (Matching) read first, then the older one.
  api.waiting.pop()();
  await new Promise((r) => setTimeout(r, 0));
  await api.releaseAll();
  assert.deepEqual(nodeRows(get(store)), [API]);
  assert.deepEqual(sitemapRows(get(store)).filter((r) => r.stale), []);
});

test("sitemap.changed rereads the open levels once a burst settles, keeping what is open", async (t) => {
  const api = fakeApi({
    tree: {
      "": [child(API, 3, { hasChildren: true })],
      [API]: [child(V2, 3, { hasChildren: true })],
      [V2]: [child(`${V2}/users`, 2), child(`${V2}/{int}`, 1)],
    },
  });
  const store = await loadedStore(api);
  store.toggle(API);
  await store.settled();
  store.toggle(V2);
  await store.settled();
  const reads = api.levelCalls.length;

  // Another client deleted the /{int} pair, and the sitemap was rebuilt.
  api.tree[V2] = [child(`${V2}/users`, 2)];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  store.onChanged({ reason: "delete" });
  t.mock.timers.tick(SITEMAP_SETTLE_MS - 1);
  store.onChanged({ reason: "rebuild" });
  t.mock.timers.tick(SITEMAP_SETTLE_MS - 1);
  assert.equal(api.levelCalls.length, reads, "nothing reads while changes keep coming");
  t.mock.timers.tick(1);
  t.mock.timers.reset();
  await store.settled();

  assert.equal(api.levelCalls.length, reads + 1, "one read for the burst");
  assert.deepEqual(nodeRows(get(store)), [API, "  v2", "    users"]);
});
