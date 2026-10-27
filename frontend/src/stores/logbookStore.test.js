import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  anyStatusOf,
  completenessOf,
  createLogbookStore,
  filteredOf,
  groupsOf,
  nextOf,
  openRecordOf,
} from "./createLogbookStore.js";

// A finding as ListFindings returns it, complete unless overridden.
const finding = (id, fields = {}) => ({
  ID: id,
  Title: `Finding ${id}`,
  Severity: "Medium",
  CVSSScore: 5,
  CVSSVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N",
  WriteUp: "What happened",
  TreatmentPlan: "Fix it",
  Requests: ["r1"],
  TestCaseID: null,
  Artifacts: [],
  ...fields,
});

// A test case as ListTestCases returns it, complete unless overridden.
const testCase = (id, fields = {}) => ({
  ID: id,
  Title: `Test case ${id}`,
  Description: "",
  Category: "",
  Tags: [],
  Note: "Checked",
  Requests: [],
  Artifacts: [],
  ...fields,
});

// The Logbook's bindings over in-memory findings and test cases.
function fakeApi({ findings = [], testCases = [] } = {}) {
  const calls = [];
  const api = {
    calls,
    findings,
    testCases,
    listFindings: async () => {
      calls.push(["listFindings"]);
      return api.findings.map((f) => ({ ...f }));
    },
    listTestCases: async () => {
      calls.push(["listTestCases"]);
      return api.testCases.map((t) => ({ ...t }));
    },
  };
  return api;
}

async function loaded(records) {
  const api = fakeApi(records);
  const store = createLogbookStore(api);
  await store.populate();
  return { api, store };
}

test("populate lists findings and test cases through the bindings", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")], testCases: [testCase("t1")] });
  const state = get(store);
  assert.deepEqual(state.findings.map((f) => f.ID), ["f1"]);
  assert.deepEqual(state.testCases.map((t) => t.ID), ["t1"]);
  assert.deepEqual(api.calls.map(([name]) => name).sort(), ["listFindings", "listTestCases"]);
});

test("populate reads a null list from Go as empty", async () => {
  const api = fakeApi();
  api.listFindings = async () => null;
  api.listTestCases = async () => null;
  const store = createLogbookStore(api);
  await store.populate();
  assert.deepEqual(get(store).findings, []);
  assert.deepEqual(get(store).testCases, []);
});

test("clear forgets the project's records, filters and open record", async () => {
  const { store } = await loaded({ findings: [finding("f1")], testCases: [testCase("t1")] });
  store.setGrouping("testCases", "tag");
  store.setSeverities(["Medium"]);
  store.open("finding", "f1");
  store.clear();
  const state = get(store);
  assert.deepEqual(filteredOf(state), { findings: [], testCases: [] });
  assert.equal(state.filters.kind, "all");
  assert.deepEqual(state.filters.severities, []);
  assert.equal(openRecordOf(state), null);
});

test("a list still on its way when the project closes is ignored", async () => {
  const api = fakeApi({ findings: [finding("old")] });
  let reply;
  api.listFindings = () => new Promise((resolve) => (reply = resolve));
  const store = createLogbookStore(api);
  const populating = store.populate();
  store.clear();
  reply([finding("old")]);
  await populating;
  assert.deepEqual(get(store).findings, []);
});

test("a finding with every required item is Done, whatever its test case", () => {
  const c = completenessOf("finding", finding("f1"));
  assert.equal(c.status, "done");
  assert.equal(c.notStarted, false);
  assert.deepEqual([c.done, c.total], [4, 4]);
  assert.deepEqual(
    c.items.map(({ key, required, done }) => [key, required, done]),
    [
      ["WriteUp", true, true],
      ["CVSSVector", true, true],
      ["TreatmentPlan", true, true],
      ["Requests", true, true],
      ["TestCaseID", false, false],
    ],
  );
});

test("a finding missing a required item is In progress", () => {
  for (const missing of [
    { CVSSVector: "" },
    { TreatmentPlan: "  " },
    { Requests: [] },
    { Requests: null },
  ]) {
    const c = completenessOf("finding", finding("f1", missing));
    assert.equal(c.status, "progress", JSON.stringify(missing));
    assert.equal(c.notStarted, false);
    assert.deepEqual([c.done, c.total], [3, 4]);
  }
});

test("a finding with no writeup is Not started within In progress", () => {
  const c = completenessOf("finding", finding("f1", { WriteUp: " " }));
  assert.equal(c.status, "progress");
  assert.equal(c.notStarted, true);
  assert.deepEqual([c.done, c.total], [3, 4]);
});

