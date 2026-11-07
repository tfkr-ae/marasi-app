// The first read of the lists can still be on its way when a bulk link
// rereads one of its records. Whichever reply lands first, a record the
// service returns joins the list, unless it was deleted after that read
// started.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLogbookStore } from "./createLogbookStore.js";

const F1 = "11111111-1111-1111-1111-111111111111";
const F2 = "22222222-2222-2222-2222-222222222222";
const T1 = "77777777-7777-7777-7777-777777777777";
const R1 = "33333333-3333-3333-3333-333333333333";

const finding = (fields = {}) => ({
  ID: F1,
  TestCaseID: null,
  Title: "SQL injection",
  Severity: "High",
  CVSSVector: "",
  CVSSScore: 0,
  WriteUp: "",
  TreatmentPlan: "",
  CreatedAt: "2026-11-07T10:00:00Z",
  Requests: [],
  Artifacts: [],
  ...fields,
});

const testCase = (fields = {}) => ({
  ID: T1,
  Title: "Login bypass",
  Description: "",
  Status: "Open",
  CreatedAt: "2026-11-07T10:00:00Z",
  Requests: [],
  Artifacts: [],
  ...fields,
});

// Every list and record read waits until the test answers it.
function setup() {
  const held = { findings: [], testCases: [], finding: [], testCase: [] };
  const hold = (queue) => () => new Promise((resolve) => queue.push(resolve));
  const api = {
    listFindings: hold(held.findings),
    listTestCases: hold(held.testCases),
    getFinding: hold(held.finding),
    getTestCase: hold(held.testCase),
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
  const settle = async () => {
    const run = due;
    due = [];
    run.forEach((t) => t.fn());
    await flush();
  };
  const answer = async (queue, value) => {
    queue.shift()(structuredClone(value));
    await flush();
  };
  // The lists' reply: both lists answered.
  const lists = async ({ findings = [], testCases = [] }) => {
    held.findings.shift()(structuredClone(findings));
    held.testCases.shift()(structuredClone(testCases));
    await flush();
  };
  const link = (kind, id) => store.applyTrafficChanged({ change: "link", count: 1, selection: { ids: [R1] }, target: { kind, id } });
  return { store, held, settle, answer, lists, link };
}

const findingOf = (store, id = F1) => get(store).findings.find((f) => f.ID === id);
const testCaseOf = (store, id = T1) => get(store).testCases.find((t) => t.ID === id);

for (const order of ["list first", "record first"]) {
  test(`a finding linked during the first list read is listed with the record's data (${order})`, async () => {
    const { store, held, settle, answer, lists, link } = setup();
    const populating = store.populate();
    link("finding", F1);
    await settle();
    assert.equal(held.finding.length, 1, "the bulk link rereads the finding");

    if (order === "list first") {
      await lists({ findings: [finding()] });
      await answer(held.finding, finding({ Requests: [R1] }));
    } else {
      await answer(held.finding, finding({ Requests: [R1] }));
      await lists({ findings: [finding()] });
    }
    await populating;

    assert.deepEqual(findingOf(store)?.Requests, [R1]);
  });

  test(`a finding deleted while the first reads are on the way stays gone (${order})`, async () => {
    const { store, held, settle, answer, lists, link } = setup();
    const populating = store.populate();
    link("finding", F1);
    await settle();
    store.applyDeleted("finding", F1);

    if (order === "list first") {
      await lists({ findings: [finding()] });
      await answer(held.finding, finding({ Requests: [R1] }));
    } else {
      await answer(held.finding, finding({ Requests: [R1] }));
      await lists({ findings: [finding()] });
    }
    await populating;

    assert.equal(findingOf(store), undefined);
    await settle();
    assert.equal(held.finding.length, 0, "a deleted record is not read again");
  });

  test(`a test case linked during the first list read is listed with the record's data (${order})`, async () => {
    const { store, held, settle, answer, lists, link } = setup();
    const populating = store.populate();
    link("test_case", T1);
    await settle();
    assert.equal(held.testCase.length, 1);

    if (order === "list first") {
      await lists({ testCases: [testCase()] });
      await answer(held.testCase, testCase({ Requests: [R1] }));
    } else {
      await answer(held.testCase, testCase({ Requests: [R1] }));
      await lists({ testCases: [testCase()] });
    }
    await populating;

    assert.deepEqual(testCaseOf(store)?.Requests, [R1]);
  });

  test(`a test case deleted while the first reads are on the way stays gone (${order})`, async () => {
    const { store, held, settle, answer, lists, link } = setup();
    const populating = store.populate();
    link("test_case", T1);
    await settle();
    store.applyDeleted("testCase", T1);

    if (order === "list first") {
      await lists({ testCases: [testCase()] });
      await answer(held.testCase, testCase({ Requests: [R1] }));
    } else {
      await answer(held.testCase, testCase({ Requests: [R1] }));
      await lists({ testCases: [testCase()] });
    }
    await populating;

    assert.equal(testCaseOf(store), undefined);
  });
}

test("a record deleted here stays gone when a list read that started earlier returns it", async () => {
  const { store, held, answer, lists } = setup();
  const first = store.populate();
  await lists({ findings: [finding()] });
  await first;

  const again = store.populate();
  const reloading = store.reload("finding", F1);
  store.applyDeleted("finding", F1);
  await answer(held.finding, finding());
  await reloading;
  await lists({ findings: [finding()] });
  await again;

  assert.equal(findingOf(store), undefined);
});

test("a dirty edit session on another finding keeps its input through the first reads", async () => {
  const { store, held, settle, answer, lists, link } = setup();
  const first = store.populate();
  await lists({ findings: [finding({ ID: F2, Title: "XSS" })] });
  await first;
  store.edit("finding", F2);
  store.updateDraft({ WriteUp: "Mine, unsaved" });

  const again = store.populate();
  link("finding", F1);
  await settle();
  await answer(held.finding, finding({ Requests: [R1] }));
  await lists({ findings: [finding(), finding({ ID: F2, Title: "XSS" })] });
  await again;

  assert.equal(get(store).session.draft.WriteUp, "Mine, unsaved");
  assert.deepEqual(findingOf(store)?.Requests, [R1]);
  assert.equal(findingOf(store, F2)?.Title, "XSS");
});
