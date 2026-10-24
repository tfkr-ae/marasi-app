import { test } from "node:test";
import assert from "node:assert/strict";
import { trafficPage } from "./traffic.js";

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
