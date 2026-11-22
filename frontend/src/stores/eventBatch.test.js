import { test } from "node:test";
import assert from "node:assert/strict";
import { eventBatch } from "./eventBatch.js";

// A schedule the test runs by hand.
function manualSchedule() {
  const pending = [];
  const schedule = (run) => pending.push(run);
  const flush = () => pending.splice(0).forEach((run) => run());
  return { schedule, flush, pending };
}

test("events queued before the scheduled flush land in one call, in order", () => {
  const { schedule, flush, pending } = manualSchedule();
  const calls = [];
  const push = eventBatch((events) => calls.push(events), schedule);
  push("a");
  push("b");
  push("c");
  assert.equal(pending.length, 1);
  assert.deepEqual(calls, []);
  flush();
  assert.deepEqual(calls, [["a", "b", "c"]]);

  push("d");
  flush();
  assert.deepEqual(calls, [["a", "b", "c"], ["d"]]);
});
