import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLabel, shareText, stepRequest } from "./traffic.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ ID: `p${i}` }));

test("stepping from the open pair moves to its neighbour in the run's traffic", () => {
  assert.equal(stepRequest(rows(5), "p2", 1), 3);
  assert.equal(stepRequest(rows(5), "p2", -1), 1);
});

test("stepping stops at the run's first and last pairs", () => {
  assert.equal(stepRequest(rows(5), "p4", 1), -1);
  assert.equal(stepRequest(rows(5), "p0", -1), -1);
});

test("stepping matches ids whether they are numbers or strings", () => {
  assert.equal(stepRequest([{ ID: 7 }, { ID: 8 }], "7", 1), 1);
});

test("stepping from a pair the run no longer lists goes nowhere", () => {
  assert.equal(stepRequest(rows(5), "gone", 1), -1);
});

test("a group header names its value: the status code, the exact length, or … with no response", () => {
  assert.equal(groupLabel("status", "403"), "403");
  assert.equal(groupLabel("length", "1245"), "1,245 B");
  assert.equal(groupLabel("length", "0"), "0 B");
  assert.equal(groupLabel("status", ""), "…");
  assert.equal(groupLabel("length", ""), "…");
});

test("a group's share always has one decimal, so the decimal points line up", () => {
  assert.equal(shareText(50), "50.0%");
  assert.equal(shareText(100 / 3), "33.3%");
  assert.equal(shareText(0.04), "0.0%");
});
