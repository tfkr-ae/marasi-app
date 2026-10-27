// The Logbook store's edit session: what the finding and test case modal
// stages, and what Save and Discard do with it, over a fake bindings API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { changesOf, createLogbookStore, isDirty } from "./createLogbookStore.js";

const finding = (id, fields = {}) => ({
  ID: id,
  Title: `Finding ${id}`,
  Severity: "Medium",
  CVSSScore: 5.3,
  CVSSVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
  WriteUp: "What happened",
  TreatmentPlan: "Fix it",
  Requests: ["r1"],
  TestCaseID: null,
  Artifacts: [{ ID: "a1", Filename: "shot.png", MimeType: "image/png", Size: 10 }],
  ...fields,
});

const testCase = (id, fields = {}) => ({
  ID: id,
  Title: `Test case ${id}`,
  Description: "",
  Category: "XSS",
  Tags: [],
  Note: "Checked",
  Requests: [],
  Artifacts: [],
  ...fields,
});

// A file as the modal's file input hands it over.
const file = (name) => ({ name, type: "text/plain", size: 4 });

// The bindings the edit session uses, recording each call. `fail` names a
// call that rejects.
function fakeApi({ findings = [], testCases = [], fail = null } = {}) {
  const calls = [];
  let ids = 0;
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
    createDraftFinding: call("createDraftFinding", (requestIds, testCaseId) => ({
      ...finding("new-f"),
      Title: "Draft Finding",
      Requests: requestIds,
      TestCaseID: testCaseId,
      Artifacts: [],
    })),
    createDraftTestCase: call("createDraftTestCase", (requestIds) => ({
      ...testCase("new-t"),
      Title: "Draft Test Case",
      Requests: requestIds,
    })),
    saveFinding: call("saveFinding"),
    saveTestCase: call("saveTestCase"),
    linkRequestToFinding: call("linkRequestToFinding"),
    unlinkRequestFromFinding: call("unlinkRequestFromFinding"),
    linkRequestToTestCase: call("linkRequestToTestCase"),
    unlinkRequestFromTestCase: call("unlinkRequestFromTestCase"),
    saveArtifactToFinding: call("saveArtifactToFinding", (id, f) => ({
      ID: `art-${++ids}`,
      Filename: f.name,
      MimeType: f.type,
      Size: f.size,
    })),
    saveArtifactToTestCase: call("saveArtifactToTestCase", (id, f) => ({
      ID: `art-${++ids}`,
      Filename: f.name,
      MimeType: f.type,
      Size: f.size,
    })),
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

const session = (store) => get(store).session;

test("New starts a blank draft and calls nothing", async () => {
  const { api, store } = await loaded();
  store.startNew("finding");
  const s = session(store);
  assert.equal(s.kind, "finding");
  assert.equal(s.isNew, true);
  assert.equal(s.draft.Title, "");
  assert.deepEqual(s.draft.Requests, []);
  assert.equal(isDirty(s), false);
  assert.deepEqual(api.calls, []);
});

test("editing a record copies it to a draft that starts clean", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  const s = session(store);
  assert.equal(s.isNew, false);
  assert.equal(s.draft.Title, "Finding f1");
  assert.deepEqual(changesOf(s), []);
  store.updateDraft({ Title: "Changed" });
  assert.equal(get(store).findings[0].Title, "Finding f1", "the listed record is untouched");
  assert.deepEqual(api.calls, []);
});

test("the change list names changed fields and counts request and artifact changes", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.updateDraft({ Title: "New title", TreatmentPlan: "Patch" });
  store.linkRequest("r2");
  store.linkRequest("r3");
  store.unlinkRequest("r1");
  store.addArtifacts([file("a.txt")]);
  store.removeArtifact("a1");
  assert.deepEqual(changesOf(session(store)), [
    "Title",
    "Treatment plan",
    "+2 requests",
    "−1 request",
    "+1 artifact",
    "−1 artifact",
  ]);
});

test("undoing every change leaves the draft clean", async () => {
  const { store } = await loaded({ testCases: [testCase("t1", { Requests: ["r1"] })] });
  store.edit("testCase", "t1");
  store.updateDraft({ Tags: ["auth"] });
  store.unlinkRequest("r1");
  assert.equal(isDirty(session(store)), true);
  store.updateDraft({ Tags: [] });
  store.linkRequest("r1");
  assert.equal(isDirty(session(store)), false);
});

