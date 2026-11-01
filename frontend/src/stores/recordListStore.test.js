// The findings' and test cases' lists, which follow Marasi's finding.*,
// test-case.* and artifact.* events, over a fake API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createRecordListStore } from "./createRecordListStore.js";

const record = (id, fields = {}) => ({ ID: id, Title: `Record ${id}`, Requests: [], Artifacts: [], ...fields });

// `records` is the project as Marasi has it; `read` answers from it, null
// for a record that is gone. A read can be held until released.
function fakeApi(records) {
  const held = [];
  const api = {
    records,
    holdReads: false,
    list: async () => api.records.map((r) => ({ ...r })),
    read: async (id) => {
      const answer = api.records.find((r) => r.ID === id) ?? null;
      if (!api.holdReads) return answer;
      return new Promise((resolve) => held.push(() => resolve(answer)));
    },
    release: (index) => held[index](),
  };
  return api;
}

async function loaded(records) {
  const api = fakeApi(records);
  const store = createRecordListStore(api);
  await store.populate();
  return { api, store };
}

const titles = (store) => get(store).map((r) => r.Title);

test("a record another client changed is read again in place", async () => {
  const { api, store } = await loaded([record("a"), record("b")]);
  api.records = [record("a"), record("b", { Title: "Renamed", Requests: ["r1"] })];
  await store.onChanged("b");
  assert.deepEqual(titles(store), ["Record a", "Renamed"]);
  assert.deepEqual(get(store)[1].Requests, ["r1"]);
});

test("a record another client created joins the top of the list", async () => {
  const { api, store } = await loaded([record("a")]);
  api.records = [record("a"), record("new")];
  await store.onChanged("new");
  assert.deepEqual(titles(store), ["Record new", "Record a"]);
});

test("a change to a record that is gone by the read takes it out", async () => {
  const { api, store } = await loaded([record("a"), record("b")]);
  api.records = [record("a")];
  await store.onChanged("b");
  assert.deepEqual(titles(store), ["Record a"]);
});

test("a deleted record leaves the list", async () => {
  const { store } = await loaded([record("a"), record("b")]);
  store.onDeleted("a");
  assert.deepEqual(titles(store), ["Record b"]);
});

test("a deleted artifact leaves whichever record holds it", async () => {
  const { store } = await loaded([
    record("a", { Artifacts: [{ ID: "x" }, { ID: "y" }] }),
    record("b", { Artifacts: [{ ID: "z" }] }),
  ]);
  store.onArtifactDeleted("x");
  assert.deepEqual(get(store).map((r) => r.Artifacts.map((a) => a.ID)), [["y"], ["z"]]);
});

test("of two reads of one record, only the later one's answer is kept", async () => {
  const { api, store } = await loaded([record("a")]);
  api.holdReads = true;
  api.records = [record("a", { Title: "First" })];
  const first = store.onChanged("a");
  api.records = [record("a", { Title: "Second" })];
  const second = store.onChanged("a");
  api.release(1);
  await second;
  api.release(0);
  await first;
  assert.deepEqual(titles(store), ["Second"]);
});

test("a read on its way when the record is deleted doesn't bring it back", async () => {
  const { api, store } = await loaded([record("a"), record("b")]);
  api.holdReads = true;
  const reading = store.onChanged("a");
  store.onDeleted("a");
  api.release(0);
  await reading;
  assert.deepEqual(titles(store), ["Record b"]);
});

test("a read on its way when the project is cleared is dropped", async () => {
  const { api, store } = await loaded([record("a")]);
  api.holdReads = true;
  const reading = store.onChanged("a");
  store.clear();
  api.release(0);
  await reading;
  assert.deepEqual(get(store), []);
});

test("reload reads the whole list again", async () => {
  const { api, store } = await loaded([record("a")]);
  api.records = [record("a"), record("b")];
  await store.reload();
  assert.deepEqual(titles(store), ["Record a", "Record b"]);
});
