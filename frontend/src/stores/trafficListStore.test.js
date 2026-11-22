// The Insert panel's traffic list, read through createToolTrafficApi over a
// fake service client and kept live by createTrafficListStore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { fakeServiceClient } from "./fakeServiceClient.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { createTrafficListStore } from "./createTrafficListStore.js";

function trafficService() {
  const reads = [];
  let items = [
    { id: "a", number: 1 },
    { id: "b", number: 2 },
  ];
  let down = false;
  const client = fakeServiceClient({
    "GET /traffic": (query) => {
      reads.push(query.q ?? "");
      if (down) return { status: 500, body: { error: "internal", message: "database is locked" } };
      if (query.q === "bad =") return { status: 400, body: { error: "invalid_query", message: "unexpected end of query" } };
      return { items };
    },
  });
  return {
    client,
    reads,
    setItems: (next) => (items = next),
    setDown: (next) => (down = next),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(client = null) {
  const service = trafficService();
  const list = createTrafficListStore(createToolTrafficApi(client ?? service.client), { settleMs: 0 });
  return { service, list };
}

test("the list reads the newest pairs first, and the query narrows it", async () => {
  const { service, list } = setup();
  const stop = list.start();
  await settle();
  assert.deepEqual(get(list).pairs.map((p) => p.Number), [2, 1]);
  list.setQuery('host = "api"');
  await settle();
  assert.equal(service.reads.at(-1), 'host = "api"');
  assert.equal(get(list).query, 'host = "api"');
  stop();
});

test("a query Marasi refuses shows its message and keeps no rows", async () => {
  const { list } = setup();
  const stop = list.start();
  list.setQuery("bad =");
  await settle();
  assert.equal(get(list).error, "unexpected end of query");
  assert.deepEqual(get(list).pairs, []);
  stop();
});

test("a failed read says so in the app's words, never the service's", async () => {
  const { service, list } = setup();
  service.setDown(true);
  const stop = list.start();
  await settle();
  assert.equal(get(list).error, "Couldn't read traffic");
  stop();
});

test("new and changed traffic read the list again while it is shown, and not after", async () => {
  const { service, list } = setup();
  const stop = list.start();
  await settle();
  service.setItems([{ id: "c", number: 3 }]);
  list.onTraffic();
  await settle();
  assert.deepEqual(get(list).pairs.map((p) => p.ID), ["c"]);
  stop();
  const reads = service.reads.length;
  list.onTraffic();
  await settle();
  assert.equal(service.reads.length, reads);
});

test("steady traffic still refreshes the list once the longest wait passes", async () => {
  const service = trafficService();
  const list = createTrafficListStore(createToolTrafficApi(service.client), { settleMs: 40, maxWaitMs: 80 });
  const stop = list.start();
  await settle();
  const reads = service.reads.length;
  const busy = setInterval(() => list.onTraffic(), 10);
  await new Promise((resolve) => setTimeout(resolve, 200));
  clearInterval(busy);
  assert.ok(service.reads.length > reads, "the list never read again while traffic kept arriving");
  stop();
});

test("a read the connection moved past writes nothing", async () => {
  const service = trafficService();
  let live = true;
  const client = { ...service.client, bind: () => ({ live: () => live }) };
  const { list } = setup(client);
  const stop = list.start();
  live = false;
  await settle();
  assert.deepEqual(get(list).pairs, []);
  stop();
});

test("clear forgets the last project's pairs and keeps the query; load reads them again while shown", async () => {
  const { list } = setup();
  const stop = list.start();
  list.setQuery("");
  await settle();
  list.clear();
  assert.deepEqual(get(list).pairs, []);
  await list.load();
  assert.equal(get(list).pairs.length, 2);
  stop();
});
