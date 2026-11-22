import { test } from "node:test";
import assert from "node:assert/strict";
import { sortMessages, toggleSort } from "./messageSort.js";

const m = (ID, Direction) => ({ ID, Direction });
const dir = (message) => message.Direction;

test("by id ascending, a list already in that order is shown as it is", () => {
  const list = [m("a", "out"), m("b", "in"), m("c", "out")];
  assert.equal(sortMessages(list, { id: "ID", desc: false }, dir), list);
});

test("the # and Dir columns sort by id and by direction, either way; no sort keeps the kind's order", () => {
  const list = [m("b", "out"), m("c", "in"), m("a", "out")];
  const ids = (rows) => rows.map((r) => r.ID).join("");
  assert.equal(ids(sortMessages(list, { id: "ID", desc: false }, dir)), "abc");
  assert.equal(ids(sortMessages(list, { id: "ID", desc: true }, dir)), "cba");
  // Ties keep the list's order.
  assert.equal(ids(sortMessages(list, { id: "Direction", desc: false }, dir)), "cba");
  assert.equal(ids(sortMessages(list, { id: "Direction", desc: true }, dir)), "bac");
  assert.equal(ids(sortMessages(list, null, dir)), "bca");
});

test("a header click sorts ascending, then descending, then not at all", () => {
  let sorting = { id: "ID", desc: false };
  sorting = toggleSort(sorting, "ID");
  assert.deepEqual(sorting, { id: "ID", desc: true });
  sorting = toggleSort(sorting, "ID");
  assert.equal(sorting, null);
  sorting = toggleSort(sorting, "ID");
  assert.deepEqual(sorting, { id: "ID", desc: false });
  assert.deepEqual(toggleSort(sorting, "Direction"), { id: "Direction", desc: false });
});
