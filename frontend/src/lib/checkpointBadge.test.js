import { test } from "node:test";
import assert from "node:assert/strict";
import { checkpointBadge } from "./checkpointBadge.js";

test("with no intercepted items there is no badge", () => {
  assert.deepEqual(checkpointBadge(0), { label: null, title: "Checkpoint" });
});

test("the badge counts the intercepted items", () => {
  assert.deepEqual(checkpointBadge(1), { label: "1", title: "Checkpoint · 1 intercepted" });
  assert.deepEqual(checkpointBadge(12), { label: "12", title: "Checkpoint · 12 intercepted" });
});

test("past 99 the badge reads 99+ and the title keeps the count", () => {
  assert.deepEqual(checkpointBadge(99), { label: "99", title: "Checkpoint · 99 intercepted" });
  assert.deepEqual(checkpointBadge(250), { label: "99+", title: "Checkpoint · 250 intercepted" });
});
