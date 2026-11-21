import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createPairRows } from "./pairRows.js";

// A traffic source: rows by id, the queries read, and events to publish.
function fakeTraffic(rows) {
  const handlers = new Map();
  const reads = [];
  return {
    rows,
    reads,
    async read(query) {
      reads.push(query);
      const ids = [...query.matchAll(/id = "([^"]+)"/g)].map((m) => m[1]);
      return ids.filter((id) => rows[id]).map((id) => ({ ...rows[id] }));
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    emit(name, data) {
      handlers.get(name)?.(data);
    },
    listening: () => handlers.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(rows) {
  const traffic = fakeTraffic(rows);
  const pairRows = createPairRows({ read: traffic.read, on: traffic.on, settleMs: 0 });
  return { traffic, pairRows };
}

test("tracked pairs are read in one query and kept by id", async () => {
  const { traffic, pairRows } = setup({ a: { ID: "a", Highlight: null }, b: { ID: "b", Highlight: 2 } });
  const stop = pairRows.track(["a", "b"]);
  await settle();
  assert.equal(traffic.reads.length, 1);
  assert.equal(get(pairRows).a.ID, "a");
  assert.equal(get(pairRows).b.Highlight, 2);
  stop();
});

test("a tracked pair the service no longer has reads as deleted (null)", async () => {
  const { pairRows } = setup({ a: { ID: "a" } });
  const stop = pairRows.track(["a", "gone"]);
  await settle();
  assert.equal(get(pairRows).gone, null);
  stop();
});

test("traffic changes, a tracked pair's response and its metadata read it again", async () => {
  const { traffic, pairRows } = setup({ a: { ID: "a", Highlight: null, StatusCode: 0 } });
  const stop = pairRows.track(["a"]);
  await settle();
  traffic.rows.a = { ID: "a", Highlight: 3, StatusCode: 0 };
  traffic.emit("traffic.changed", { action: "highlight" });
  await settle();
  assert.equal(get(pairRows).a.Highlight, 3);

  traffic.rows.a = { ...traffic.rows.a, StatusCode: 200 };
  traffic.emit("traffic.response", { id: "a" });
  await settle();
  assert.equal(get(pairRows).a.StatusCode, 200);

  const reads = traffic.reads.length;
  traffic.emit("traffic.response", { id: "other" });
  traffic.emit("metadata.updated", { id: "other" });
  await settle();
  assert.equal(traffic.reads.length, reads, "events for untracked pairs read nothing");

  traffic.rows.a = { ...traffic.rows.a, Metadata: { has_note: 1 } };
  traffic.emit("metadata.updated", { id: "a" });
  await settle();
  assert.equal(get(pairRows).a.Metadata.has_note, 1);
  delete traffic.rows.a;
  traffic.emit("traffic.changed", { action: "delete" });
  await settle();
  assert.equal(get(pairRows).a, null);
  stop();
});

test("the last tracker to stop stops listening", async () => {
  const { traffic, pairRows } = setup({ a: { ID: "a" } });
  const one = pairRows.track(["a"]);
  const two = pairRows.track(["a"]);
  one();
  assert.ok(traffic.listening() > 0);
  two();
  assert.equal(traffic.listening(), 0);
});

test("a failed read keeps the rows it had", async () => {
  const traffic = fakeTraffic({ a: { ID: "a" } });
  let fail = false;
  const pairRows = createPairRows({
    read: (q) => (fail ? Promise.reject(new Error("down")) : traffic.read(q)),
    on: traffic.on,
    settleMs: 0,
  });
  const stop = pairRows.track(["a"]);
  await settle();
  fail = true;
  traffic.emit("traffic.changed", {});
  await settle();
  assert.equal(get(pairRows).a.ID, "a");
  stop();
});
