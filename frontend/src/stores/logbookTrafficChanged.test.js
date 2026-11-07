// The Logbook following another client's bulk link, unlink and delete:
// Marasi publishes only traffic.changed for those, naming the target of a
// link or unlink and the selection, so the store reads the records it
// touched again once a burst settles, and an open edit keeps its input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { completenessOf, createLogbookStore, openRecordOf } from "./createLogbookStore.js";
import { logbookEvents } from "./logbookEvents.js";

const F1 = "11111111-1111-1111-1111-111111111111";
const F2 = "66666666-6666-6666-6666-666666666666";
const T1 = "22222222-2222-2222-2222-222222222222";
const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";
const PAD = "77777777-7777-7777-7777-777777777777";

const finding = (fields = {}) => ({
  ID: F1,
  TestCaseID: null,
  Title: "SQL injection",
  Severity: "High",
  CVSSVector: "",
  CVSSScore: 0,
  WriteUp: "Before",
  TreatmentPlan: "",
  CreatedAt: "2026-11-07T10:00:00Z",
  Requests: [],
  Artifacts: [],
  ...fields,
});

const testCase = (fields = {}) => ({
  ID: T1,
  Title: "Login form",
  Description: "",
  Category: "Auth",
  Tags: [],
  Note: "",
  CreatedAt: "2026-11-07T10:00:00Z",
  Requests: [R1],
  Artifacts: [],
  ...fields,
});

// `server` holds the records as the service has them; tests change it the
// way another client's bulk route would, then emit its traffic.changed.
function setup({ findings = [], testCases = [] } = {}) {
  const server = { finding: new Map(findings.map((f) => [f.ID, f])), testCase: new Map(testCases.map((t) => [t.ID, t])) };
  const reads = [];
  const read = (kind) => async (id) => {
    reads.push([kind, id]);
    const record = server[kind].get(id);
    if (!record) throw new Error(`no ${kind} ${id}`);
    return structuredClone(record);
  };
  const api = {
    listFindings: async () => [...server.finding.values()].map((f) => structuredClone(f)),
    listTestCases: async () => [...server.testCase.values()].map((t) => structuredClone(t)),
    getFinding: read("finding"),
    getTestCase: read("testCase"),
  };
  let due = [];
  const timers = {
    setTimeout: (fn) => {
      const timer = { fn };
      due.push(timer);
      return timer;
    },
    clearTimeout: (timer) => (due = due.filter((t) => t !== timer)),
  };
  const store = createLogbookStore(api, timers);
  const events = logbookEvents(store);
  const emit = (data) => events["traffic.changed"](data);
  // Lets the settle delay pass, then the reads it starts answer.
  const settle = async () => {
    const run = due;
    due = [];
    run.forEach((t) => t.fn());
    await new Promise((resolve) => setImmediate(resolve));
  };
  const change = (kind, id, fields) => server[kind].set(id, { ...server[kind].get(id), ...fields });
  return { store, emit, settle, change, reads };
}

test("another client's bulk link to a finding shows on it once the burst settles", async () => {
  const { store, emit, settle, change, reads } = setup({ findings: [finding()] });
  await store.populate();
  store.open("finding", F1);

  change("finding", F1, { Requests: [R1, R2] });
  emit({ change: "link", count: 1, selection: { ids: [R1] }, target: { kind: "finding", id: F1 } });
  emit({ change: "link", count: 1, selection: { ids: [R2] }, target: { kind: "finding", id: F1 } });
  assert.deepEqual(reads, [], "nothing reads before the burst settles");
  await settle();

  assert.deepEqual(reads, [["finding", F1]], "the burst reads its record once");
  const open = openRecordOf(get(store));
  assert.deepEqual(open.record.Requests, [R1, R2]);
  assert.equal(completenessOf("finding", open.record).items.find((i) => i.key === "Requests")?.done, true);
});

