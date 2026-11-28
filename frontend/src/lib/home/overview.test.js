import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewOf } from "./overview.js";

// A read project: 12 pairs, 3 intercepted, 2 with a note, 4 launchpads.
const project = {
  dashboard: { requests: 12, intercepted: 3, interceptedComplete: true, notes: 2, launchpads: 4 },
  scope: { defaultAllow: true, includeCount: 0, excludeCount: 0 },
  held: 0,
  interceptAll: false,
  activeRuns: 0,
  testCases: [],
  findings: [],
};
const figure = (state, id) => overviewOf(state).figures.find((f) => f.id === id);

test("Pairs counts every pair and opens the unfiltered Ledger", () => {
  const pairs = figure(project, "pairs");
  assert.equal(pairs.label, "Pairs");
  assert.equal(pairs.value, "12");
  assert.deepEqual(pairs.destination, { page: "ledger", query: "" });
});

test("Intercepted counts intercepted pairs and opens the Ledger filtered to them", () => {
  const intercepted = figure(project, "intercepted");
  assert.equal(intercepted.label, "Intercepted");
  assert.equal(intercepted.value, "3");
  assert.equal(intercepted.floor, false);
  assert.deepEqual(intercepted.destination, { page: "ledger", query: "metadata.intercepted = true" });
});

test("while older pairs are still being counted, Intercepted is a floor", () => {
  const counting = { ...project, dashboard: { ...project.dashboard, interceptedComplete: false } };
  const intercepted = figure(counting, "intercepted");
  assert.equal(intercepted.value, "3");
  assert.equal(intercepted.floor, true);
  assert.equal(intercepted.sub, "counting…");
});

test("With a note opens the Ledger filtered to pairs with a note", () => {
  const notes = figure(project, "notes");
  assert.equal(notes.label, "With a note");
  assert.equal(notes.value, "2");
  assert.deepEqual(notes.destination, { page: "ledger", query: "note:*" });
});

test("Launchpads counts the launchpads and opens the Launchpad", () => {
  const launchpads = figure(project, "launchpads");
  assert.equal(launchpads.label, "Launchpads");
  assert.equal(launchpads.value, "4");
  assert.deepEqual(launchpads.destination, { page: "launchpad" });
});

test("Held counts the held requests, says whether Intercept all is on, and opens Checkpoint", () => {
  const quiet = figure(project, "held");
  assert.equal(quiet.label, "Held");
  assert.equal(quiet.value, "0");
  assert.equal(quiet.sub, "Intercept all off");
  assert.deepEqual(quiet.destination, { page: "checkpoint" });

  const holding = figure({ ...project, held: 5, interceptAll: true }, "held");
  assert.equal(holding.value, "5");
  assert.equal(holding.sub, "Intercept all on");
});

test("Armory runs counts the runs in progress and opens the Armory", () => {
  const runs = figure({ ...project, activeRuns: 2 }, "armory");
  assert.equal(runs.label, "Armory runs");
  assert.equal(runs.value, "2");
  assert.equal(runs.sub, "in progress");
  assert.deepEqual(runs.destination, { page: "armory" });
});

test("Test cases done reads done / total and opens the Logbook's test cases", () => {
  const testCases = [{ done: true }, { done: false }, { done: true }];
  const cases = figure({ ...project, testCases }, "test-cases");
  assert.equal(cases.label, "Test cases done");
  assert.equal(cases.value, "2 / 3");
  assert.deepEqual(cases.destination, { page: "logbook", kind: "testCases" });
  assert.equal(figure(project, "test-cases").value, "0 / 0");
});

test("Scope shows the default with the include and exclude counts, and opens Compass", () => {
  const deny = { ...project, scope: { defaultAllow: false, includeCount: 3, excludeCount: 1 } };
  const scope = figure(deny, "scope");
  assert.equal(scope.label, "Scope");
  assert.equal(scope.value, "Deny");
  assert.equal(scope.sub, "3 include · 1 exclude");
  assert.deepEqual(scope.destination, { page: "compass" });
  assert.equal(figure(project, "scope").value, "Allow");
});

test("the eight tiles come in order", () => {
  assert.deepEqual(
    overviewOf(project).figures.map((f) => f.label),
    ["Pairs", "Intercepted", "With a note", "Launchpads", "Held", "Armory runs", "Test cases done", "Scope"],
  );
});

test("until the counts and the scope are first read, their tiles have no value", () => {
  const unread = { ...project, dashboard: null, scope: null };
  const values = Object.fromEntries(overviewOf(unread).figures.map((f) => [f.id, f.value]));
  assert.deepEqual(values, {
    pairs: null,
    intercepted: null,
    notes: null,
    launchpads: null,
    held: "0",
    armory: "0",
    "test-cases": "0 / 0",
    scope: null,
  });
});