test("a test case is Done with a note, whatever its category and requests", () => {
  const c = completenessOf("testCase", testCase("t1"));
  assert.equal(c.status, "done");
  assert.deepEqual([c.done, c.total], [1, 1]);
  assert.deepEqual(
    c.items.map(({ key, required, done }) => [key, required, done]),
    [
      ["Note", true, true],
      ["Category", false, false],
      ["Requests", false, false],
    ],
  );
});

test("a test case with no note is Not started", () => {
  const c = completenessOf("testCase", testCase("t1", { Note: "", Category: "Auth", Requests: ["r1"] }));
  assert.equal(c.status, "progress");
  assert.equal(c.notStarted, true);
  assert.deepEqual([c.done, c.total], [0, 1]);
});

// The ids the Logbook lists, findings then test cases.
const listed = (store) => {
  const { findings, testCases } = filteredOf(get(store));
  return [...findings.map((f) => f.ID), ...testCases.map((t) => t.ID)];
};

test("findings list by severity, then CVSS score; test cases by title", async () => {
  const { store } = await loaded({
    findings: [
      finding("low", { Severity: "Low", CVSSScore: 3.1 }),
      finding("high-7", { Severity: "High", CVSSScore: 7.1 }),
      finding("crit", { Severity: "Critical", CVSSScore: 9.8 }),
      finding("high-8", { Severity: "High", CVSSScore: 8.2 }),
      finding("info", { Severity: "Informational", CVSSScore: 0 }),
    ],
    testCases: [testCase("t-b", { Title: "Beta" }), testCase("t-a", { Title: "alpha" })],
  });
  assert.deepEqual(listed(store), ["crit", "high-8", "high-7", "low", "info", "t-a", "t-b"]);
});

test("search matches a finding's title, severity, writeup and treatment plan", async () => {
  const { store } = await loaded({
    findings: [
      finding("title", { Title: "Stored XSS" }),
      finding("severity", { Severity: "Critical" }),
      finding("writeup", { WriteUp: "an xss in search" }),
      finding("plan", { TreatmentPlan: "Encode for XSS contexts" }),
      finding("other"),
    ],
  });
  store.setQuery("  xss ");
  assert.deepEqual(listed(store).sort(), ["plan", "title", "writeup"]);
  store.setQuery("CRITICAL");
  assert.deepEqual(listed(store), ["severity"]);
});

test("search matches a test case's title, description, category, tags and note", async () => {
  const { store } = await loaded({
    testCases: [
      testCase("title", { Title: "Session expiry" }),
      testCase("description", { Description: "Check the session cookie" }),
      testCase("category", { Category: "Session management" }),
      testCase("tag", { Tags: ["auth", "session"] }),
      testCase("note", { Note: "Session survives logout" }),
      testCase("other", { Tags: null }),
    ],
  });
  store.setQuery("session");
  assert.deepEqual(listed(store).sort(), ["category", "description", "note", "tag", "title"]);
});

test("the status filter lists Done or In progress records; the any-status list keeps both", async () => {
  const { store } = await loaded({
    findings: [finding("f-done"), finding("f-open", { TreatmentPlan: "" })],
    testCases: [testCase("t-done"), testCase("t-open", { Note: "" })],
  });
  store.setStatus("progress");
  assert.deepEqual(listed(store), ["f-open", "t-open"]);
  store.setStatus("done");
  assert.deepEqual(listed(store), ["f-done", "t-done"]);
  const any = anyStatusOf(get(store));
  assert.deepEqual(
    [...any.findings, ...any.testCases].map((r) => r.ID),
    ["f-done", "f-open", "t-done", "t-open"],
  );
  store.setStatus("all");
  assert.deepEqual(listed(store), ["f-done", "f-open", "t-done", "t-open"]);
});

test("the any-status list follows the other filters", async () => {
  const { store } = await loaded({
    findings: [finding("xss", { Title: "XSS" }), finding("sqli", { Title: "SQLi", WriteUp: "" })],
  });
  store.setStatus("done");
  store.setQuery("sqli");
  assert.deepEqual(listed(store), []);
  assert.deepEqual(anyStatusOf(get(store)).findings.map((f) => f.ID), ["sqli"]);
});

// What the toolbar shows: the kind, whether it was picked by hand, and the
// severity, category and tag filters.
const toolbar = (store) => {
  const { kind, manualKind, severities, categories, tags } = get(store).filters;
  return { kind, manualKind, severities, categories, tags };
};

const mixed = {
  findings: [
    finding("f-high", { Severity: "High", CVSSScore: 8 }),
    finding("f-low", { Severity: "Low", CVSSScore: 2 }),
  ],
  testCases: [
    testCase("t-auth", { Title: "A", Category: "Auth", Tags: ["login"] }),
    testCase("t-none", { Title: "B", Category: "", Tags: [] }),
  ],
};

