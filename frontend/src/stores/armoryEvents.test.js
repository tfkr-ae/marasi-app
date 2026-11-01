// The Armory store follows Marasi's armory.* and wordlist.* events, so a
// run's progress and every client's changes show without polling, and a
// reload after the event stream reopens keeps what the researcher has open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createArmoryStore } from "./createArmoryStore.js";

const T1 = "t1";
const T2 = "t2";

const template = (id, name = id) => ({ ID: id, Name: name, Description: "", RawTemplate: `GET /${id}` });
const run = (id, templateId, Status) => ({ ID: id, TemplateID: templateId, Status, Wordlists: ["a.txt"] });

// A fake instance holding `templates`, `runs` (by template) and `wordlists`.
function fakeApi(data) {
  return {
    GetArmoryTemplates: async () => data.templates,
    GetArmoryRuns: async (templateId) => data.runs[templateId] ?? [],
    GetArmoryWordlists: async () => data.wordlists,
    GetActiveArmoryRunIDs: async () =>
      Object.values(data.runs)
        .flat()
        .filter((r) => r.Status === "in_progress")
        .map((r) => r.ID),
  };
}

async function loadedStore() {
  const data = { templates: [template(T1), template(T2)], runs: { [T1]: [run("r1", T1, "draft")] }, wordlists: [] };
  const store = createArmoryStore(fakeApi(data));
  await store.populate();
  await store.loadRuns(T1);
  return { store, data };
}

test("a run's updates move it from draft to in progress to finished, and it is active only meanwhile", async () => {
  const { store } = await loadedStore();
  store.onRun(run("r1", T1, "in_progress"));
  assert.equal(get(store).runsByTemplate[T1][0].Status, "in_progress");
  assert.deepEqual(get(store).activeRunIds, ["r1"]);
  store.onRun(run("r1", T1, "complete"));
  assert.equal(get(store).runsByTemplate[T1][0].Status, "complete");
  assert.deepEqual(get(store).activeRunIds, []);
});

test("a run another client creates joins its template's runs, and a deleted run leaves them and the selection", async () => {
  const { store } = await loadedStore();
  store.onRun(run("r2", T1, "draft"));
  assert.deepEqual(get(store).runsByTemplate[T1].map((r) => r.ID), ["r1", "r2"]);
  store.selectRun(T1, "r2");
  store.onRunDeleted({ ID: "r2" });
  assert.deepEqual(get(store).runsByTemplate[T1].map((r) => r.ID), ["r1"]);
  assert.equal(get(store).selectedRunByTemplate[T1], null);
});

test("templates another client creates, renames or deletes show in the list", async () => {
  const { store } = await loadedStore();
  store.onTemplate(template("t0", "First"));
  store.onTemplate(template(T2, "Renamed"));
  assert.deepEqual(get(store).templates.map((t) => t.Name), ["First", "t1", "Renamed"]);
  store.selectTemplate(get(store).templates[1]);
  store.onTemplateDeleted({ ID: T1 });
  assert.deepEqual(get(store).templates.map((t) => t.ID), ["t0", T2]);
  assert.equal(get(store).selectedTemplateId, null);
  assert.equal(get(store).runsByTemplate[T1], undefined);
});

test("a wordlist added or removed on the instance replaces the list", async () => {
  const { store } = await loadedStore();
  store.onWordlists([{ Name: "b.txt", Size: 3 }]);
  assert.deepEqual(get(store).wordlists, [{ Name: "b.txt", Size: 3 }]);
});

test("a reload reads the instance again but keeps the open template, its unsaved draft and run settings", async () => {
  const { store, data } = await loadedStore();
  store.selectTemplate(get(store).templates[0]);
  store.updateTemplateDraft(T1, { name: "t1", description: "", rawTemplate: "GET /edited" });
  store.updateRunSettings(T1, { attackType: "maelstrom", useHTTPS: false, selectedWordlists: ["a.txt"], maxConcurrent: 2 });
  store.selectRun(T1, "r1");
  // Meanwhile the run finished and a wordlist arrived.
  data.runs[T1] = [run("r1", T1, "cancelled")];
  data.wordlists = [{ Name: "a.txt", Size: 1 }];
  await store.reload();
  const state = get(store);
  assert.equal(state.selectedTemplateId, T1);
  assert.equal(state.templateDraft.rawTemplate, "GET /edited");
  assert.equal(state.runSettingsByTemplate[T1].attackType, "maelstrom");
  assert.equal(state.selectedRunByTemplate[T1], "r1");
  assert.equal(state.runsByTemplate[T1][0].Status, "cancelled");
  assert.deepEqual(state.wordlists, [{ Name: "a.txt", Size: 1 }]);
});

test("a reload drops the open template when it is gone from the instance", async () => {
  const { store, data } = await loadedStore();
  store.selectTemplate(get(store).templates[0]);
  data.templates = [template(T2)];
  await store.reload();
  assert.equal(get(store).selectedTemplateId, null);
  assert.equal(get(store).templateDraft, null);
  assert.equal(get(store).runsByTemplate[T1], undefined);
});
