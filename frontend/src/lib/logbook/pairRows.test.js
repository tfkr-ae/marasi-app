import test from "node:test";
import assert from "node:assert/strict";
import { createPairRows, rowAsPair } from "./pairRows.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const trafficRow = (id, n) => ({ ID: id, Number: n, Method: "GET", Host: "a.test", Path: `/${n}`, StatusCode: 200 });

test("saved links come from one listing, never a read each", async () => {
  let listings = 0;
  const reads = [];
  const row = createPairRows({
    listLinked: async () => (listings++, [trafficRow("a", 1), trafficRow("b", 2)]),
    readPair: async (id) => (reads.push(id), null),
  });
  assert.deepEqual(await Promise.all([row("a"), row("b"), row("a")]), [
    rowAsPair(trafficRow("a", 1)),
    rowAsPair(trafficRow("b", 2)),
    rowAsPair(trafficRow("a", 1)),
  ]);
  assert.equal(listings, 1);
  assert.deepEqual(reads, []);
});

test("a pair the listing doesn't hold is read on its own, a few at a time", async () => {
  const releases = [];
  const reads = [];
  const row = createPairRows({
    listLinked: async () => [],
    readPair: (id) => new Promise((resolve) => (reads.push(id), releases.push(() => resolve({ Request: { Number: id } })))),
    concurrency: 2,
  });
  const all = Promise.all(["x", "y", "z"].map(row));
  await settle();
  assert.deepEqual(reads, ["x", "y"], "two at once");
  releases[0]();
  await settle();
  assert.deepEqual(reads, ["x", "y", "z"], "the next starts as one finishes");
  releases[1]();
  releases[2]();
  assert.deepEqual((await all).map((p) => p.Request.Number), ["x", "y", "z"]);
});

test("a failed listing falls back to reading each pair, and a failed read is null", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const row = createPairRows({
      listLinked: async () => {
        throw new Error("offline");
      },
      readPair: async (id) => {
        if (id === "gone") throw new Error("not found");
        return { Request: { Number: 7 } };
      },
    });
    assert.deepEqual(await row("p"), { Request: { Number: 7 } });
    assert.equal(await row("gone"), null);
  } finally {
    console.error = quiet;
  }
});
