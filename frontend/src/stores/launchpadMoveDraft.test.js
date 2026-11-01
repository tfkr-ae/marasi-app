// The Launchpad draft follows the entry it was seeded from when a Move takes
// that entry to another launchpad, and the open launchpad follows the draft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { BLANK_REQUEST, createLaunchpadStore } from "./createLaunchpadStore.js";

const entry = (id) => ({ ID: id, Method: "GET", Path: `/${id}`, StatusCode: 200 });
const rawOf = (id) => `GET /${id} HTTP/1.1\n\n`;

// lp1 holds a to e, lp2 holds x, lp3 holds y. moveEntries moves like Marasi.
function fakeMarasi() {
  const lists = { lp1: ["a", "b", "c", "d", "e"], lp2: ["x"], lp3: ["y"] };
  const fake = {
    calls: [],
    lists,
    api: {
      getLaunchpads: async () =>
        ["lp1", "lp2", "lp3"].map((id) => ({ ID: id, Name: id, Description: "", EntryCount: lists[id].length })),
      getEntries: async (id) => (lists[id] || []).map(entry),
      getRawDetails: async (id) => ({ Request: { ID: id, Raw: rawOf(id) }, Response: null }),
      pendingLaunches: async () => [],
      // Every launch is "L", listed last in its launchpad at once.
      launch: async (raw, launchpadId) => {
        lists[launchpadId].push("L");
        return "L";
      },
      moveEntries: async (sourceId, targetId, ids, before) => {
        fake.calls.push([sourceId, targetId, ids, before]);
        lists[sourceId] = lists[sourceId].filter((id) => !ids.includes(id));
        const rest = lists[targetId];
        const at = before ? rest.indexOf(before) : rest.length;
        lists[targetId] = [...rest.slice(0, at), ...ids, ...rest.slice(at)];
        return ids;
      },
    },
  };
  return fake;
}

const EDITED_B = "GET /b-edited HTTP/1.1\n\n";

// lp1 is open with its draft seeded from b, edited, and set to plain HTTP.
async function editingB(fake = fakeMarasi()) {
  const store = createLaunchpadStore(fake.api);
  await store.populate();
  await store.selectEntry("lp1", "b");
  store.updateDraft("lp1", EDITED_B);
  store.setUseHttps("lp1", false);
  return { store, fake };
}

const draftOf = (store, id) => get(store).draftsByLaunchpad[id];

test("moving the draft's entry to another launchpad takes the draft with it", async () => {
  const { store } = await editingB();
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(draftOf(store, "lp2"), { raw: EDITED_B, seededFrom: "b", useHttps: false });
});

// The source's draft left with its entry, so the new one starts fresh, over
// the scheme the source used.
test("the source reseeds from its last entry once the draft's entry has moved out", async () => {
  const { store } = await editingB();
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(draftOf(store, "lp1"), { raw: rawOf("e"), seededFrom: "e", useHttps: false });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "e");
});

test("a source whose last entry is still launching reseeds from the request as sent", async () => {
  const { store } = await editingB();
  await store.launch("lp1");
  // Marasi's request event carries no bytes; the stored pair has them.
  await store.onRequest({ ID: "L", Method: "GET", Path: "/L" });
  await store.selectEntry("lp1", "b", { force: true });
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(draftOf(store, "lp1"), { raw: rawOf("L"), seededFrom: "L", useHttps: false });
});

// Marasi has no request to read for a launch whose request event has not
// come yet, so the reseeded draft is the request as launched.
test("a source whose last entry is launching and not yet sent reseeds from the launched request", async () => {
  const fake = fakeMarasi();
  const getRawDetails = fake.api.getRawDetails;
  fake.api.getRawDetails = async (id) => (id === "L" ? null : getRawDetails(id));
  const { store } = await editingB(fake);
  await store.launch("lp1");
  await store.selectEntry("lp1", "b", { force: true });
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(draftOf(store, "lp1"), { raw: EDITED_B, seededFrom: "L", useHttps: false });
});

