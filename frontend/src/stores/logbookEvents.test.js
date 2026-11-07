// The Logbook following changes other clients make: each service event, as
// the service sends it, reaches the store through logbookEvents and updates
// the lists in place, without clobbering an open edit session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLogbookStore, filteredOf, openRecordOf, reportOf } from "./createLogbookStore.js";
import { keptTemplate, logbookEvents, reportTemplateEvents } from "./logbookEvents.js";

const F1 = "11111111-1111-1111-1111-111111111111";
const T1 = "22222222-2222-2222-2222-222222222222";
const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";
const A1 = "55555555-5555-5555-5555-555555555555";

// A finding as the service's finding.created / finding.updated carry it.
const findingEvent = (fields = {}) => ({
  id: F1,
  test_case_id: null,
  title: "SQL injection",
  severity: "High",
  cvss_vector: "",
  cvss_score: 0,
  writeup: "",
  treatment_plan: "",
  created_at: "2026-11-07T10:00:00Z",
  ...fields,
});

const testCaseEvent = (fields = {}) => ({
  id: T1,
  title: "Login form",
  description: "",
  category: "Auth",
  tags: [],
  note: "",
  created_at: "2026-11-07T10:00:00Z",
  ...fields,
});

// A finding as the store keeps it, from GET /finding?full=1.
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
  Requests: [R1],
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
  Requests: [],
  Artifacts: [],
  ...fields,
});

function setup({ findings = [], testCases = [] } = {}) {
  const calls = [];
  const api = {
    listFindings: async () => findings.map((f) => structuredClone(f)),
    listTestCases: async () => testCases.map((t) => structuredClone(t)),
    saveFinding: async (f) => {
      calls.push(["saveFinding", f]);
      return f;
    },
    createDraftFinding: async () => {
      calls.push(["createDraftFinding"]);
      return finding({ ID: "f-new", Requests: [], Title: "Draft Finding" });
    },
    linkRequestToFinding: async (...args) => calls.push(["link", ...args]),
    unlinkRequestFromFinding: async (...args) => calls.push(["unlink", ...args]),
    deleteFinding: async (id) => calls.push(["deleteFinding", id]),
  };
  const store = createLogbookStore(api);
  const events = logbookEvents(store);
  const emit = (name, data) => events[name](data);
  return { store, emit, calls };
}

test("a finding another client creates is listed", async () => {
  const { store, emit } = setup();
  await store.populate();
  emit("finding.created", findingEvent());
  assert.deepEqual(
    filteredOf(get(store)).findings.map((f) => [f.ID, f.Title, f.Severity]),
    [[F1, "SQL injection", "High"]],
  );
});

test("a finding changed elsewhere updates the open record and keeps its links", async () => {
  const { store, emit } = setup({ findings: [finding()] });
  await store.populate();
  store.open("finding", F1);
  emit("finding.updated", findingEvent({ writeup: "After", severity: "Critical" }));
  const open = openRecordOf(get(store));
  assert.equal(open.record.WriteUp, "After");
  assert.equal(open.record.Severity, "Critical");
  assert.deepEqual(open.record.Requests, [R1]);
  assert.equal(reportOf(get(store)).severityCounts.Critical, 1);
});

test("a finding deleted elsewhere leaves the list and the open record closes", async () => {
  const { store, emit } = setup({ findings: [finding()] });
  await store.populate();
  store.open("finding", F1);
  emit("finding.deleted", { id: F1 });
  assert.deepEqual(get(store).findings, []);
  assert.equal(get(store).open, null);
  assert.equal(get(store).fix, null);
});

test("a test case deleted elsewhere leaves the findings that named it", async () => {
  const { store, emit } = setup({ findings: [finding({ TestCaseID: T1 })], testCases: [testCase()] });
  await store.populate();
  emit("test-case.deleted", { id: T1 });
  assert.deepEqual(get(store).testCases, []);
  assert.equal(get(store).findings[0].TestCaseID, null);
});

test("links and unlinks made elsewhere follow on the record", async () => {
  const { store, emit } = setup({ findings: [finding()], testCases: [testCase()] });
  await store.populate();
  emit("finding.linked", { finding_id: F1, id: R2 });
  emit("finding.linked", { finding_id: F1, id: R2 });
  emit("finding.unlinked", { finding_id: F1, id: R1 });
  emit("test-case.linked", { test_case_id: T1, id: R1 });
  assert.deepEqual(get(store).findings[0].Requests, [R2]);
  assert.deepEqual(get(store).testCases[0].Requests, [R1]);
  emit("test-case.unlinked", { test_case_id: T1, id: R1 });
  assert.deepEqual(get(store).testCases[0].Requests, []);
});

test("artifacts added and deleted elsewhere follow on their record", async () => {
  const { store, emit } = setup({ findings: [finding()], testCases: [testCase()] });
  await store.populate();
  const artifact = { id: A1, filename: "shot.png", mime_type: "image/png", size: 10, finding_id: F1, test_case_id: null, created_at: "2026-11-07T10:00:00Z" };
  emit("artifact.created", artifact);
  emit("artifact.created", artifact);
  assert.deepEqual(get(store).findings[0].Artifacts.map((a) => [a.ID, a.Filename]), [[A1, "shot.png"]]);
  assert.equal(reportOf(get(store)).evidence, 2);
  emit("artifact.created", { ...artifact, id: "a2", finding_id: null, test_case_id: T1 });
  assert.deepEqual(get(store).testCases[0].Artifacts.map((a) => a.ID), ["a2"]);
  emit("artifact.deleted", { id: A1 });
  emit("artifact.deleted", { id: "a2" });
  assert.deepEqual(get(store).findings[0].Artifacts, []);
  assert.deepEqual(get(store).testCases[0].Artifacts, []);
});

