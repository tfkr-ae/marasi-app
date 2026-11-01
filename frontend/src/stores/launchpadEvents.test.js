// The Launchpad follows Marasi's launchpad and traffic events, so changes
// made by another client (the CLI, an agent) show up live, and its own
// changes are not applied twice when their event arrives too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLaunchpadStore, launchOf, pendingLaunchOf } from "./createLaunchpadStore.js";

// An in-memory Marasi: launchpads with entry lists, which tests change
// behind the store's back as another client would.
function instance() {
  const state = {
    launchpads: [
      { ID: "lp1", Name: "Login", Description: "auth flow" },
      { ID: "lp2", Name: "Search", Description: "" },
    ],
    entries: { lp1: ["a", "b"], lp2: ["c"] },
  };
  const entryRow = (id) => ({ ID: id, Number: id.charCodeAt(0), StatusCode: 200, Method: "GET", Path: `/${id}` });
  const reads = [];
  const api = {
    state,
    reads,
    getLaunchpads: async () => {
      reads.push("launchpads");
      return state.launchpads.map((launchpad) => ({
        ...launchpad,
        EntryCount: (state.entries[launchpad.ID] ?? []).length,
        LastStatusCode: (state.entries[launchpad.ID] ?? []).length ? 200 : null,
      }));
    },
    getEntries: async (id) => {
      reads.push(id);
      return (state.entries[id] ?? []).map(entryRow);
    },
    getRawDetails: async (id) => ({ Request: { ID: id, Raw: `GET /${id} HTTP/1.1\nHost: x\n\n` }, Response: null }),
    createLaunchpad: async (name, description) => {
      state.launchpads.push({ ID: "lp3", Name: name, Description: description });
      state.entries.lp3 = [];
      return "lp3";
    },
    deleteLaunchpad: async (id) => {
      state.launchpads = state.launchpads.filter((launchpad) => launchpad.ID !== id);
    },
    pendingLaunches: async () => [],
    getLaunch: async () => null,
  };
  return api;
}

const names = (store) => get(store).launchpads.map((launchpad) => launchpad.Name);
const entryIds = (store, id) => get(store).entriesByLaunchpad[id]?.map((entry) => entry.ID);

test("a launchpad another client creates joins the list", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.onLaunchpadCreated({ ID: "lp9", Name: "Agent", Description: "" });
  assert.deepEqual(names(store), ["Login", "Search", "Agent"]);
  assert.equal(get(store).launchpads.at(-1).EntryCount, 0);
  assert.equal(get(store).selectedLaunchpadId, "lp1");
});

test("a launchpad created here whose event arrives first is listed once", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  const create = api.createLaunchpad;
  api.createLaunchpad = async (name, description) => {
    const id = await create(name, description);
    store.onLaunchpadCreated({ ID: id, Name: name, Description: description });
    return id;
  };
  await store.createLaunchpad({ name: "New" });
  assert.deepEqual(names(store), ["Login", "Search", "New"]);
  assert.equal(get(store).selectedLaunchpadId, "lp3");
});

test("a rename by another client renames the launchpad", async () => {
  const store = createLaunchpadStore(instance());
  await store.populate();
  store.onLaunchpadUpdated({ ID: "lp2", Name: "Find", Description: "the box" });
  assert.deepEqual(get(store).launchpads[1].Name, "Find");
  assert.deepEqual(get(store).launchpads[1].Description, "the box");
});

test("a launchpad another client deletes leaves, and the open one gives way to its neighbour", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.state.launchpads.shift();
  await store.onLaunchpadDeleted("lp1");
  const state = get(store);
  assert.deepEqual(names(store), ["Search"]);
  assert.equal(state.entriesByLaunchpad.lp1, undefined);
  assert.equal(state.draftsByLaunchpad.lp1, undefined);
  assert.equal(state.selectedLaunchpadId, "lp2");
});

test("a launchpad deleted here whose event arrives first opens one neighbour", async () => {
  const api = instance();
  api.state.launchpads.push({ ID: "lp3", Name: "Third", Description: "" });
  const store = createLaunchpadStore(api);
  await store.populate("lp2");
  const remove = api.deleteLaunchpad;
  api.deleteLaunchpad = async (id) => {
    await remove(id);
    await store.onLaunchpadDeleted(id);
  };
  await store.deleteLaunchpad("lp2");
  assert.deepEqual(names(store), ["Login", "Third"]);
  assert.equal(get(store).selectedLaunchpadId, "lp3");
});