test("picking a severity narrows to findings and clears category and tag filters", async () => {
  const { store } = await loaded(mixed);
  store.setCategories(["Auth"]);
  store.setTags(["login"]);
  store.setSeverities(["High"]);
  assert.deepEqual(toolbar(store), {
    kind: "findings",
    manualKind: false,
    severities: ["High"],
    categories: [],
    tags: [],
  });
  assert.deepEqual(listed(store), ["f-high"]);
});

test("picking a category or tag narrows to test cases and clears the severity filter", async () => {
  const { store } = await loaded(mixed);
  store.setSeverities(["High"]);
  store.setCategories(["Uncategorized"]);
  assert.deepEqual(toolbar(store), {
    kind: "testCases",
    manualKind: false,
    severities: [],
    categories: ["Uncategorized"],
    tags: [],
  });
  assert.deepEqual(listed(store), ["t-none"]);

  store.setCategories([]);
  store.setSeverities(["Low"]);
  store.setTags(["login"]);
  assert.deepEqual(toolbar(store).severities, []);
  assert.equal(toolbar(store).kind, "testCases");
  assert.deepEqual(listed(store), ["t-auth"]);
});

test("clearing those filters brings back both kinds", async () => {
  const { store } = await loaded(mixed);
  store.setSeverities(["High"]);
  store.setSeverities([]);
  assert.equal(toolbar(store).kind, "all");
  store.setTags(["login"]);
  store.setCategories(["Auth"]);
  store.setTags([]);
  assert.equal(toolbar(store).kind, "testCases", "a category still applies");
  store.setCategories([]);
  assert.equal(toolbar(store).kind, "all");
  assert.deepEqual(listed(store), ["f-high", "f-low", "t-auth", "t-none"]);
});

test("clearing those filters keeps a kind chosen by hand", async () => {
  const { store } = await loaded(mixed);
  store.setKind("findings");
  store.setSeverities(["Low"]);
  store.setSeverities([]);
  assert.deepEqual(toolbar(store), {
    kind: "findings",
    manualKind: true,
    severities: [],
    categories: [],
    tags: [],
  });
  assert.deepEqual(listed(store), ["f-high", "f-low"]);
});

test("choosing a kind drops the filters that don't apply to it", async () => {
  const { store } = await loaded(mixed);
  store.setSeverities(["High"]);
  store.setKind("testCases");
  assert.deepEqual(toolbar(store), {
    kind: "testCases",
    manualKind: true,
    severities: [],
    categories: [],
    tags: [],
  });
  store.setTags(["login"]);
  store.setKind("findings");
  assert.deepEqual(toolbar(store).tags, []);
  store.setKind("all");
  assert.equal(toolbar(store).manualKind, false);
  assert.deepEqual(listed(store), ["f-high", "f-low", "t-auth", "t-none"]);
});

test("clearing every filter brings back the whole Logbook", async () => {
  const { store } = await loaded(mixed);
  store.setKind("findings");
  store.setSeverities(["High"]);
  store.setQuery("finding");
  store.setStatus("progress");
  store.clearFilters();
  assert.deepEqual(toolbar(store), {
    kind: "all",
    manualKind: false,
    severities: [],
    categories: [],
    tags: [],
  });
  assert.equal(get(store).filters.q, "");
  assert.equal(get(store).filters.status, "all");
  assert.deepEqual(listed(store), ["f-high", "f-low", "t-auth", "t-none"]);
});

// Each group as [title, ids].
const grouped = (groups) => groups.map((group) => [group.title, group.items.map((r) => r.ID)]);

test("findings group by severity, most severe first, or not at all", async () => {
  const { store } = await loaded({
    findings: [
      finding("low", { Severity: "Low", CVSSScore: 2 }),
      finding("crit", { Severity: "Critical", CVSSScore: 9.1 }),
      finding("low-3", { Severity: "Low", CVSSScore: 3.5 }),
    ],
  });
  assert.deepEqual(grouped(groupsOf(get(store)).findings), [
    ["Critical", ["crit"]],
    ["Low", ["low-3", "low"]],
  ]);
  store.setGrouping("findings", "none");
  assert.deepEqual(grouped(groupsOf(get(store)).findings), [[null, ["crit", "low-3", "low"]]]);
});

test("test cases group by category, by tag, or not at all", async () => {
  const { store } = await loaded({
    testCases: [
      testCase("login", { Title: "Login", Category: "Auth", Tags: ["web", "api"] }),
      testCase("csp", { Title: "CSP", Category: "", Tags: ["web"] }),
      testCase("idor", { Title: "IDOR", Category: "Access", Tags: null }),
    ],
  });
  assert.deepEqual(grouped(groupsOf(get(store)).testCases), [
    ["Access", ["idor"]],
    ["Auth", ["login"]],
    ["Uncategorized", ["csp"]],
  ]);
  store.setGrouping("testCases", "tag");
  assert.deepEqual(grouped(groupsOf(get(store)).testCases), [
    ["api", ["login"]],
    ["web", ["csp", "login"]],
    ["No tags", ["idor"]],
  ]);
  store.setGrouping("testCases", "none");
  assert.deepEqual(grouped(groupsOf(get(store)).testCases), [[null, ["csp", "idor", "login"]]]);
});

