// Home's dashboard counts: what GET /dashboard reads, read again once
// Marasi's intercepted_count job finishes counting older pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createDashboardStore } from "./createDashboardStore.js";

const counts = (Interceptions, InterceptionsComplete = true) => ({
  Requests: 120,
  Notes: 4,
  Launchpads: 2,
  Interceptions,
  InterceptionsComplete,
});

// A fake CountNotes whose answers come from `answers` in turn (the last repeats).
function fakeApi(...answers) {
  let n = 0;
  const api = {
    reads: 0,
    countNotes: async () => {
      api.reads++;
      return answers[Math.min(n++, answers.length - 1)];
    },
  };
  return api;
}

test("reload shows the project's counts", async () => {
  const store = createDashboardStore(fakeApi(counts(7)));
  assert.equal(get(store).loading, true);
  await store.reload();
  assert.deepEqual(get(store), { loading: false, counts: counts(7) });
});

test("an intercepted count still counting is read again when its job completes", async () => {
  const api = fakeApi(counts(3, false), counts(9));
  const store = createDashboardStore(api);
  await store.reload();
  await store.onJobComplete({ name: "intercepted_count", project: "/p.marasi" });
  assert.equal(api.reads, 2);
  assert.deepEqual(get(store).counts, counts(9));
});

test("other jobs, or a count already complete, don't read again", async () => {
  const api = fakeApi(counts(3, false));
  const store = createDashboardStore(api);
  await store.reload();
  await store.onJobComplete({ name: "sitemap" });
  assert.equal(api.reads, 1);

  const done = fakeApi(counts(3));
  const complete = createDashboardStore(done);
  await complete.reload();
  await complete.onJobComplete({ name: "intercepted_count" });
  assert.equal(done.reads, 1);
});

test("a count job that completes while the counts are read is read again", async () => {
  const releases = [];
  const store = createDashboardStore({ countNotes: () => new Promise((resolve) => releases.push(resolve)) });
  const first = store.reload();
  const event = store.onJobComplete({ name: "intercepted_count" });
  releases[0](counts(3, false));
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases[1](counts(9));
  await event;
  assert.deepEqual(get(store).counts, counts(9));
});

test("a newer read wins over a slower older one", async () => {
  const releases = [];
  const store = createDashboardStore({ countNotes: () => new Promise((resolve) => releases.push(resolve)) });
  const older = store.reload();
  const newer = store.reload();
  releases[1](counts(2));
  releases[0](counts(1));
  await Promise.all([older, newer]);
  assert.equal(get(store).counts.Interceptions, 2);
});

test("a failed read stops loading and keeps the last counts", async () => {
  let fail = false;
  const store = createDashboardStore({
    countNotes: async () => {
      if (fail) throw new Error("db locked");
      return counts(5);
    },
  });
  await store.reload();
  fail = true;
  await assert.rejects(store.reload(), /db locked/);
  assert.deepEqual(get(store), { loading: false, counts: counts(5) });
});
