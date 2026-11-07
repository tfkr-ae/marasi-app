import test from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createMatchCounts } from "./createMatchCounts.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A count function whose answer for each query waits for `release(query)`.
function gatedCount(answers) {
  const releases = {};
  const gates = {};
  const calls = [];
  for (const query of Object.keys(answers)) {
    gates[query] = new Promise((resolve) => (releases[query] = resolve));
  }
  async function count(query) {
    calls.push(query);
    await gates[query];
    const answer = answers[query];
    if (answer instanceof Error) throw answer;
    return answer;
  }
  return { count, calls, release: (query) => releases[query](), releaseAll: () => Object.values(releases).forEach((r) => r()) };
}

test("load fills in each query's count as it returns", async () => {
  const gated = gatedCount({ a: { count: 1, capped: false }, b: { count: 2, capped: true } });
  const counts = createMatchCounts({ queries: () => ["a", "b"], count: gated.count });

  const loading = counts.load();
  assert.deepEqual(get(counts), {}, "nothing is known before a count returns");
  gated.release("b");
  await settle();
  assert.deepEqual(get(counts), { b: { count: 2, capped: true } }, "b shows before a returns");
  gated.release("a");
  await loading;
  assert.deepEqual(get(counts), { a: { count: 1, capped: false }, b: { count: 2, capped: true } });
});

test("counts run four at a time", async () => {
  const names = ["a", "b", "c", "d", "e", "f"];
  const gated = gatedCount(Object.fromEntries(names.map((q, i) => [q, { count: i, capped: false }])));
  const counts = createMatchCounts({ queries: () => names, count: gated.count });

  const loading = counts.load();
  await settle();
  assert.deepEqual(gated.calls, ["a", "b", "c", "d"], "four counts start at once");
  gated.release("b");
  await settle();
  assert.deepEqual(gated.calls, ["a", "b", "c", "d", "e"], "the next starts as one returns");
  gated.releaseAll();
  await loading;
  assert.equal(gated.calls.length, 6);
  assert.deepEqual(get(counts).f, { count: 5, capped: false });
});

test("a recount keeps the last counts, marked stale, until each new one arrives", async () => {
  let list = ["a", "gone"];
  let answer = async () => ({ count: 3, capped: false });
  const counts = createMatchCounts({ queries: () => list, count: (q) => answer(q) });
  await counts.load();

  list = ["a"];
  const gated = gatedCount({ a: { count: 5, capped: false } });
  answer = gated.count;
  const recounting = counts.load();
  assert.deepEqual(get(counts), { a: { count: 3, capped: false, stale: true } }, "never blank, and a dropped query goes");
  gated.release("a");
  await recounting;
  assert.deepEqual(get(counts), { a: { count: 5, capped: false } });
});

test("a count that fails shows as not counted and the others still load", async () => {
  const counts = createMatchCounts({
    queries: () => ["bad", "good"],
    count: async (q) => {
      if (q === "bad") throw new Error("offline");
      return { count: 1, capped: false };
    },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    await counts.load();
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(get(counts), { bad: null, good: { count: 1, capped: false } });
});

test("a newer load stops the older one", async () => {
  const gated = gatedCount({ a: { count: 1, capped: false } });
  let answer = gated.count;
  const counts = createMatchCounts({ queries: () => ["a"], count: (q) => answer(q) });

  const first = counts.load();
  await settle();
  answer = async () => ({ count: 9, capped: false });
  await counts.load();
  gated.release("a");
  await first;
  assert.deepEqual(get(counts), { a: { count: 9, capped: false } }, "the older answer is dropped");
});

test("clear, on a project switch, leaves every count unknown and drops the run in flight", async () => {
  let answer = async () => ({ count: 3, capped: false });
  const counts = createMatchCounts({ queries: () => ["a"], count: (q) => answer(q) });
  await counts.load();

  const gated = gatedCount({ a: { count: 4, capped: false } });
  answer = gated.count;
  const running = counts.load();
  await settle();
  counts.clear();
  assert.deepEqual(get(counts), {});
  gated.release("a");
  await running;
  assert.deepEqual(get(counts), {}, "the last project's count never shows");
});

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => (timers[id] = null),
    pending: () => timers.filter(Boolean),
    fire() {
      const i = timers.findIndex(Boolean);
      const { fn } = timers[i];
      timers[i] = null;
      fn();
    },
  };
}

test("schedule counts once for a burst of calls, after the delay", async () => {
  const timers = fakeTimers();
  const calls = [];
  const counts = createMatchCounts({
    queries: () => ["a"],
    count: async (q) => (calls.push(q), { count: 1, capped: false }),
    timers,
    delay: 1500,
  });

  counts.schedule();
  counts.schedule();
  counts.schedule();
  assert.equal(calls.length, 0, "nothing counts before the delay");
  assert.equal(timers.pending().length, 1, "one count pending");
  assert.equal(timers.pending()[0].ms, 1500);
  timers.fire();
  await settle();
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(get(counts), { a: { count: 1, capped: false } });

  counts.schedule();
  assert.equal(timers.pending().length, 1, "a later burst schedules again");
});

test("clear cancels a scheduled count", () => {
  const timers = fakeTimers();
  const counts = createMatchCounts({ queries: () => ["a"], count: async () => null, timers });
  counts.schedule();
  counts.clear();
  assert.equal(timers.pending().length, 0);
});
