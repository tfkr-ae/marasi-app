// The rows of the pairs on cards, read through createToolTrafficApi over a
// fake service client and kept live by createPairRowsStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { fakeServiceClient } from "./fakeServiceClient.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { createPairRowsStore } from "./createPairRowsStore.js";

// The service's pairs by id (snake_case, as GET /traffic lists them).
function trafficService(pairs) {
  const reads = [];
  const client = fakeServiceClient({
    "GET /traffic": (query) => {
      reads.push(query.q);
      const ids = [...(query.q ?? "").matchAll(/id = "([^"]+)"/g)].map((m) => m[1]);
      return { items: ids.filter((id) => pairs[id]).map((id) => ({ id, number: 1, ...pairs[id] })) };
    },
  });
  return { client, reads, pairs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(pairs, client = null) {
  const service = trafficService(pairs);
  const store = createPairRowsStore(createToolTrafficApi(client ?? service.client), { settleMs: 0 });
  return { service, store };
}

test("tracked pairs are read in one query and kept by id", async () => {
  const { service, store } = setup({ a: { highlight: null }, b: { highlight: 2 } });
  const stop = store.track(["a", "b"]);
  await settle();
  assert.equal(service.reads.length, 1);
  assert.equal(get(store).a.ID, "a");
  assert.equal(get(store).b.Highlight, 2);
  stop();
});

test("a tracked pair the service no longer has reads as deleted (null)", async () => {
  const { store } = setup({ a: {} });
  const stop = store.track(["a", "gone"]);
  await settle();
  assert.equal(get(store).gone, null);
  stop();
});

test("traffic changes, a tracked pair's response and its metadata read it again", async () => {
  const { service, store } = setup({ a: { highlight: null, status_code: 0 } });
  const stop = store.track(["a"]);
  await settle();
  service.pairs.a = { highlight: 3, status_code: 0 };
  store.onTrafficChanged({ change: "highlight" });
  await settle();
  assert.equal(get(store).a.Highlight, 3);

  service.pairs.a = { ...service.pairs.a, status_code: 200 };
  store.onPairEvent({ id: "a" });
  await settle();
  assert.equal(get(store).a.StatusCode, 200);

  const reads = service.reads.length;
  store.onPairEvent({ id: "other" });
  await settle();
  assert.equal(service.reads.length, reads, "events for untracked pairs read nothing");

  delete service.pairs.a;
  store.onTrafficChanged({ change: "delete" });
  await settle();
  assert.equal(get(store).a, null);
  stop();
});

test("with nothing tracked, events read nothing", async () => {
  const { service, store } = setup({ a: {} });
  store.track(["a"])();
  await settle();
  const reads = service.reads.length;
  store.onTrafficChanged({});
  store.onPairEvent({ id: "a" });
  await settle();
  assert.equal(service.reads.length, reads);
});

test("a pair that changed while nothing tracked it is read again once tracked", async () => {
  const { service, store } = setup({ a: { highlight: null }, b: { highlight: null } });
  store.track(["a", "b"])();
  await settle();
  service.pairs.a = { highlight: 7 };
  store.onTrafficChanged({ change: "highlight" });
  service.pairs.b = { highlight: null, status_code: 404 };
  store.onPairEvent({ id: "b" });
  await settle();
  const stop = store.track(["a", "b"]);
  await settle();
  assert.equal(get(store).a.Highlight, 7);
  assert.equal(get(store).b.StatusCode, 404);
  stop();
});

test("a pair read and unchanged since is not read again when tracked again", async () => {
  const { service, store } = setup({ a: {} });
  store.track(["a"])();
  await settle();
  const reads = service.reads.length;
  store.track(["a"])();
  await settle();
  assert.equal(service.reads.length, reads);
});

test("a failed read keeps the rows it had", async () => {
  let fail = false;
  const service = trafficService({ a: {} });
  const client = fakeServiceClient({
    "GET /traffic": (query, body) => (fail ? { status: 500, body: { error: "down" } } : service.client.get("/traffic", query, body)),
  });
  const { store } = setup({}, client);
  const stop = store.track(["a"]);
  await settle();
  fail = true;
  store.onTrafficChanged({});
  await settle();
  assert.equal(get(store).a.ID, "a");
  stop();
});

test("a read the connection moved past writes nothing", async () => {
  const service = trafficService({ a: {} });
  let live = true;
  const client = { ...service.client, bind: () => ({ live: () => live }) };
  const { store } = setup({}, client);
  const stop = store.track(["a"]);
  live = false;
  await settle();
  assert.deepEqual(get(store), {});
  stop();
});

test("clear forgets the last project's rows, and a read still under way writes nothing", async () => {
  const { store } = setup({ a: {} });
  const stop = store.track(["a"]);
  store.clear();
  await settle();
  assert.deepEqual(get(store), {});
  stop();
});

test("load and resync read every tracked pair again, keeping the trackers", async () => {
  const { service, store } = setup({ a: { highlight: 1 } });
  const stop = store.track(["a"]);
  await settle();
  service.pairs.a = { highlight: 4 };
  await store.resync();
  assert.equal(get(store).a.Highlight, 4);
  store.clear();
  await store.load();
  assert.equal(get(store).a.Highlight, 4);
  stop();
});
