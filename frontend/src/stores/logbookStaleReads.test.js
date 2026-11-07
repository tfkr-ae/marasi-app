// A reread of a finding or test case that is still on its way when the
// record changes here (an event, a bulk delete, this app's own write) must
// not put the older snapshot back: the record's latest change and the
// newest read win, whatever order the replies land in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { completenessOf, createLogbookStore } from "./createLogbookStore.js";

const F1 = "11111111-1111-1111-1111-111111111111";
const R1 = "33333333-3333-3333-3333-333333333333";
const R2 = "44444444-4444-4444-4444-444444444444";
const A1 = "55555555-5555-5555-5555-555555555555";

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

// A finding.updated event's fields: no links or artifacts.
const fieldsOf = (fields) => {
  const { Requests, Artifacts, ...rest } = finding(fields);
  return rest;
};

const artifact = (fields = {}) => ({ ID: A1, FindingID: F1, TestCaseID: null, Name: "shot.png", ContentType: "image/png", ...fields });

// Every getFinding waits in `held` until the test answers it with a
// snapshot (`answer(i, record)`), so reads can overlap with changes.
function setup(findings) {
  const held = [];
  const api = {
    listFindings: async () => findings.map((f) => structuredClone(f)),
    listTestCases: async () => [],
    getFinding: (id) =>
      new Promise((resolve, reject) => {
        held.push({ id, resolve, reject });
      }),
    getTestCase: () => new Promise(() => {}),
    unlinkRequestFromFinding: async () => {},
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
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  // Lets the settle delay pass, starting the reads it holds.
  const settle = async () => {
    const run = due;
    due = [];
    run.forEach((t) => t.fn());
    await flush();
  };
  const answer = async (i, record) => {
    held[i].resolve(structuredClone(record));
    await flush();
  };
  const link = () => store.applyTrafficChanged({ change: "link", count: 1, selection: { ids: [R1] }, target: { kind: "finding", id: F1 } });
  const listed = () => get(store).findings.find((f) => f.ID === F1);
  return { store, held, settle, answer, link, listed, pendingTimers: () => due.length };
}

test("a pair deleted by id while its finding's reread is on the way stays gone", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding({ Requests: [R1] })]);
  await store.populate();

  link();
  await settle();
  assert.equal(held.length, 1, "the bulk link rereads the finding");
  store.applyTrafficChanged({ change: "delete", count: 1, selection: { ids: [R1] } });
  assert.deepEqual(listed().Requests, []);

  await answer(0, finding({ Requests: [R1] }));
  assert.deepEqual(listed().Requests, [], "the older snapshot does not bring the pair back");
  assert.equal(completenessOf("finding", listed()).items.find((i) => i.key === "Requests")?.done, false);

  // The superseded read asks again; the service now has no pair.
  await settle();
  assert.equal(held.length, 2, "a fresh read follows the superseded one");
  await answer(1, finding({ Requests: [] }));
  assert.deepEqual(listed().Requests, []);
});

test("a field update made while a reread is on the way survives the older snapshot", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding()]);
  await store.populate();

  link();
  await settle();
  store.applyRecord("finding", fieldsOf({ WriteUp: "After" }));
  await answer(0, finding({ Requests: [R1], WriteUp: "Before" }));

  assert.equal(listed().WriteUp, "After");
  await settle();
  await answer(1, finding({ Requests: [R1], WriteUp: "After" }));
  assert.equal(listed().WriteUp, "After");
  assert.deepEqual(listed().Requests, [R1], "the fresh read brings the bulk link");
});

test("a link and an unlink event while a reread is on the way survive the older snapshot", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding({ Requests: [R1] })]);
  await store.populate();

  link();
  await settle();
  store.applyLink("finding", F1, R2, true);
  store.applyLink("finding", F1, R1, false);
  await answer(0, finding({ Requests: [R1] }));

  assert.deepEqual(listed().Requests, [R2]);
});

test("artifacts added and removed while a reread is on the way survive the older snapshot", async () => {
  const kept = artifact({ ID: "66666666-6666-6666-6666-666666666666", Name: "old.png" });
  const { store, held, settle, answer, link, listed } = setup([finding({ Artifacts: [kept] })]);
  await store.populate();

  link();
  await settle();
  store.applyArtifact(artifact());
  store.applyArtifactRemoved(kept.ID);
  await answer(0, finding({ Requests: [R1], Artifacts: [kept] }));

  assert.deepEqual(listed().Artifacts.map((a) => a.ID), [A1]);
});

test("of two rereads of a finding, the newer one's snapshot stands whatever order they land in", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding()]);
  await store.populate();

  link();
  await settle();
  link();
  await settle();
  assert.equal(held.length, 2);
  await answer(1, finding({ Requests: [R1, R2] }));
  await answer(0, finding({ Requests: [R1] }));

  assert.deepEqual(listed().Requests, [R1, R2]);
});

test("a list read that lands after a record changed keeps the change and reads the record again", async () => {
  const { store, held, settle, answer, listed } = setup([finding({ Requests: [R1] })]);
  await store.populate();

  const listing = store.populate();
  store.applyTrafficChanged({ change: "delete", count: 1, selection: { ids: [R1] } });
  await listing;

  assert.deepEqual(listed().Requests, []);
  await settle();
  assert.equal(held.length, 1, "the changed record is read again");
  await answer(0, finding({ Requests: [] }));
  assert.deepEqual(listed().Requests, []);
});

test("a list read that lands after a record was deleted here leaves it gone", async () => {
  const { store, listed } = setup([finding()]);
  await store.populate();

  const listing = store.populate();
  store.applyDeleted("finding", F1);
  await listing;

  assert.equal(listed(), undefined);
});

test("an open edit session keeps its unsaved text through every overtaken reread", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding({ Requests: [R1] })]);
  await store.populate();
  store.edit("finding", F1);
  store.updateDraft({ WriteUp: "Mine, unsaved" });

  link();
  await settle();
  link();
  await settle();
  store.applyTrafficChanged({ change: "delete", count: 1, selection: { ids: [R1] } });
  store.applyRecord("finding", fieldsOf({ Title: "Theirs" }));
  store.applyArtifact(artifact());
  await answer(1, finding({ Requests: [R1] }));
  await answer(0, finding({ Requests: [R1] }));

  const { session } = get(store);
  assert.equal(session.draft.WriteUp, "Mine, unsaved");
  assert.equal(session.draft.Title, "Theirs");
  assert.deepEqual(session.draft.Requests, []);
  assert.deepEqual(listed().Requests, []);
  assert.deepEqual(listed().Artifacts.map((a) => a.ID), [A1]);
});

test("an inline fix keeps its input through an overtaken reread", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding({ Requests: [R1], WriteUp: "" })]);
  await store.populate();
  store.open("finding", F1);
  store.startFix("WriteUp");
  store.updateFix({ WriteUp: "Mine, unsaved" });

  link();
  await settle();
  store.applyTrafficChanged({ change: "delete", count: 1, selection: { ids: [R1] } });
  await answer(0, finding({ Requests: [R1], WriteUp: "" }));

  assert.equal(get(store).fix.draft.WriteUp, "Mine, unsaved");
  assert.deepEqual(listed().Requests, []);
});

test("this app's own unlink while a reread is on the way survives the older snapshot", async () => {
  const { store, held, settle, answer, link, listed } = setup([finding({ Requests: [R1] })]);
  await store.populate();

  link();
  await settle();
  await store.unlinkNow("finding", F1, R1);
  await answer(0, finding({ Requests: [R1] }));

  assert.deepEqual(listed().Requests, []);
});