test("groups hold only the records the filters list", async () => {
  const { store } = await loaded(mixed);
  store.setSeverities(["Low"]);
  assert.deepEqual(groupsOf(get(store)), { findings: [{ key: "Low", title: "Low", items: [get(store).findings[1]] }], testCases: [] });
});

// The open record as [kind, id], or null.
const opened = (store) => {
  const open = openRecordOf(get(store));
  return open && [open.kind, open.record.ID];
};
const next = (store) => {
  const target = nextOf(get(store));
  return target && [target.kind, target.record.ID];
};

test("opening a record shows it; closing goes back to the list", async () => {
  const { store } = await loaded(mixed);
  assert.equal(opened(store), null);
  store.open("testCase", "t-auth");
  assert.deepEqual(opened(store), ["testCase", "t-auth"]);
  store.close();
  assert.equal(opened(store), null);
});

test("an open record that leaves the Logbook is no longer open", async () => {
  const { api, store } = await loaded(mixed);
  store.open("finding", "f-low");
  api.findings = api.findings.filter((f) => f.ID !== "f-low");
  await store.populate();
  assert.equal(opened(store), null);
});

test("any filter change closes the open record", async () => {
  const { store } = await loaded(mixed);
  const changes = [
    () => store.setQuery("a"),
    () => store.setStatus("done"),
    () => store.setKind("findings"),
    () => store.setSeverities(["High"]),
    () => store.setCategories(["Auth"]),
    () => store.setTags(["login"]),
    () => store.clearFilters(),
  ];
  for (const change of changes) {
    store.open("finding", "f-high");
    change();
    assert.equal(opened(store), null, change.toString());
  }
});

test("changing the grouping keeps the open record", async () => {
  const { store } = await loaded(mixed);
  store.open("finding", "f-high");
  store.setGrouping("findings", "none");
  assert.deepEqual(opened(store), ["finding", "f-high"]);
});

test("Next goes through the listed findings, then the test cases, skipping Done ones", async () => {
  const { store } = await loaded({
    findings: [
      finding("f1", { Severity: "High", WriteUp: "" }),
      finding("f2", { Severity: "Medium" }),
      finding("f3", { Severity: "Low", Requests: [] }),
    ],
    testCases: [testCase("t1", { Title: "A" }), testCase("t2", { Title: "B", Note: "" })],
  });
  store.open("finding", "f1");
  assert.deepEqual(next(store), ["finding", "f3"]);
  store.open("finding", "f3");
  assert.deepEqual(next(store), ["testCase", "t2"]);
});

test("Next wraps to the start of the list", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { Severity: "High", WriteUp: "" }), finding("f2", { Severity: "Low", WriteUp: "" })],
    testCases: [testCase("t1", { Note: "" })],
  });
  store.open("testCase", "t1");
  assert.deepEqual(next(store), ["finding", "f1"]);
});

test("with a status filter, Next goes through that list, Done records too", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { Severity: "High" }), finding("f2", { Severity: "Low" })],
  });
  store.setStatus("done");
  store.open("finding", "f1");
  assert.deepEqual(next(store), ["finding", "f2"]);
});

test("Next returns nothing when no other record is left to review", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { WriteUp: "" }), finding("f2")],
  });
  assert.equal(next(store), null, "nothing open");
  store.open("finding", "f1");
  assert.equal(next(store), null, "only Done records after it");
  store.setStatus("progress");
  store.open("finding", "f1");
  assert.equal(next(store), null, "alone in its list");
});

test("Next from a record the list doesn't show starts at the top", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { Severity: "High" }), finding("f2", { Severity: "Low", WriteUp: "" })],
  });
  store.setStatus("progress");
  store.open("finding", "f1");
  assert.deepEqual(next(store), ["finding", "f2"]);
});

test("openNext opens the next record, or keeps the open one when none is next", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { Severity: "High", WriteUp: "" }), finding("f2", { Severity: "Low", WriteUp: "" })],
  });
  store.open("finding", "f1");
  assert.deepEqual(
    [store.openNext()].map((t) => [t.kind, t.record.ID]),
    [["finding", "f2"]],
  );
  assert.deepEqual(opened(store), ["finding", "f2"]);
  store.setQuery("Finding f2");
  store.open("finding", "f2");
  assert.equal(store.openNext(), null);
  assert.deepEqual(opened(store), ["finding", "f2"]);
});
