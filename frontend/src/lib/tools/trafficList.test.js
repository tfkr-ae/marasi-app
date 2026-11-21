import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createTrafficList } from "./trafficList.js";

function fakeTraffic() {
  const handlers = new Map();
  const reads = [];
  let rows = [{ ID: "a", Number: 1 }, { ID: "b", Number: 2 }];
  return {
    reads,
    setRows: (next) => (rows = next),
    async read(query) {
      reads.push(query);
      if (query === "bad =") return { Items: [], QueryError: { Message: "unexpected end of query" } };
      return { Items: rows, QueryError: null };
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit: (name, data) => handlers.get(name)?.(data),
    listening: () => handlers.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the list reads the newest pairs first, and the query narrows it", async () => {
  const traffic = fakeTraffic();
  const list = createTrafficList({ read: traffic.read, on: traffic.on, settleMs: 0 });
  const stop = list.start();
  await settle();
  assert.deepEqual(get(list).pairs.map((p) => p.Number), [2, 1]);
  list.setQuery('host = "api"');
  await settle();
  assert.equal(traffic.reads.at(-1), 'host = "api"');
  assert.equal(get(list).query, 'host = "api"');
  stop();
});

test("a query Marasi refuses shows its error and keeps no rows", async () => {
  const traffic = fakeTraffic();
  const list = createTrafficList({ read: traffic.read, on: traffic.on, settleMs: 0 });
  const stop = list.start();
  list.setQuery("bad =");
  await settle();
  assert.equal(get(list).error, "unexpected end of query");
  assert.deepEqual(get(list).pairs, []);
  stop();
});

test("new and changed traffic read the list again while it is shown", async () => {
  const traffic = fakeTraffic();
  const list = createTrafficList({ read: traffic.read, on: traffic.on, settleMs: 0 });
  const stop = list.start();
  await settle();
  traffic.setRows([{ ID: "c", Number: 3 }]);
  traffic.emit("traffic.request", {});
  await settle();
  assert.deepEqual(get(list).pairs.map((p) => p.ID), ["c"]);
  stop();
  assert.equal(traffic.listening(), 0);
});
