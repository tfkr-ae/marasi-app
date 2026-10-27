// The Logbook store's inline fixes: filling one checklist item of the open
// record in place, saved through the edit session's Save path with only
// that item's changes, over a fake bindings API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLogbookStore, isDirty } from "./createLogbookStore.js";

const finding = (id, fields = {}) => ({
  ID: id,
  Title: `Finding ${id}`,
  Severity: "Medium",
  CVSSScore: 0,
  CVSSVector: "",
  WriteUp: "",
  TreatmentPlan: "",
  Requests: [],
  TestCaseID: null,
  Artifacts: [],
  ...fields,
});

const testCase = (id, fields = {}) => ({
  ID: id,
  Title: `Test case ${id}`,
  Description: "",
  Category: "",
  Tags: [],
  Note: "",
  Requests: [],
  Artifacts: [],
  ...fields,
});

// Records every binding call; `fail` names one that rejects.
function fakeApi({ findings = [], testCases = [], fail = null } = {}) {
  const calls = [];
  const call =
    (name, result = () => undefined) =>
    async (...args) => {
      calls.push([name, ...args]);
      if (name === fail) throw new Error(`${name}: reporting_failed: disk full`);
      return result(...args);
    };
  return {
    calls,
    names: () => calls.map(([name]) => name),
    listFindings: call("listFindings", () => findings.map((f) => ({ ...f }))),
    listTestCases: call("listTestCases", () => testCases.map((t) => ({ ...t }))),
    createDraftFinding: call("createDraftFinding"),
    createDraftTestCase: call("createDraftTestCase"),
    saveFinding: call("saveFinding"),
    saveTestCase: call("saveTestCase"),
    linkRequestToFinding: call("linkRequestToFinding"),
    unlinkRequestFromFinding: call("unlinkRequestFromFinding"),
    linkRequestToTestCase: call("linkRequestToTestCase"),
    unlinkRequestFromTestCase: call("unlinkRequestFromTestCase"),
    saveArtifactToFinding: call("saveArtifactToFinding"),
    saveArtifactToTestCase: call("saveArtifactToTestCase"),
    deleteArtifact: call("deleteArtifact"),
  };
}

async function loaded(records = {}) {
  const api = fakeApi(records);
  const store = createLogbookStore(api);
  await store.populate();
  api.calls.length = 0;
  return { api, store };
}

const fix = (store) => get(store).fix;

test("opening a record opens its first missing required item, without focus", async () => {
  const { api, store } = await loaded({ findings: [finding("f1", { WriteUp: "Seen" })] });
  store.open("finding", "f1");
  assert.equal(fix(store).item, "CVSSVector");
  assert.equal(fix(store).focus, false);
  assert.equal(isDirty(fix(store)), false);
  assert.deepEqual(api.calls, []);
});

test("Save on a fix writes only that item, over the record as it is now, then opens the next missing item", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1");
  store.updateFix({ WriteUp: "Reflected XSS in q" });
  // The modal saved another field meanwhile.
  store.setRecords("finding", [finding("f1", { Title: "Renamed", TreatmentPlan: "Encode output" })]);
  const result = await store.saveFix();

  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  assert.deepEqual(api.names(), ["saveFinding"]);
  const saved = api.calls[0][1];
  assert.equal(saved.WriteUp, "Reflected XSS in q");
  assert.equal(saved.Title, "Renamed");
  assert.equal(saved.TreatmentPlan, "Encode output");
  assert.equal(get(store).findings[0].WriteUp, "Reflected XSS in q");
  assert.equal(fix(store).item, "CVSSVector");
});