test("a removed artifact comes back with Undo, and a new one is dropped outright", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.removeArtifact("a1");
  store.addArtifacts([file("b.txt")]);
  const added = session(store).draft.Artifacts.find((a) => a.Filename === "b.txt");
  store.restoreArtifact("a1");
  store.removeArtifact(added.ID);
  assert.deepEqual(session(store).draft.Artifacts.map((a) => a.ID), ["a1"]);
  assert.equal(isDirty(session(store)), false);
});

test("linking a request already linked changes nothing", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.linkRequest("r1");
  assert.deepEqual(session(store).draft.Requests, ["r1"]);
});

test("a changed score on a scored finding sets the severity", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.updateDraft({ CVSSVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", CVSSScore: 9.8 });
  assert.equal(session(store).draft.Severity, "Critical");
  store.updateDraft({ Severity: "Low" });
  assert.equal(session(store).draft.Severity, "Low", "a severity picked by hand stays");
  store.updateDraft({ CVSSVector: "", CVSSScore: null });
  assert.equal(session(store).draft.Severity, "Low", "clearing the score leaves the severity");
});

test("Discard closes the session with no calls and leaves the record as it was", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.updateDraft({ Title: "Changed" });
  store.unlinkRequest("r1");
  store.removeArtifact("a1");
  store.discard();
  assert.equal(session(store), null);
  assert.deepEqual(api.calls, []);
  assert.equal(get(store).findings[0].Title, "Finding f1");
});

test("an untouched new record discarded leaves nothing behind", async () => {
  const { api, store } = await loaded();
  store.startNew("testCase", { requestIds: ["r1"] });
  assert.equal(store.requestClose(), "closed");
  assert.equal(session(store), null);
  assert.deepEqual(api.calls, []);
  assert.deepEqual(get(store).testCases, []);
});