test("a source left empty gets a blank draft", async () => {
  const { store } = await editingB();
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["a", "b", "c", "d", "e"] });
  assert.deepEqual(draftOf(store, "lp1"), { raw: BLANK_REQUEST, seededFrom: null, useHttps: false });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, undefined);
});

test("a move of several entries that holds the draft's entry takes the draft along", async () => {
  const { store } = await editingB();
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["a", "b", "d"], before: "x" });
  assert.deepEqual(draftOf(store, "lp2"), { raw: EDITED_B, seededFrom: "b", useHttps: false });
  assert.equal(draftOf(store, "lp1").seededFrom, "e");
  assert.equal(get(store).selectedLaunchpadId, "lp2");
});

test("a move without the draft's entry leaves both drafts and the open launchpad", async () => {
  const { store } = await editingB();
  await store.selectLaunchpad("lp2");
  await store.selectLaunchpad("lp1");
  const before = get(store).draftsByLaunchpad;
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["c", "d"] });
  assert.equal(draftOf(store, "lp1"), before.lp1);
  assert.equal(draftOf(store, "lp2"), before.lp2);
  assert.equal(get(store).selectedLaunchpadId, "lp1");
});

test("a reorder within one launchpad leaves its draft", async () => {
  const { store } = await editingB();
  const before = draftOf(store, "lp1");
  await store.moveEntries({ sourceId: "lp1", targetId: "lp1", ids: ["b"] });
  assert.equal(draftOf(store, "lp1"), before);
  assert.equal(get(store).selectedLaunchpadId, "lp1");
});

// lp2's draft is seeded from x and edited; lp1 stays open on b.
async function withDirtyTarget() {
  const { store, fake } = await editingB();
  await store.selectLaunchpad("lp2");
  store.updateDraft("lp2", "GET /x-edited HTTP/1.1\n\n");
  await store.selectLaunchpad("lp1");
  return { store, fake };
}

test("a dirty target draft asks first: Marasi is not called and nothing changes", async () => {
  const { store, fake } = await withDirtyTarget();
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(result, { moved: null, refused: null, needsConfirm: true });
  assert.deepEqual(fake.calls, []);
  assert.equal(draftOf(store, "lp2").raw, "GET /x-edited HTTP/1.1\n\n");
  assert.equal(draftOf(store, "lp1").raw, EDITED_B);
});

test("a confirmed move replaces the dirty target draft", async () => {
  const { store } = await withDirtyTarget();
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] }, { force: true });
  assert.deepEqual(result.moved, ["b"]);
  assert.deepEqual(draftOf(store, "lp2"), { raw: EDITED_B, seededFrom: "b", useHttps: false });
});

test("a dirty target draft does not ask when the draft's entry stays behind", async () => {
  const { store, fake } = await withDirtyTarget();
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["c"] });
  assert.deepEqual(result.moved, ["c"]);
  assert.equal(fake.calls.length, 1);
  assert.equal(draftOf(store, "lp2").raw, "GET /x-edited HTTP/1.1\n\n");
});

test("a clean target draft is replaced without asking", async () => {
  const { store } = await editingB();
  await store.selectLaunchpad("lp2");
  await store.selectLaunchpad("lp1");
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.deepEqual(result.moved, ["b"]);
  assert.equal(draftOf(store, "lp2").seededFrom, "b");
});

test("moving the open launchpad's draft entry opens the target", async () => {
  const { store } = await editingB();
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.equal(get(store).selectedLaunchpadId, "lp2");
});

test("a move out of a launchpad that is not open moves its draft but keeps the open launchpad", async () => {
  const { store } = await editingB();
  await store.selectLaunchpad("lp3");
  await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["b"] });
  assert.equal(get(store).selectedLaunchpadId, "lp3");
  assert.deepEqual(draftOf(store, "lp2"), { raw: EDITED_B, seededFrom: "b", useHttps: false });
  assert.equal(draftOf(store, "lp1").seededFrom, "e");
});