test("another client's bulk unlink from a test case leaves its evidence", async () => {
  const { store, emit, settle, change, reads } = setup({ testCases: [testCase()] });
  await store.populate();

  change("testCase", T1, { Requests: [] });
  emit({ change: "unlink", count: 1, selection: { query: "", as_of: "2026-11-07T10:00:00Z" }, target: { kind: "test_case", id: T1 } });
  await settle();

  assert.deepEqual(reads, [["testCase", T1]]);
  assert.deepEqual(get(store).testCases[0].Requests, []);
});

test("another client's delete by id drops the pairs from every record's links without a read", async () => {
  const { store, emit, settle, reads } = setup({
    findings: [finding({ Requests: [R1, R2] }), finding({ ID: F2, Requests: [R2] })],
    testCases: [testCase()],
  });
  await store.populate();

  emit({ change: "delete", count: 1, selection: { ids: [R1] } });
  await settle();

  assert.deepEqual(reads, []);
  assert.deepEqual(get(store).findings.map((f) => [f.ID, f.Requests]), [[F1, [R2]], [F2, [R2]]]);
  assert.deepEqual(get(store).testCases[0].Requests, []);
  assert.equal(completenessOf("testCase", get(store).testCases[0]).items.find((i) => i.key === "Requests")?.done, false);
});

test("another client's delete by query rereads the records with links", async () => {
  const { store, emit, settle, change, reads } = setup({
    findings: [finding({ Requests: [R1] }), finding({ ID: F2, Requests: [] })],
    testCases: [testCase()],
  });
  await store.populate();

  change("finding", F1, { Requests: [] });
  change("testCase", T1, { Requests: [] });
  emit({ change: "delete", count: 1, selection: { query: "host = x", as_of: "2026-11-07T10:00:00Z" } });
  await settle();

  assert.deepEqual(reads, [["finding", F1], ["testCase", T1]], "F2 links nothing, so it stays as read");
  assert.deepEqual(get(store).findings[0].Requests, []);
  assert.deepEqual(get(store).testCases[0].Requests, []);
});

test("a bulk link while the edit session has unsaved text keeps the text and says it changed", async () => {
  const { store, emit, settle, change } = setup({ findings: [finding({ Requests: [R1] })] });
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine, unsaved" });

  change("finding", F1, { Requests: [R1, R2] });
  emit({ change: "link", count: 1, selection: { ids: [R2] }, target: { kind: "finding", id: F1 } });
  await settle();

  const { session } = get(store);
  assert.equal(session.draft.WriteUp, "Mine, unsaved");
  assert.deepEqual(session.draft.Requests, [R1, R2]);
  assert.equal(session.remote, "changed");
  assert.deepEqual(get(store).findings[0].Requests, [R1, R2]);
});

test("a bulk delete while the edit session has unsaved text keeps the text", async () => {
  const { store, emit, settle } = setup({ findings: [finding({ Requests: [R1, R2] })] });
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine, unsaved" });

  emit({ change: "delete", count: 1, selection: { ids: [R2] } });
  await settle();

  const { session } = get(store);
  assert.equal(session.draft.WriteUp, "Mine, unsaved");
  assert.deepEqual(session.draft.Requests, [R1]);
});

test("highlights, notes, metadata and launchpad links read nothing", async () => {
  const { store, emit, settle, reads } = setup({ findings: [finding({ Requests: [R1] })] });
  await store.populate();

  emit({ change: "highlight", count: 1, selection: { ids: [R1] } });
  emit({ change: "note", count: 1, selection: { ids: [R1] } });
  emit({ change: "metadata", count: 1, selection: { ids: [R1] } });
  emit({ change: "link", count: 1, selection: { ids: [R1] }, target: { kind: "launchpad", id: PAD } });
  await settle();

  assert.deepEqual(reads, []);
  assert.deepEqual(get(store).findings[0].Requests, [R1]);
});

test("a read that lands after the project closed changes nothing", async () => {
  const { store, emit, settle, change } = setup({ findings: [finding()] });
  await store.populate();

  change("finding", F1, { Requests: [R1] });
  emit({ change: "link", count: 1, selection: { ids: [R1] }, target: { kind: "finding", id: F1 } });
  store.clear();
  await settle();

  assert.deepEqual(get(store).findings, []);
});
