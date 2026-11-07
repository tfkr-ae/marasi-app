import { test } from "node:test";
import assert from "node:assert/strict";
import { armoryBadge } from "./armoryBadge.js";

test("with no run in progress there is no badge", () => {
  assert.deepEqual(armoryBadge(0), { label: null, title: "Armory" });
});

test("the badge counts the runs in progress", () => {
  assert.deepEqual(armoryBadge(2), { label: "2", title: "Armory · 2 running" });
});

test("past 99 the badge reads 99+ and the title keeps the count", () => {
  assert.deepEqual(armoryBadge(120), { label: "99+", title: "Armory · 120 running" });
});
