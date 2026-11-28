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
  listenerStopped: false,
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

test("In Checkpoint counts the intercepted requests, says whether Intercept all is on, and opens Checkpoint", () => {
  const quiet = figure(project, "held");
  assert.equal(quiet.label, "In Checkpoint");
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
    ["Pairs", "Intercepted", "With a note", "Launchpads", "In Checkpoint", "Armory runs", "Test cases done", "Scope"],
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

test("each status class counts its responses and opens the Ledger filtered to its range", () => {
  const classes = overviewOf({ ...project, statusClasses: { "2xx": 40, "3xx": 5, "4xx": 3, "5xx": 1 } }).statusClasses;
  assert.deepEqual(classes, {
    "2xx": { count: 40, colour: "success", destination: { page: "ledger", query: "status_code >= 200 status_code < 300" } },
    "3xx": { count: 5, colour: "tertiary", destination: { page: "ledger", query: "status_code >= 300 status_code < 400" } },
    "4xx": { count: 3, colour: "warning", destination: { page: "ledger", query: "status_code >= 400 status_code < 500" } },
    "5xx": { count: 1, colour: "error", destination: { page: "ledger", query: "status_code >= 500 status_code < 600" } },
  });
});

test("until the status classes are first read, they have no count", () => {
  const classes = overviewOf({ ...project, statusClasses: null }).statusClasses;
  assert.deepEqual(Object.keys(classes), ["2xx", "3xx", "4xx", "5xx"]);
  assert.ok(Object.values(classes).every((c) => c.count === null));
});

const someFindings = [
  { severity: "Critical", done: false },
  { severity: "High", done: true },
  { severity: "High", done: false },
  { severity: "Medium", done: true },
  { severity: "Medium", done: true },
  { severity: "Medium", done: false },
  { severity: "Informational", done: true },
];

test("Findings counts every finding and the unfinished ones, and opens the Logbook's findings", () => {
  const findings = overviewOf({ ...project, findings: someFindings }).findings;
  assert.equal(findings.total, 7);
  assert.equal(findings.unfinished, 3);
  assert.deepEqual(findings.destination, { page: "logbook", kind: "findings" });
});

test("Findings counts each severity, in order, and each opens the Logbook filtered to it", () => {
  const { bySeverity } = overviewOf({ ...project, findings: someFindings }).findings;
  assert.deepEqual(bySeverity, [
    { severity: "Critical", count: 1, destination: { page: "logbook", kind: "findings", severities: ["Critical"] } },
    { severity: "High", count: 2, destination: { page: "logbook", kind: "findings", severities: ["High"] } },
    { severity: "Medium", count: 3, destination: { page: "logbook", kind: "findings", severities: ["Medium"] } },
    { severity: "Low", count: 0, destination: { page: "logbook", kind: "findings", severities: ["Low"] } },
    {
      severity: "Informational",
      count: 1,
      destination: { page: "logbook", kind: "findings", severities: ["Informational"] },
    },
  ]);
});

test("a project without findings counts none in every severity", () => {
  const findings = overviewOf(project).findings;
  assert.equal(findings.total, 0);
  assert.equal(findings.unfinished, 0);
  assert.ok(findings.bySeverity.every((s) => s.count === 0));
});

const pendingIds = (state) => overviewOf(state).pending.map((item) => item.id);
const pendingItem = (state, id) => overviewOf(state).pending.find((item) => item.id === id);

test("a fresh, running project has nothing pending", () => {
  assert.deepEqual(overviewOf(project).pending, []);
});

test("a listener the researcher stopped is pending, and its item starts the listener", () => {
  const item = pendingItem({ ...project, listenerStopped: true }, "listener");
  assert.equal(item.title, "Listener is off");
  assert.deepEqual(item.destination, { action: "start-listener" });
});

test("requests intercepted in Checkpoint are pending with their count, and open Checkpoint", () => {
  const item = pendingItem({ ...project, held: 3 }, "held");
  assert.equal(item.title, "3 intercepted in Checkpoint");
  assert.deepEqual(item.destination, { page: "checkpoint" });
});

test("Intercept all on is pending, and opens Checkpoint", () => {
  const item = pendingItem({ ...project, interceptAll: true }, "intercept-all");
  assert.equal(item.title, "Intercept all is on");
  assert.deepEqual(item.destination, { page: "checkpoint" });
});

test("only unfinished Critical and High findings are urgent, and they open the Logbook to exactly those", () => {
  const findings = [
    { severity: "Critical", done: false },
    { severity: "High", done: false },
    { severity: "High", done: true },
    { severity: "Medium", done: false },
    { severity: "Low", done: false },
  ];
  const item = pendingItem({ ...project, findings }, "urgent");
  assert.equal(item.title, "2 Critical/High findings unfinished");
  assert.deepEqual(item.destination, {
    page: "logbook",
    kind: "findings",
    severities: ["Critical", "High"],
    status: "progress",
  });
});

test("one unfinished High finding reads in the singular", () => {
  const item = pendingItem({ ...project, findings: [{ severity: "High", done: false }] }, "urgent");
  assert.equal(item.title, "1 Critical/High finding unfinished");
});

test("finished or lesser findings aren't pending", () => {
  const findings = [
    { severity: "Critical", done: true },
    { severity: "Medium", done: false },
  ];
  assert.deepEqual(pendingIds({ ...project, findings }), []);
});

test("everything pending lists in order: listener, held, Intercept all, urgent", () => {
  const busy = {
    ...project,
    listenerStopped: true,
    held: 1,
    interceptAll: true,
    findings: [{ severity: "Critical", done: false }],
  };
  assert.deepEqual(pendingIds(busy), ["listener", "held", "intercept-all", "urgent"]);
});

test("Armory runs in progress aren't pending", () => {
  assert.deepEqual(pendingIds({ ...project, activeRuns: 2 }), []);
});

test("Checkpoint's copy says intercepted, never hold or held", () => {
  const busy = overviewOf({
    ...project,
    listenerStopped: true,
    held: 2,
    interceptAll: true,
    findings: [{ severity: "Critical", done: false }],
  });
  const copy = [
    ...busy.figures.flatMap((f) => [f.label, f.sub ?? ""]),
    ...busy.pending.flatMap((item) => [item.title, item.detail, item.action]),
  ];
  assert.deepEqual(copy.filter((text) => /\bhol(d|ds|ding)\b|\bheld\b/i.test(text)), []);
});
