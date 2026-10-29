// Remove from launchpad, from the entry context menu. Moves are covered
// with drag and drop (launchpadMove tests): the menu moves through the same
// store method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { BLANK_REQUEST, createLaunchpadStore, pendingEntryIds, pendingLaunchOf } from "./createLaunchpadStore.js";

const entry = (id) => ({ ID: id, Method: "GET", Path: `/${id}` });

// Marasi in memory: lp1 holds a to e, lp2 holds x. Unlinks change the
// lists the way Marasi would.
function fakeApi() {
  const lists = { lp1: ["a", "b", "c", "d", "e"], lp2: ["x"] };
  const api = {
    calls: [],
    pending: [],
    getLaunchpads: async () => [
      { ID: "lp1", Name: "Login", EntryCount: lists.lp1.length },
      { ID: "lp2", Name: "Search", EntryCount: lists.lp2.length },
    ],
    getEntries: async (id) => (lists[id] || []).map(entry),
    getRawDetails: async (id) => ({ Request: { ID: id, Raw: `GET /${id} HTTP/1.1\n\n` }, Response: null }),
    pendingLaunches: async () => api.pending.map((launch) => ({ ...launch })),
    getLaunch: async () => null,
    unlinkEntries: async (launchpadId, ids) => {
      api.calls.push(["unlinkEntries", launchpadId, ids]);
      lists[launchpadId] = lists[launchpadId].filter((id) => !ids.includes(id));
      return ids.length;
    },
    // Links from pairs to findings and test cases: "kind:id" to pair ids.
    links: { "finding:1": ["a"] },
    linkTraffic: async (selection, target) => {
      api.calls.push(["linkTraffic", selection, target]);
      const key = `${target.Kind}:${target.ID}`;
      const linked = api.links[key] ?? [];
      const added = selection.ids.filter((id) => !linked.includes(id));
      api.links[key] = [...linked, ...added];
      return added.length;
    },
    unlinkTraffic: async (selection, target) => {
      api.calls.push(["unlinkTraffic", selection, target]);
      const key = `${target.Kind}:${target.ID}`;
      const linked = api.links[key] ?? [];
      api.links[key] = linked.filter((id) => !selection.ids.includes(id));
      return linked.length - api.links[key].length;
    },
  };
  return api;
}

async function populated(api = fakeApi()) {
  const store = createLaunchpadStore(api);
  await store.populate();
  return store;
}

const order = (store, id) => get(store).entriesByLaunchpad[id].map((item) => item.ID);

test("removing unlinks the entries from the launchpad, reloads it with its count, and clears the selection", async () => {
  const api = fakeApi();
  const store = await populated(api);
  store.selectAllEntries("lp1");
  assert.deepEqual(await store.removeEntries("lp1", ["a", "c"]), { removed: 2, needsConfirm: false });
  assert.deepEqual(api.calls, [["unlinkEntries", "lp1", ["a", "c"]]]);
  assert.deepEqual(order(store, "lp1"), ["b", "d", "e"]);
  assert.equal(get(store).launchpads[0].EntryCount, 3);
  assert.deepEqual(get(store).entrySelection.ids, []);
});

// lp1 is open on e, its last entry, with its draft set to plain HTTP.
async function onLastEntry(api = fakeApi()) {
  const store = await populated(api);
  store.setUseHttps("lp1", false);
  return store;
}

test("removing the draft's entry reseeds the draft from the last entry left, over the same scheme", async () => {
  const store = await onLastEntry();
  await store.removeEntries("lp1", ["e"]);
  const state = get(store);
  assert.deepEqual(state.draftsByLaunchpad.lp1, { raw: "GET /d HTTP/1.1\n\n", seededFrom: "d", useHttps: false });
  assert.equal(state.selectedEntryByLaunchpad.lp1, "d");
});

test("removing every entry leaves a blank draft and no selected entry", async () => {
  const store = await onLastEntry();
  await store.removeEntries("lp1", ["a", "b", "c", "d", "e"]);
  const state = get(store);
  assert.deepEqual(state.draftsByLaunchpad.lp1, { raw: BLANK_REQUEST, seededFrom: null, useHttps: false });
  assert.equal(state.selectedEntryByLaunchpad.lp1, undefined);
});

test("removing the selected entry reseeds even when the draft came from another", async () => {
  const store = await onLastEntry();
  await store.selectEntry("lp1", "b");
  await store.removeEntries("lp1", ["b"]);
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "e");
  assert.equal(get(store).draftsByLaunchpad.lp1.seededFrom, "e");
});

