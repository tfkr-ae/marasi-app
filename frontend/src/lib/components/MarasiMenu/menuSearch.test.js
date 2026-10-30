import test from "node:test";
import assert from "node:assert/strict";
import { matchesMenuSearch } from "./menuSearch.js";

const selectAll = {
  name: "Select All Traffic",
  subtitle: "Select every request in the selected run's traffic",
  keywords: "select, all, traffic, requests",
};
const openFirst = {
  name: "Open First Request",
  subtitle: "Open the first request in the selected run",
  keywords: "open request drawer",
};

test("an action's whole name finds it", () => {
  assert.equal(matchesMenuSearch(selectAll, "select all traffic"), true);
  assert.equal(matchesMenuSearch(openFirst, "Open First Request"), true);
});

test("the typed words may come in any order and match the name, description or keywords", () => {
  assert.equal(matchesMenuSearch(selectAll, "traffic all"), true);
  assert.equal(matchesMenuSearch(openFirst, "first drawer"), true);
  assert.equal(matchesMenuSearch(selectAll, "every request"), true);
});

test("every typed word must match", () => {
  assert.equal(matchesMenuSearch(selectAll, "select all launchpads"), false);
  assert.equal(matchesMenuSearch(openFirst, "open first finding"), false);
});

test("nothing typed matches everything", () => {
  assert.equal(matchesMenuSearch(selectAll, ""), true);
  assert.equal(matchesMenuSearch(selectAll, "   "), true);
});

test("an option without keywords or a subtitle still matches its name", () => {
  assert.equal(matchesMenuSearch({ name: "Toggle Theme" }, "theme"), true);
});