test("Request close closes a clean session and asks on a dirty one", async () => {
  const { store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  assert.equal(store.requestClose(), "closed");
  assert.equal(session(store), null);

  store.edit("finding", "f1");
  store.updateDraft({ WriteUp: "More" });
  assert.equal(store.requestClose(), "confirm");
  assert.equal(session(store).confirming, true);
  store.keepEditing();
  assert.equal(session(store).confirming, false);
  assert.equal(session(store).draft.WriteUp, "More", "keeping on editing keeps the draft");
});

test("Save on a new finding creates it with the pre-filled IDs, then saves the fields, then uploads", async () => {
  const { api, store } = await loaded();
  store.startNew("finding", { requestIds: ["r1"], testCaseId: "t1" });
  store.updateDraft({ Title: "SQL injection", WriteUp: "Login form" });
  store.linkRequest("r2");
  store.addArtifacts([file("dump.txt")]);
  const result = await store.save();

  assert.deepEqual(result, { ok: true, kind: "finding", id: "new-f", created: true });
  assert.deepEqual(api.names(), ["createDraftFinding", "saveFinding", "saveArtifactToFinding"]);
  assert.deepEqual(api.calls[0], ["createDraftFinding", ["r1", "r2"], "t1"]);
  const saved = api.calls[1][1];
  assert.equal(saved.ID, "new-f");
  assert.equal(saved.Title, "SQL injection");
  assert.equal(saved.WriteUp, "Login form");
  assert.deepEqual(saved.Requests, ["r1", "r2"]);
  assert.equal(saved.Artifacts, undefined, "artifacts go up on their own");
  assert.equal(api.calls[2][1], "new-f");
  assert.equal(api.calls[2][2].name, "dump.txt");

  assert.equal(session(store), null);
  const listed = get(store).findings;
  assert.deepEqual(listed.map((f) => [f.ID, f.Title]), [["new-f", "SQL injection"]]);
  assert.deepEqual(listed[0].Artifacts.map((a) => a.Filename), ["dump.txt"]);
});

test("Save on a new test case creates it with the pre-filled requests, then saves, then uploads", async () => {
  const { api, store } = await loaded();
  store.startNew("testCase", { requestIds: ["r9"] });
  store.updateDraft({ Title: "Login brute force", Tags: ["auth"] });
  store.addArtifacts([file("notes.txt")]);
  await store.save();
  assert.deepEqual(api.names(), ["createDraftTestCase", "saveTestCase", "saveArtifactToTestCase"]);
  assert.deepEqual(api.calls[0], ["createDraftTestCase", ["r9"]]);
  assert.equal(api.calls[1][1].Title, "Login brute force");
  assert.deepEqual(api.calls[1][1].Tags, ["auth"]);
  assert.deepEqual(get(store).testCases.map((t) => t.Title), ["Login brute force"]);
});

test("Save on a record saves the fields, then links and unlinks, then uploads and deletes", async () => {
  const { api, store } = await loaded({ findings: [finding("f1", { Requests: ["r1", "r2"] })] });
  store.edit("finding", "f1");
  store.updateDraft({ TreatmentPlan: "Parameterise queries" });
  store.unlinkRequest("r1");
  store.linkRequest("r3");
  store.addArtifacts([file("new.txt")]);
  store.removeArtifact("a1");
  const result = await store.save();

  assert.deepEqual(result, { ok: true, kind: "finding", id: "f1", created: false });
  assert.deepEqual(api.calls.map(([name, ...args]) => [name, ...args.slice(1).map((a) => a?.name ?? a)]), [
    ["saveFinding"],
    ["linkRequestToFinding", "r3"],
    ["unlinkRequestFromFinding", "r1"],
    ["saveArtifactToFinding", "new.txt"],
    ["deleteArtifact"],
  ]);
  assert.deepEqual(api.calls[0][1].Requests, ["r1", "r2"], "the fields save keeps the stored links; the diffs follow");
  assert.equal(api.calls[0][1].TreatmentPlan, "Parameterise queries");
  assert.equal(api.calls[1][1], "f1");
  assert.deepEqual(api.calls[4], ["deleteArtifact", "a1"]);

  const saved = get(store).findings[0];
  assert.equal(saved.TreatmentPlan, "Parameterise queries");
  assert.deepEqual(saved.Requests, ["r2", "r3"]);
  assert.deepEqual(saved.Artifacts.map((a) => a.Filename), ["new.txt"]);
});

test("Save on a test case links and unlinks with the test case bindings", async () => {
  const { api, store } = await loaded({ testCases: [testCase("t1", { Requests: ["r1"] })] });
  store.edit("testCase", "t1");
  store.updateDraft({ Note: "Locked out after 5 tries" });
  store.unlinkRequest("r1");
  store.linkRequest("r2");
  await store.save();
  assert.deepEqual(api.names(), ["saveTestCase", "linkRequestToTestCase", "unlinkRequestFromTestCase"]);
});

test("Save with only link changes leaves the fields alone", async () => {
  const { api, store } = await loaded({ findings: [finding("f1")] });
  store.edit("finding", "f1");
  store.linkRequest("r2");
  await store.save();
  assert.deepEqual(api.names(), ["linkRequestToFinding"]);
});

test("Save is refused with an empty title, with no calls", async () => {
  const { api, store } = await loaded();
  store.startNew("finding");
  store.updateDraft({ Title: "   ", WriteUp: "Something" });
  const result = await store.save();
  assert.deepEqual(result, { ok: false, reason: "title" });
  assert.deepEqual(api.calls, []);
  assert.equal(session(store).draft.WriteUp, "Something");
});

test("a failed call keeps the session and its draft open with the error", async () => {
  const api = fakeApi({ findings: [finding("f1")], fail: "linkRequestToFinding" });
  const store = createLogbookStore(api);
  await store.populate();
  store.edit("finding", "f1");
  store.updateDraft({ Title: "Renamed" });
  store.linkRequest("r2");
  const result = await store.save();

  assert.equal(result.ok, false);
  assert.match(String(result.error), /reporting_failed/);
  const s = session(store);
  assert.equal(s.saving, false);
  assert.match(String(s.error), /reporting_failed/);
  assert.equal(s.draft.Title, "Renamed");
  assert.deepEqual(s.draft.Requests, ["r1", "r2"]);
});

test("Save again after a failure replays only what is still unsaved", async () => {
  const api = fakeApi({ fail: "saveArtifactToFinding" });
  const store = createLogbookStore(api);
  store.startNew("finding", { requestIds: ["r1"] });
  store.updateDraft({ Title: "XSS" });
  store.addArtifacts([file("a.txt")]);
  await store.save();
  assert.deepEqual(api.names(), ["createDraftFinding", "saveFinding", "saveArtifactToFinding"]);
  assert.deepEqual(changesOf(session(store)), ["+1 artifact"], "the record exists; only the upload is left");

  api.calls.length = 0;
  api.saveArtifactToFinding = async (id, f) => {
    api.calls.push(["saveArtifactToFinding", id, f]);
    return { ID: "art-9", Filename: f.name, MimeType: f.type, Size: f.size };
  };
  const result = await store.save();
  assert.equal(result.ok, true);
  assert.deepEqual(api.names(), ["saveArtifactToFinding"], "no second create");
  assert.equal(api.calls[0][1], "new-f");
});
