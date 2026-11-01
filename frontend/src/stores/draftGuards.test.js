import { test } from "node:test";
import assert from "node:assert/strict";
import { reportUnsavedDraftCount } from "./draftGuards.js";
import { get } from "svelte/store";
import { createLaunchpadStore, dirtyLaunchpadIds, isDraftDirty } from "./createLaunchpadStore.js";

function fakeApi() {
  return {
    getLaunchpads: async () => [
      { ID: "a", Name: "A" },
      { ID: "b", Name: "B" },
    ],
    getEntries: async (id) => [{ ID: `${id}-1` }],
    getRawDetails: async (id) => ({ Request: { ID: id, Raw: `GET /${id}` } }),
    pendingLaunches: async () => [],
  };
}

test("the unsaved draft count is reported each time it changes, and only then", async () => {
  const store = createLaunchpadStore(fakeApi());
  const reported = [];
  const stop = reportUnsavedDraftCount(store, (count) => reported.push(count));

  await store.populate();
  store.updateDraft("a", "GET /edited");
  store.updateDraft("a", "GET /edited-again");
  await store.selectLaunchpad("b");
  store.updateDraft("b", "GET /b-edited");
  store.revertDraft("a");
  store.clear();
  stop();
  store.updateDraft("b", "GET /after-stop");

  assert.deepEqual(reported, [0, 1, 2, 1, 0]);
});

// Drafts live in the window, keyed by project (docs/adr/2026-10-31-one-connection-per-window.md).
const draftOf = (store, id) => get(store).draftsByLaunchpad[id];

async function editedIn(project) {
  const store = createLaunchpadStore(fakeApi());
  store.openProject(project);
  await store.populate();
  store.updateDraft("a", "GET /edited");
  return store;
}

test("a switch another client makes keeps the dirty drafts, and they come back when their project opens again", async () => {
  const store = await editedIn("/p/acme.marasi");
  await store.selectLaunchpad("b");

  assert.equal(store.openProject("/p/other.marasi"), 1);
  await store.populate();
  assert.equal(draftOf(store, "a").raw, "GET /a-1");

  assert.equal(store.openProject("/p/acme.marasi"), 0);
  await store.populate();
  assert.equal(draftOf(store, "a").raw, "GET /edited");
  assert.ok(isDraftDirty(get(store), "a"));
  assert.equal(get(store).selectedEntryByLaunchpad.a, "a-1");
});

test("a switch the researcher starts discards the dirty drafts they agreed to lose", async () => {
  const store = await editedIn("/p/acme.marasi");
  assert.equal(store.openProject("/p/other.marasi", { keepDrafts: false }), 0);
  store.openProject("/p/acme.marasi");
  await store.populate();
  assert.equal(draftOf(store, "a").raw, "GET /a-1");
});

test("clean drafts aren't kept, since their entries seed them again", async () => {
  const store = createLaunchpadStore(fakeApi());
  store.openProject("/p/acme.marasi");
  await store.populate();
  assert.equal(store.openProject("/p/other.marasi"), 0);
});

test("a kept draft whose launchpad was deleted meanwhile is dropped", async () => {
  const api = fakeApi();
  const store = createLaunchpadStore(api);
  store.openProject("/p/acme.marasi");
  await store.populate();
  store.updateDraft("a", "GET /edited");
  store.openProject("/p/other.marasi");
  api.getLaunchpads = async () => [{ ID: "b", Name: "B" }];
  store.openProject("/p/acme.marasi");
  await store.populate();
  assert.equal(draftOf(store, "a"), undefined);
  assert.deepEqual(dirtyLaunchpadIds(get(store)), []);
});

test("kept drafts count as unsaved, since quitting loses them too", async () => {
  const store = await editedIn("/p/acme.marasi");
  const reported = [];
  const stop = reportUnsavedDraftCount(store, (count) => reported.push(count));
  store.openProject("/p/other.marasi");
  await store.populate();
  await store.selectLaunchpad("b");
  store.updateDraft("b", "GET /b-edited");
  store.openProject("/p/acme.marasi", { keepDrafts: false });
  await store.populate();
  stop();
  assert.deepEqual(reported, [1, 2, 1]);
});

test("keeping drafts for another client's switch says so, briefly; a switch the researcher agreed to doesn't", async () => {
  const store = await editedIn("/p/acme.marasi");
  const notices = [];
  store.onNotice((notice) => notices.push(notice));
  store.openProject("/p/other.marasi");
  await store.populate();
  await store.selectLaunchpad("b");
  store.updateDraft("b", "GET /b-edited");
  store.openProject("/p/acme.marasi", { keepDrafts: false });
  assert.deepEqual(notices, ["Project switched by another client. 1 unsaved draft kept for acme."]);
});