test("entries another client links, unlinks or moves reload the launchpads whose entries are loaded", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.state.entries.lp1 = ["b", "a", "d"];
  api.state.entries.lp2 = [];
  await store.onEntriesChanged(["lp1", "lp2"]);
  assert.deepEqual(entryIds(store, "lp1"), ["b", "a", "d"]);
  // lp2's entries were never loaded: only its summary changes.
  assert.equal(get(store).entriesByLaunchpad.lp2, undefined);
  assert.equal(get(store).launchpads[1].EntryCount, 0);
  assert.equal(get(store).launchpads[0].EntryCount, 3);
});

test("a bulk change that doesn't name its launchpads rereads every summary and loaded entry list", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.loadEntries("lp2");
  api.state.entries.lp1 = ["a"];
  api.state.entries.lp2 = ["c", "e"];
  api.reads.length = 0;
  await store.onEntriesChanged();
  assert.deepEqual(entryIds(store, "lp1"), ["a"]);
  assert.deepEqual(entryIds(store, "lp2"), ["c", "e"]);
  assert.deepEqual(get(store).launchpads.map((launchpad) => launchpad.EntryCount), [1, 2]);
  assert.deepEqual(api.reads.sort(), ["launchpads", "lp1", "lp2"]);
});

test("a launchpad another client creates in a bulk change's wake is listed by its reread", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.state.launchpads.push({ ID: "lp4", Name: "Late", Description: "" });
  await store.onEntriesChanged();
  assert.deepEqual(names(store), ["Login", "Search", "Late"]);
});

// A launch record as launch.* events carry it, through launchOf.
const launchRecord = (id, launchpadId, status, reason = "") => ({ ID: id, LaunchpadID: launchpadId, Status: status, Reason: reason });
const request = (id) => ({ ID: id, Number: 99, Scheme: "https", Method: "GET", Host: "x", Path: `/${id}`, Metadata: {} });

test("a launch another client starts shows pending, and its pair joins its launchpad as it arrives", async () => {
  const store = createLaunchpadStore(instance());
  await store.populate();
  store.onLaunchStarted(launchRecord("l9", "lp1", "pending"));
  assert.equal(pendingLaunchOf(get(store), "lp1")?.ID, "l9");
  store.onRequest(request("l9"));
  assert.deepEqual(entryIds(store, "lp1"), ["a", "b", "l9"]);
  await store.onLaunchFinished(launchRecord("l9", "lp1", "completed"));
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
  assert.deepEqual(launchOf(get(store), "l9"), { Status: "completed", Reason: "" });
});

test("a launch another client cancels before its request arrives still joins its launchpad", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.onLaunchStarted(launchRecord("l9", "lp1", "pending"));
  // Marasi stores a launch's request as launched when it ends first.
  api.state.entries.lp1.push("l9");
  await store.onLaunchFinished(launchRecord("l9", "lp1", "cancelled"));
  assert.deepEqual(entryIds(store, "lp1"), ["a", "b", "l9"]);
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
});

test("a launch from an unloaded launchpad ending updates that launchpad's summary", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.onLaunchStarted(launchRecord("l9", "lp2", "pending"));
  api.state.entries.lp2.push("l9");
  await store.onLaunchFinished(launchRecord("l9", "lp2", "failed", "interrupted"));
  assert.equal(get(store).launchpads.find((launchpad) => launchpad.ID === "lp2").EntryCount, 2);
});

test("after a delete refused for another client's launch, that launch ending frees the launchpad", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.deleteLaunchpad = async () => {
    throw new Error("DELETE /launchpad/lp1: launch_pending (l9): launch pending");
  };
  api.pendingLaunches = async () => [launchRecord("l9", "lp1", "pending")];
  await assert.rejects(store.deleteLaunchpad("lp1"));
  assert.equal(pendingLaunchOf(get(store), "lp1")?.ID, "l9");
  api.pendingLaunches = async () => [];
  await store.onLaunchFinished(launchRecord("l9", "lp1", "completed"));
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
});

test("a launchpad another client deletes under a dirty draft says the draft is gone", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectLaunchpad("lp2");
  store.updateDraft("lp1", "GET /edited HTTP/1.1\nHost: x\n\n");
  const notices = [];
  store.onNotice((notice) => notices.push(notice));
  await store.onLaunchpadDeleted("lp2");
  await store.onLaunchpadDeleted("lp1");
  assert.deepEqual(notices, ["Another client deleted Login. Its unsaved draft is gone."]);
});

test("a launchpad deleted here says nothing when its event arrives, even before Marasi answers", async () => {
  const api = instance();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.updateDraft("lp1", "GET /edited HTTP/1.1\nHost: x\n\n");
  const notices = [];
  store.onNotice((notice) => notices.push(notice));
  const remove = api.deleteLaunchpad;
  api.deleteLaunchpad = async (id) => {
    await remove(id);
    await store.onLaunchpadDeleted(id);
  };
  await store.deleteLaunchpad("lp1");
  assert.deepEqual(notices, []);
});