// The house rule: ask only before destroying a dirty draft.
test("removing a dirty draft's entry asks first: Marasi is not called and nothing changes", async () => {
  const api = fakeApi();
  const store = await onLastEntry(api);
  store.updateDraft("lp1", "GET /e-edited HTTP/1.1\n\n");
  store.toggleEntry("lp1", "e");
  assert.deepEqual(await store.removeEntries("lp1", ["e"]), { removed: 0, needsConfirm: true });
  assert.deepEqual(api.calls, []);
  const state = get(store);
  assert.equal(state.draftsByLaunchpad.lp1.raw, "GET /e-edited HTTP/1.1\n\n");
  assert.deepEqual(state.entrySelection.ids, ["e"]);
});

test("a confirmed removal replaces the dirty draft", async () => {
  const store = await onLastEntry();
  store.updateDraft("lp1", "GET /e-edited HTTP/1.1\n\n");
  assert.deepEqual(await store.removeEntries("lp1", ["e"], { force: true }), { removed: 1, needsConfirm: false });
  assert.deepEqual(get(store).draftsByLaunchpad.lp1, { raw: "GET /d HTTP/1.1\n\n", seededFrom: "d", useHttps: false });
});

test("a dirty draft does not ask when its entry stays", async () => {
  const store = await onLastEntry();
  store.updateDraft("lp1", "GET /e-edited HTTP/1.1\n\n");
  assert.deepEqual(await store.removeEntries("lp1", ["a"]), { removed: 1, needsConfirm: false });
  assert.equal(get(store).draftsByLaunchpad.lp1.raw, "GET /e-edited HTTP/1.1\n\n");
});

test("removing other entries leaves the draft and the selected entry", async () => {
  const store = await onLastEntry();
  const draft = get(store).draftsByLaunchpad.lp1;
  await store.removeEntries("lp1", ["a", "c"]);
  assert.equal(get(store).draftsByLaunchpad.lp1, draft);
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "e");
});

test("a removal Marasi refuses for a pending launch reads the pending launches and keeps the selection", async () => {
  const api = fakeApi();
  const store = await populated(api);
  store.toggleEntry("lp1", "b");
  // Launched in another window: this store has not heard of it.
  api.pending.push({ ID: "b", LaunchpadID: "lp1", Status: "pending" });
  api.unlinkEntries = async () => {
    throw new Error("unlinking traffic: launch_pending (b)");
  };
  await assert.rejects(store.removeEntries("lp1", ["b"]), /launch_pending/);
  const state = get(store);
  assert.equal(pendingLaunchOf(state, "lp1")?.ID, "b");
  assert.deepEqual(state.entrySelection.ids, ["b"]);
});

// Marasi refuses to move or remove an entry only while its launch is
// pending from that launchpad (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md); a pair launched from
// another launchpad and linked here too moves freely.
test("an entry is launching from a launchpad only when its pending launch came from there", () => {
  const state = {
    launchesById: {
      a: { ID: "a", LaunchpadID: "lp1", Status: "pending" },
      b: { ID: "b", LaunchpadID: "lp2", Status: "pending" },
      c: { ID: "c", LaunchpadID: "lp1", Status: "completed" },
    },
  };
  assert.deepEqual(pendingEntryIds(state, "lp1", ["a", "b", "c", "d"]), ["a"]);
  assert.deepEqual(pendingEntryIds(state, "lp2", ["a", "b"]), ["b"]);
});

test("linking entries sends their ids to Marasi with the record and returns how many it linked", async () => {
  const api = fakeApi();
  const store = await populated(api);
  assert.equal(await store.linkEntries(["a", "b", "c"], "finding", 1), 2);
  assert.equal(await store.linkEntries(["d"], "test_case", 7), 1);
  assert.deepEqual(api.calls, [
    ["linkTraffic", { ids: ["a", "b", "c"] }, { Kind: "finding", ID: 1 }],
    ["linkTraffic", { ids: ["d"] }, { Kind: "test_case", ID: 7 }],
  ]);
  assert.equal(await store.linkEntries(["a"], "finding", 1), 0);
});

test("unlinking entries sends their ids to Marasi with the record and returns how many it unlinked", async () => {
  const api = fakeApi();
  const store = await populated(api);
  assert.equal(await store.unlinkEntries(["a", "b"], "finding", 1), 1);
  assert.deepEqual(api.calls, [["unlinkTraffic", { ids: ["a", "b"] }, { Kind: "finding", ID: 1 }]]);
  // Linking and unlinking leave the launchpads and their entries alone.
  assert.deepEqual(order(store, "lp1"), ["a", "b", "c", "d", "e"]);
});

test("a failed link goes on to the caller", async () => {
  const api = fakeApi();
  api.linkTraffic = async () => {
    throw new Error("database is locked");
  };
  const store = await populated(api);
  await assert.rejects(store.linkEntries(["a"], "finding", 1), /database is locked/);
});