test("a CVSS fix sets the severity from the score and saves vector, score and severity", async () => {
  const { api, store } = await loaded({ findings: [finding("f1", { WriteUp: "Seen", Severity: "Low" })] });
  store.open("finding", "f1");
  assert.equal(fix(store).item, "CVSSVector");
  store.updateFix({ CVSSVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", CVSSScore: 9.8 });
  assert.equal(fix(store).draft.Severity, "Critical");
  await store.saveFix();
  assert.deepEqual(api.names(), ["saveFinding"]);
  const saved = api.calls[0][1];
  assert.equal(saved.CVSSScore, 9.8);
  assert.equal(saved.Severity, "Critical");
  assert.equal(get(store).findings[0].Severity, "Critical");
  assert.equal(get(store).findings[0].CVSSScore, 9.8);
});

test("a requests fix links and unlinks only what it changed", async () => {
  const { api, store } = await loaded({ testCases: [testCase("t1", { Note: "Tried", Requests: ["r1"] })] });
  store.open("testCase", "t1");
  assert.equal(fix(store), null, "a Done record opens on nothing");
  store.startFix("Requests");
  assert.equal(fix(store).focus, true);
  store.linkFixRequest("r2");
  store.unlinkFixRequest("r1");
  // Linked elsewhere meanwhile.
  store.setRecords("testCase", [testCase("t1", { Note: "Tried", Requests: ["r1", "r9"] })]);
  await store.saveFix();
  assert.deepEqual(api.calls, [
    ["linkRequestToTestCase", "t1", "r2"],
    ["unlinkRequestFromTestCase", "t1", "r1"],
  ]);
  assert.deepEqual(get(store).testCases[0].Requests, ["r9", "r2"]);
});

test("saving the last missing item says the record is Done and leaves it open with no fix", async () => {
  const { store } = await loaded({
    findings: [finding("f1", { WriteUp: "w", CVSSVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N", CVSSScore: 5.3, Requests: ["r1"] })],
  });
  store.open("finding", "f1");
  assert.equal(fix(store).item, "TreatmentPlan");
  store.updateFix({ TreatmentPlan: "Patch" });
  const result = await store.saveFix();
  assert.equal(result.done, true);
  assert.equal(fix(store), null);
  assert.equal(get(store).open.id, "f1");
});

test("an unsaved fix asks before another record, Back, Next or a filter change; Discard then moves", async () => {
  const { store } = await loaded({ findings: [finding("f1"), finding("f2")] });
  const moves = [
    ["another record", () => store.open("finding", "f2"), (s) => s.open.id === "f2"],
    ["Back", () => store.close(), (s) => s.open === null],
    ["Next", () => store.openNext(), (s) => s.open.id === "f2"],
    ["a filter change", () => store.setQuery("xss"), (s) => s.open === null && s.filters.q === "xss"],
  ];
  for (const [name, move, moved] of moves) {
    store.clearFilters();
    store.open("finding", "f1");
    store.updateFix({ WriteUp: "typing" });
    move();
    assert.equal(get(store).open.id, "f1", `${name} waits`);
    assert.equal(fix(store).leaving, true, `${name} asks`);
    store.keepFix();
    assert.equal(fix(store).leaving, false);
    assert.equal(fix(store).draft.WriteUp, "typing", `${name}: Keep editing keeps the input`);
    move();
    store.discardFix();
    assert.ok(moved(get(store)), `${name} goes after Discard`);
  }
});

test("Edit with an unsaved fix asks first; Discard drops the fix, then edits", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1");
  store.updateFix({ WriteUp: "typing" });
  let edits = 0;
  const editing = () => edits++;
  assert.equal(store.guard(editing), false);
  assert.equal(edits, 0);
  assert.equal(fix(store).leaving, true);
  store.keepFix();
  assert.equal(fix(store).draft.WriteUp, "typing");
  store.guard(editing);
  store.discardFix();
  assert.equal(edits, 1);
  assert.equal(fix(store), null);
  assert.equal(get(store).open.id, "f1", "the record stays open behind the modal");
  assert.equal(store.guard(editing), true, "with no input, Edit goes at once");
  assert.equal(edits, 2);
});

test("a fix with no input lets the tester move away at once", async () => {
  const { store } = await loaded({ findings: [finding("f1"), finding("f2")] });
  store.open("finding", "f1");
  store.open("finding", "f2");
  assert.equal(get(store).open.id, "f2");
  assert.equal(fix(store).id, "f2");
});

test("Cancel drops the fix with no calls", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1");
  store.updateFix({ WriteUp: "typing" });
  store.cancelFix();
  assert.equal(fix(store), null);
  assert.equal(get(store).findings[0].WriteUp, "");
  assert.deepEqual(api.calls, []);
});

test("a failed save keeps the fix and its input", async () => {
  const { store } = await loaded({ findings: [finding("f1")], fail: "saveFinding" });
  store.open("finding", "f1");
  store.updateFix({ WriteUp: "typing" });
  const result = await store.saveFix();
  assert.equal(result.ok, false);
  assert.equal(fix(store).draft.WriteUp, "typing");
  assert.ok(fix(store).error);
});

test("a fix and the modal's session stage apart", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1");
  store.updateFix({ WriteUp: "inline" });
  store.edit("finding", "f1");
  store.updateDraft({ Title: "In the modal" });
  assert.equal(get(store).session.draft.WriteUp, "");
  assert.equal(fix(store).draft.Title, "Finding f1");
  await store.save();
  assert.equal(fix(store).draft.WriteUp, "inline", "the modal's save leaves the fix's input");
});

test("a fix with no input follows the record when it is saved elsewhere", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1");
  store.setRecords("finding", [finding("f1", { WriteUp: "From the modal" })]);
  assert.equal(fix(store).item, "CVSSVector");
});

test("a record can open on a given item", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.open("finding", "f1", "Requests");
  assert.equal(fix(store).item, "Requests");
});
