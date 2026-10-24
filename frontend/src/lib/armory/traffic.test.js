import { test } from "node:test";
import assert from "node:assert/strict";
import { stepRequest, trafficPage } from "./traffic.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ ID: `p${i}` }));

test("a page is its slice of the run's pairs, with where it starts and how many pages there are", () => {
  const page = trafficPage(rows(25), { pageIndex: 1, pageSize: 10 });
  assert.deepEqual(
    page.rows.map((row) => row.ID),
    ["p10", "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18", "p19"],
  );
  assert.equal(page.start, 10);
  assert.equal(page.pageCount, 3);
});

test("the last page holds what is left", () => {
  const page = trafficPage(rows(25), { pageIndex: 2, pageSize: 10 });
  assert.deepEqual(page.rows.map((row) => row.ID), ["p20", "p21", "p22", "p23", "p24"]);
});

test("no pairs is one empty page", () => {
  assert.deepEqual(trafficPage([], { pageIndex: 0, pageSize: 10 }), { rows: [], start: 0, pageCount: 1 });
});

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
