import { test } from "node:test";
import assert from "node:assert/strict";
import { latestRequest } from "./latestRequest.js";

test("only the latest of overlapping requests is still current", () => {
  const requests = latestRequest();
  const a = requests.start();
  assert.equal(a(), true);
  const b = requests.start();
  assert.equal(a(), false);
  assert.equal(b(), true);
});

test("a request that finishes after a newer one started stays stale", async () => {
  const requests = latestRequest();
  const opened = [];
  async function open(name, load) {
    const current = requests.start();
    await load;
    if (current()) opened.push(name);
  }
  let finishA;
  const slow = open("A", new Promise((resolve) => (finishA = resolve)));
  await open("B", Promise.resolve());
  finishA();
  await slow;
  assert.deepEqual(opened, ["B"]);
});

test("separate request lines don't supersede each other", () => {
  const one = latestRequest();
  const two = latestRequest();
  const a = one.start();
  two.start();
  assert.equal(a(), true);
});