test("a change elsewhere keeps the researcher's edits in the modal and says so", async () => {
  const { store, emit, calls } = setup({ findings: [finding()] });
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine" });
  emit("finding.updated", findingEvent({ writeup: "Theirs", treatment_plan: "Patch it" }));
  const session = get(store).session;
  assert.equal(session.draft.WriteUp, "Mine");
  assert.equal(session.draft.TreatmentPlan, "Patch it", "a field the researcher left follows the change");
  assert.equal(session.remote, "changed");
  assert.equal(get(store).findings[0].WriteUp, "Theirs", "the list shows what the service holds");
  await store.save();
  const [, saved] = calls.find(([name]) => name === "saveFinding");
  assert.equal(saved.WriteUp, "Mine");
  assert.equal(saved.TreatmentPlan, "Patch it");
});

test("a change elsewhere to a clean modal session follows it without a notice", async () => {
  const { store, emit } = setup({ findings: [finding()] });
  await store.populate();
  store.edit("finding", F1);
  emit("finding.updated", findingEvent({ writeup: "Theirs" }));
  emit("finding.linked", { finding_id: F1, id: R2 });
  const session = get(store).session;
  assert.equal(session.draft.WriteUp, "Theirs");
  assert.deepEqual(session.draft.Requests, [R1, R2]);
  assert.equal(session.remote ?? null, null);
});

test("the echo of the session's own save raises no notice", async () => {
  const { store, emit } = setup({ findings: [finding()] });
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine" });
  emit("finding.updated", findingEvent({ writeup: "Mine" }));
  assert.equal(get(store).session.remote ?? null, null);
});

test("a record deleted elsewhere keeps the modal's draft, and Save creates it again", async () => {
  const { store, emit, calls } = setup({ findings: [finding()] });
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine" });
  emit("finding.deleted", { id: F1 });
  const session = get(store).session;
  assert.equal(session.remote, "deleted");
  assert.equal(session.isNew, true);
  assert.equal(session.draft.WriteUp, "Mine");
  assert.deepEqual(session.draft.Artifacts, []);
  const result = await store.save();
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(([name]) => name).slice(0, 2), ["createDraftFinding", "saveFinding"]);
  assert.equal(calls.find(([name]) => name === "saveFinding")[1].WriteUp, "Mine");
});

test("an inline fix with input keeps it through a change to its item and says so", async () => {
  const { store, emit } = setup({ findings: [finding({ TreatmentPlan: "" })] });
  await store.populate();
  store.open("finding", F1, "TreatmentPlan");
  store.updateFix({ TreatmentPlan: "Mine" });
  emit("finding.updated", findingEvent({ writeup: "Before", treatment_plan: "Theirs" }));
  assert.equal(get(store).fix.draft.TreatmentPlan, "Mine");
  assert.equal(get(store).fix.remote, "changed");
});

test("a record deleted under an inline fix with input moves the input to the modal", async () => {
  const { store, emit } = setup({ findings: [finding({ TreatmentPlan: "" })] });
  await store.populate();
  store.open("finding", F1, "TreatmentPlan");
  store.updateFix({ TreatmentPlan: "Mine" });
  emit("finding.deleted", { id: F1 });
  assert.equal(get(store).fix, null);
  assert.equal(get(store).open, null);
  const session = get(store).session;
  assert.equal(session.remote, "deleted");
  assert.equal(session.isNew, true);
  assert.equal(session.draft.TreatmentPlan, "Mine");
  assert.equal(session.draft.WriteUp, "Before");
});

test("this app's own delete is not taken for a deletion elsewhere", async () => {
  const { store, emit } = setup({ findings: [finding({ TreatmentPlan: "" })] });
  await store.populate();
  store.open("finding", F1, "TreatmentPlan");
  store.updateFix({ TreatmentPlan: "Mine" });
  const deleting = store.deleteRecord("finding", F1);
  emit("finding.deleted", { id: F1 });
  await deleting;
  assert.equal(get(store).session, null);
  assert.deepEqual(get(store).findings, []);
});

test("the export review's templates follow templates added, removed and restored elsewhere", () => {
  const seen = [];
  const events = reportTemplateEvents((names) => seen.push(names));
  const list = (...names) => ({ items: names.map((name) => ({ name, path: `/t/${name}` })) });
  events["report.template.added"](list("default_template.md", "client.md"));
  events["report.template.removed"](list("default_template.md"));
  events["report.template.restored"](list("default_template.md"));
  assert.deepEqual(seen, [["default_template.md", "client.md"], ["default_template.md"], ["default_template.md"]]);
});

test("the chosen template stays while it is listed, else the first is chosen", () => {
  assert.equal(keptTemplate(["a.md", "b.md"], "b.md"), "b.md");
  assert.equal(keptTemplate(["a.md"], "b.md"), "a.md");
  assert.equal(keptTemplate([], "b.md"), undefined);
});
