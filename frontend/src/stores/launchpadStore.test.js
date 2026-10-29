import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  createLaunchpadStore,
  dirtyLaunchpadIds,
  isDraftDirty,
  launchOf,
  newestEntryOf,
  pendingLaunchOf,
} from "./createLaunchpadStore.js";
import { entrySearchQuery } from "../lib/launchpad/entrySearch.js";

// An in-memory backend: launchpads, their entries, and raw details by id.
function fakeApi({ launchpads = [], entries = {}, raws = {} } = {}) {
  const calls = [];
  let nextId = 1;
  const api = {
    calls,
    getLaunchpads: async () => launchpads.map((launchpad) => ({ ...launchpad })),
    getEntries: async (id) => (entries[id] || []).map((entry) => ({ ...entry })),
    getRawDetails: async (id) =>
      id in raws ? { Request: { ID: id, Raw: raws[id] }, Response: null } : null,
    createLaunchpad: async (name, description) => {
      const id = `new-${nextId++}`;
      calls.push(["createLaunchpad", name, description]);
      launchpads.push({ ID: id, Name: name, Description: description });
      return id;
    },
    updateLaunchpad: async (id, name, description) => {
      calls.push(["updateLaunchpad", id, name, description]);
    },
    deleteLaunchpad: async (id) => {
      calls.push(["deleteLaunchpad", id]);
      launchpads = launchpads.filter((launchpad) => launchpad.ID !== id);
    },
    // Launch ids are the entries' UUIDs; tests pick them with nextLaunchIds.
    nextLaunchIds: [],
    pending: [],
    launch: async (raw, id, useHttps) => {
      calls.push(["launch", raw, id, useHttps]);
      return api.nextLaunchIds.shift();
    },
    cancelLaunch: async (id) => {
      calls.push(["cancelLaunch", id]);
      const launch = api.pending.find((item) => item.ID === id);
      return { ...launch, ID: id, Status: "cancelled", Reason: "" };
    },
    getLaunch: async (id) => api.pending.find((item) => item.ID === id) ?? null,
    pendingLaunches: async () => api.pending.map((item) => ({ ...item })),
  };
  return api;
}

const entry = (id) => ({ ID: id, Method: "GET", Path: `/${id}` });

function twoLaunchpads() {
  return fakeApi({
    launchpads: [
      { ID: "lp1", Name: "Login", Description: "auth flow" },
      { ID: "lp2", Name: "Search", Description: "" },
    ],
    entries: { lp1: [entry("a"), entry("b")], lp2: [entry("c")] },
    raws: {
      a: "GET /a HTTP/1.1\r\nHost: x\r\n\r\n",
      b: "GET /b HTTP/1.1\r\nHost: x\r\n\r\n",
      c: "GET /c HTTP/1.1\r\nHost: x\r\n\r\n",
    },
  });
}

test("populate selects the first launchpad and seeds its draft from its last entry", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  const state = get(store);
  assert.deepEqual(
    state.launchpads.map((launchpad) => launchpad.ID),
    ["lp1", "lp2"],
  );
  assert.equal(state.selectedLaunchpadId, "lp1");
  assert.equal(state.selectedEntryByLaunchpad.lp1, "b");
  assert.deepEqual(state.draftsByLaunchpad.lp1, {
    raw: "GET /b HTTP/1.1\r\nHost: x\r\n\r\n",
    seededFrom: "b",
    useHttps: true,
  });
  assert.equal(isDraftDirty(state, "lp1"), false);
});

test("an edit that only changes line endings leaves the draft clean", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.updateDraft("lp1", "GET /b HTTP/1.1\nHost: x\n\n");
  assert.equal(isDraftDirty(get(store), "lp1"), false);
  store.updateDraft("lp1", "GET /b?q=1 HTTP/1.1\nHost: x\n\n");
  assert.equal(isDraftDirty(get(store), "lp1"), true);
});

test("revert restores the draft to the request it was seeded from", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.updateDraft("lp1", "edited");
  store.revertDraft("lp1");
  assert.equal(get(store).draftsByLaunchpad.lp1.raw, "GET /b HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(isDraftDirty(get(store), "lp1"), false);
});

test("selecting another entry over a dirty draft asks for confirmation first", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.updateDraft("lp1", "edited");

  assert.deepEqual(await store.selectEntry("lp1", "a"), { needsConfirm: true });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "b");
  assert.equal(get(store).draftsByLaunchpad.lp1.raw, "edited");

  assert.deepEqual(await store.selectEntry("lp1", "a", { force: true }), {
    needsConfirm: false,
  });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "a");
  assert.equal(get(store).draftsByLaunchpad.lp1.raw, "GET /a HTTP/1.1\r\nHost: x\r\n\r\n");
});

test("selecting an entry over a clean draft reseeds it without asking", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  assert.deepEqual(await store.selectEntry("lp1", "a"), { needsConfirm: false });
  assert.equal(get(store).draftsByLaunchpad.lp1.seededFrom, "a");
});

test("a draft survives switching launchpads and keeps its HTTPS choice", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.updateDraft("lp1", "edited");
  store.setUseHttps("lp1", false);
  await store.selectLaunchpad("lp2");
  assert.equal(get(store).draftsByLaunchpad.lp2.seededFrom, "c");
  await store.selectLaunchpad("lp1");
  assert.deepEqual(get(store).draftsByLaunchpad.lp1, {
    raw: "edited",
    seededFrom: "b",
    useHttps: false,
  });
});

test("an empty launchpad starts from a blank request", async () => {
  const store = createLaunchpadStore(
    fakeApi({ launchpads: [{ ID: "lp1", Name: "Empty", Description: "" }] }),
  );
  await store.populate();
  const state = get(store);
  assert.deepEqual(state.draftsByLaunchpad.lp1, {
    raw: "GET / HTTP/1.1\nHost: \n\n",
    seededFrom: null,
    useHttps: true,
  });
  assert.equal(isDraftDirty(state, "lp1"), false);
});

test("populating again keeps drafts and the selection, and drops deleted launchpads", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectLaunchpad("lp2");
  store.updateDraft("lp2", "edited");
  await api.deleteLaunchpad("lp1");
  await store.populate();
  const state = get(store);
  assert.equal(state.selectedLaunchpadId, "lp2");
  assert.equal(state.draftsByLaunchpad.lp2.raw, "edited");
  assert.equal(state.draftsByLaunchpad.lp1, undefined);
  assert.equal(state.entriesByLaunchpad.lp1, undefined);
});

test("a populate that resolves after clear does not leak into the new project", async () => {
  const api = twoLaunchpads();
  let release;
  const getLaunchpads = api.getLaunchpads;
  api.getLaunchpads = () =>
    new Promise((resolve) => (release = () => resolve(getLaunchpads())));
  const store = createLaunchpadStore(api);
  const pending = store.populate();
  store.clear();
  release();
  await pending;
  assert.deepEqual(get(store).launchpads, []);
  assert.equal(get(store).selectedLaunchpadId, null);
});

// A launched request as the "request" event carries it. Its metadata names
// no launchpad: the store places it by its launch.
const launched = (id, raw) => ({
  ID: id,
  Scheme: "https",
  Method: "GET",
  Host: "x",
  Path: `/${id}`,
  Raw: raw,
  Metadata: {},
  RequestedAt: "2026-10-13T10:00:00Z",
});

// A launch as Marasi reports it in launch events and launch bindings.
const launchState = (id, launchpadId, Status, Reason = "") => ({
  ID: id,
  LaunchpadID: launchpadId,
  Status,
  Reason,
});

// A launch started elsewhere (another window, Marasi's service) whose
// request then arrives.
function arrive(store, id, launchpadId, raw) {
  store.onLaunchStarted(launchState(id, launchpadId, "pending"));
  store.onRequest(launched(id, raw));
}

test("launch sends the draft, stays pending under its launch id, and the arriving entry is selected", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  store.updateDraft("lp1", "GET /b?q=1 HTTP/1.1\nHost: x\n\n");
  store.setUseHttps("lp1", false);
  assert.equal(await store.launch("lp1"), "d");
  assert.deepEqual(api.calls.at(-1), [
    "launch",
    "GET /b?q=1 HTTP/1.1\nHost: x\n\n",
    "lp1",
    false,
  ]);
  assert.equal(pendingLaunchOf(get(store), "lp1")?.ID, "d");

  // Marasi echoes the request as sent, with its own line endings.
  store.onRequest(launched("d", "GET /b?q=1 HTTP/1.1\r\nHost: x\r\n\r\n"));
  let state = get(store);
  assert.deepEqual(
    state.entriesByLaunchpad.lp1.map((item) => item.ID),
    ["a", "b", "d"],
  );
  assert.equal(state.selectedEntryByLaunchpad.lp1, "d");
  assert.equal(state.draftsByLaunchpad.lp1.seededFrom, "d");
  assert.equal(state.draftsByLaunchpad.lp1.useHttps, false);
  assert.equal(isDraftDirty(state, "lp1"), false);
  // The entry arrived, but the launch is pending until Marasi says it ended.
  assert.equal(launchOf(state, "d")?.Status, "pending");

  store.onLaunchFinished(launchState("d", "lp1", "completed"));
  state = get(store);
  assert.equal(pendingLaunchOf(state, "lp1"), null);
  assert.equal(launchOf(state, "d")?.Status, "completed");
});

test("an entry that arrives before the launch binding returns is still selected", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.launch = async () => {
    store.onLaunchStarted(launchState("d", "lp1", "pending"));
    store.onRequest(launched("d", "GET /b HTTP/1.1\r\nHost: x\r\n\r\n"));
    return "d";
  };
  await store.launch("lp1");
  const state = get(store);
  assert.equal(state.selectedEntryByLaunchpad.lp1, "d");
  assert.equal(pendingLaunchOf(state, "lp1")?.ID, "d");
});

test("edits typed after Launch survive the arrival as a dirty draft", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  store.updateDraft("lp1", "first");
  await store.launch("lp1");
  store.updateDraft("lp1", "second");
  store.onRequest(launched("d", "first"));
  const state = get(store);
  assert.equal(state.selectedEntryByLaunchpad.lp1, "d");
  assert.equal(state.draftsByLaunchpad.lp1.raw, "second");
  assert.equal(isDraftDirty(state, "lp1"), true);
});

test("an arrival for a launchpad that is not open counts as unseen until it is opened", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectLaunchpad("lp2");
  await store.launch("lp2");
  await store.selectLaunchpad("lp1");
  store.onRequest(launched("d", "GET /c HTTP/1.1\r\nHost: x\r\n\r\n"));
  arrive(store, "e", "lp2", "GET /c HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(get(store).unseenByLaunchpad.lp2, 2);
  assert.equal(get(store).selectedLaunchpadId, "lp1");
  await store.selectLaunchpad("lp2");
  assert.equal(get(store).unseenByLaunchpad.lp2, 0);
  assert.equal(get(store).selectedEntryByLaunchpad.lp2, "d");
});

test("traffic without a known launch is ignored, whatever its metadata says", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  const before = get(store);
  store.onRequest(launched("p", "x"));
  store.onRequest({ ...launched("q", "x"), Metadata: { launchpad_id: "lp1" } });
  store.onResponse({ ID: "p", StatusCode: 200 });
  assert.equal(get(store), before);
});

test("a launch into an unknown launchpad is ignored", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.onLaunchStarted(launchState("q", "elsewhere", "pending"));
  const before = get(store);
  store.onRequest(launched("q", "x"));
  store.onResponse({ ID: "q", StatusCode: 200 });
  assert.equal(get(store), before);
});

test("a launched request lands in its launch's launchpad, not the one its stale metadata names", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  await store.loadEntries("lp2");
  store.onLaunchStarted(launchState("d", "lp2", "pending"));
  store.onRequest({ ...launched("d", "GET /d HTTP/1.1\r\n\r\n"), Metadata: { launchpad_id: "lp1" } });
  store.onResponse({ ID: "d", StatusCode: 201, Status: "201 Created", Length: "3" });
  const state = get(store);
  assert.deepEqual(state.entriesByLaunchpad.lp1.map((item) => item.ID), ["a", "b"]);
  assert.deepEqual(state.entriesByLaunchpad.lp2.map((item) => [item.ID, item.StatusCode]), [["c", undefined], ["d", 201]]);
  assert.equal(state.unseenByLaunchpad.lp2, 1);
});

test("the response fills in the arrived entry's status and length", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  store.onRequest(launched("d", "GET /b HTTP/1.1\r\nHost: x\r\n\r\n"));
  store.onResponse({
    ID: "d",
    Status: "201 Created",
    StatusCode: 201,
    ContentType: "text/plain",
    Length: "12",
    Raw: "HTTP/1.1 201 Created\r\n\r\n",
    RespondedAt: "2026-10-13T10:00:01Z",
  });
  const state = get(store);
  const arrived = state.entriesByLaunchpad.lp1.at(-1);
  assert.equal(arrived.StatusCode, 201);
  assert.equal(arrived.Length, "12");
  assert.equal(state.detailsById.d.Response.Raw, "HTTP/1.1 201 Created\r\n\r\n");
});

test("a failed launch is not left pending", async () => {
  const api = twoLaunchpads();
  api.launch = async () => {
    throw new Error("listener offline");
  };
  const store = createLaunchpadStore(api);
  await store.populate();
  await assert.rejects(store.launch("lp1"), /listener offline/);
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
});

test("cancel ends the open launchpad's pending launch as cancelled", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  api.pending.push(launchState("d", "lp1", "pending"));
  store.onRequest(launched("d", "GET /b HTTP/1.1\r\nHost: x\r\n\r\n"));

  await store.cancelLaunch("lp1");
  assert.deepEqual(api.calls.at(-1), ["cancelLaunch", "d"]);
  let state = get(store);
  assert.equal(pendingLaunchOf(state, "lp1"), null);
  assert.equal(launchOf(state, "d")?.Status, "cancelled");

  store.onLaunchFinished(launchState("d", "lp1", "cancelled"));
  state = get(store);
  assert.equal(launchOf(state, "d")?.Status, "cancelled");
});

test("a cancel that loses the race to the response takes the launch's final state quietly", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  api.cancelLaunch = async (id) => launchState(id, "lp1", "completed");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  await store.cancelLaunch("lp1");
  assert.equal(launchOf(get(store), "d")?.Status, "completed");
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
});

test("cancel does nothing when the launchpad has no pending launch", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.cancelLaunch("lp1");
  assert.equal(api.calls.length, 0);
});

test("a failed launch keeps its reason on the entry", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  store.onRequest(launched("d", "GET /b HTTP/1.1\r\nHost: x\r\n\r\n"));
  store.onLaunchFinished(launchState("d", "lp1", "failed", "upstream_error"));
  assert.deepEqual(launchOf(get(store), "d"), { Status: "failed", Reason: "upstream_error" });
});

test("a launch that ends before its entry arrived loads the entry and selects it", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  // Marasi stores the cancelled request without a request event.
  api.getEntries = async () => [entry("a"), entry("b"), entry("d")];
  await store.onLaunchFinished(launchState("d", "lp1", "cancelled"));
  const state = get(store);
  assert.deepEqual(state.entriesByLaunchpad.lp1.map((item) => item.ID), ["a", "b", "d"]);
  assert.equal(state.selectedEntryByLaunchpad.lp1, "d");
  assert.equal(launchOf(state, "d")?.Status, "cancelled");
});

test("populate picks up launches still pending, so a page opened mid-launch shows them", async () => {
  const api = twoLaunchpads();
  api.pending.push(launchState("d", "lp2", "pending"));
  const store = createLaunchpadStore(api);
  await store.populate();
  assert.equal(pendingLaunchOf(get(store), "lp2")?.ID, "d");
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
});

test("populate settles a launch the store thought pending but Marasi has finished", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  api.getLaunch = async (id) => launchState(id, "lp1", "failed", "interrupted");
  await store.populate();
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
  assert.equal(launchOf(get(store), "d")?.Status, "failed");
});

test("loaded entries carry how their launch ended", async () => {
  const api = twoLaunchpads();
  api.getEntries = async () => [
    entry("a"),
    { ...entry("b"), Metadata: { launch: { status: "failed", reason: "network_error" } } },
  ];
  const store = createLaunchpadStore(api);
  await store.populate();
  const state = get(store);
  assert.equal(launchOf(state, "a"), null);
  assert.deepEqual(launchOf(state, "b"), { Status: "failed", Reason: "network_error" });
});

test("clearing the store for another project forgets its launches", async () => {
  const api = twoLaunchpads();
  api.nextLaunchIds.push("d");
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.launch("lp1");
  store.clear();
  assert.equal(pendingLaunchOf(get(store), "lp1"), null);
  assert.deepEqual(get(store).launchesById, {});
});

function threeEntries() {
  return fakeApi({
    launchpads: [
      { ID: "lp1", Name: "Login", Description: "" },
      { ID: "lp2", Name: "Search", Description: "" },
    ],
    entries: { lp1: [entry("a"), entry("b"), entry("c")], lp2: [entry("z")] },
    raws: { a: "A", b: "B", c: "C", z: "Z" },
  });
}

test("compare starts from the current entry as A and the next pick sets B", async () => {
  const store = createLaunchpadStore(threeEntries());
  await store.populate();
  await store.startCompare("c");
  assert.deepEqual(get(store).compare, {
    launchpadId: "lp1",
    leftId: "c",
    rightId: null,
    picking: "right",
  });
  await store.setCompareSide("right", "a");
  const state = get(store);
  assert.deepEqual(state.compare, {
    launchpadId: "lp1",
    leftId: "c",
    rightId: "a",
    picking: null,
  });
  assert.equal(state.detailsById.a.Request.Raw, "A");
  assert.equal(state.detailsById.c.Request.Raw, "C");
});

test("a compare chip re-picks its side and swap exchanges A and B", async () => {
  const store = createLaunchpadStore(threeEntries());
  await store.populate();
  await store.startCompare("c");
  await store.setCompareSide("right", "a");
  store.pickCompareSide("left");
  assert.equal(get(store).compare.picking, "left");
  await store.setCompareSide("left", "b");
  assert.deepEqual(
    [get(store).compare.leftId, get(store).compare.rightId],
    ["b", "a"],
  );
  store.swapCompare();
  assert.deepEqual(
    [get(store).compare.leftId, get(store).compare.rightId],
    ["a", "b"],
  );
});

test("selecting an entry in another launchpad ends the comparison", async () => {
  const store = createLaunchpadStore(threeEntries());
  await store.populate();
  await store.startCompare("c");
  await store.selectEntry("lp2", "z");
  assert.equal(get(store).selectedLaunchpadId, "lp2");
  assert.equal(get(store).compare, null);
});

test("a side picked after compare closed does not reopen it", async () => {
  const store = createLaunchpadStore(threeEntries());
  await store.populate();
  await store.startCompare("c");
  const picked = store.setCompareSide("right", "a");
  store.closeCompare();
  await picked;
  assert.equal(get(store).compare, null);
});

test("closing compare or switching launchpads ends the comparison", async () => {
  const store = createLaunchpadStore(threeEntries());
  await store.populate();
  await store.startCompare("c");
  store.closeCompare();
  assert.equal(get(store).compare, null);
  await store.startCompare("c");
  await store.selectLaunchpad("lp2");
  assert.equal(get(store).compare, null);
});

test("a created launchpad opens empty with a blank draft", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  const id = await store.createLaunchpad({ name: "Scratch", description: "notes" });
  assert.deepEqual(api.calls.at(-1), ["createLaunchpad", "Scratch", "notes"]);
  const state = get(store);
  assert.equal(state.selectedLaunchpadId, id);
  assert.deepEqual(state.launchpads.at(-1), {
    ID: id,
    Name: "Scratch",
    Description: "notes",
    EntryCount: 0,
    LastStatusCode: null,
  });
  assert.deepEqual(state.entriesByLaunchpad[id], []);
  assert.equal(state.draftsByLaunchpad[id].seededFrom, null);
});

test("renaming a launchpad saves its name and description", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.updateLaunchpad("lp2", { name: "Search v2", description: "q param" });
  assert.deepEqual(api.calls.at(-1), ["updateLaunchpad", "lp2", "Search v2", "q param"]);
  assert.deepEqual(get(store).launchpads[1], {
    ID: "lp2",
    Name: "Search v2",
    Description: "q param",
  });
});

test("deleting the open launchpad drops its draft and opens its neighbour", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.updateDraft("lp1", "edited");
  await store.deleteLaunchpad("lp1");
  assert.deepEqual(api.calls.at(-1), ["deleteLaunchpad", "lp1"]);
  const state = get(store);
  assert.deepEqual(state.launchpads.map((launchpad) => launchpad.ID), ["lp2"]);
  assert.equal(state.draftsByLaunchpad.lp1, undefined);
  assert.equal(state.selectedLaunchpadId, "lp2");
  assert.equal(state.selectedEntryByLaunchpad.lp2, "c");
});

test("deleting a launchpad that isn't open leaves the open one, its draft and the Entry selection", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectEntry("lp1", "a");
  store.updateDraft("lp1", "edited");
  await store.loadEntries("lp2");
  await store.deleteLaunchpad("lp2");
  assert.deepEqual(api.calls.at(-1), ["deleteLaunchpad", "lp2"]);
  const state = get(store);
  assert.deepEqual(state.launchpads.map((launchpad) => launchpad.ID), ["lp1"]);
  assert.equal(state.entriesByLaunchpad.lp2, undefined);
  assert.equal(state.selectedLaunchpadId, "lp1");
  assert.equal(state.draftsByLaunchpad.lp1.raw, "edited");
  assert.deepEqual(state.entrySelection, { launchpadId: "lp1", ids: ["a"], anchor: "a" });
});

test("a delete Marasi refuses for a launch still pending keeps the launchpad and learns the launch", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.updateDraft("lp1", "edited");
  // Launched elsewhere (another window); this store has not heard of it.
  api.pending.push({ ID: "d", LaunchpadID: "lp1", Status: "pending" });
  api.deleteLaunchpad = async (id) => {
    throw new Error(`deleting launchpad: launch_pending (d): a launch from ${id} is pending`);
  };
  await assert.rejects(store.deleteLaunchpad("lp1"), /launch_pending/);
  const state = get(store);
  assert.deepEqual(state.launchpads.map((launchpad) => launchpad.ID), ["lp1", "lp2"]);
  assert.equal(state.draftsByLaunchpad.lp1.raw, "edited");
  assert.equal(pendingLaunchOf(state, "lp1")?.ID, "d", "its Delete now shows it launching");
});

test("dirty launchpads are listed for the close and quit prompts", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  await store.selectLaunchpad("lp2");
  assert.deepEqual(dirtyLaunchpadIds(get(store)), []);
  store.updateDraft("lp2", "edited");
  assert.deepEqual(dirtyLaunchpadIds(get(store)), ["lp2"]);
});

test("re-selecting the entry a dirty draft came from keeps the draft", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  store.updateDraft("lp1", "edited");
  assert.deepEqual(await store.selectEntry("lp1", "b"), { needsConfirm: false });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "b");
  assert.equal(get(store).draftsByLaunchpad.lp1.raw, "edited");
});

test("selecting an entry in another launchpad clears its unseen count", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  await store.loadEntries("lp2");
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.equal(get(store).unseenByLaunchpad.lp2, 1);
  await store.selectEntry("lp2", "d");
  assert.equal(get(store).selectedLaunchpadId, "lp2");
  assert.equal(get(store).unseenByLaunchpad.lp2, 0);
});

// Jump to Launchpad, from the Ledger's toast, opens /launchpad?id=<id>.

// Like the Ledger's Send to Launchpad: a new launchpad holding one request.
async function sendFromLedger(api, entries, entryId) {
  const id = await api.createLaunchpad(`Request ${entryId}`, "");
  entries[id] = [entry(entryId)];
  return id;
}

test("jumpTo opens a launchpad created since the last visit on its newest entry", async () => {
  const entries = { lp1: [entry("a"), entry("b")], lp2: [entry("c")] };
  const api = fakeApi({ launchpads: [{ ID: "lp1", Name: "Login" }, { ID: "lp2", Name: "Search" }], entries });
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectLaunchpad("lp2");
  const id = await sendFromLedger(api, entries, "r7");

  const result = await store.jumpTo(id);

  const state = get(store);
  assert.deepEqual(result, { found: true, entryId: "r7", needsConfirm: false });
  assert.equal(state.selectedLaunchpadId, id);
  assert.equal(state.selectedEntryByLaunchpad[id], "r7");
  assert.equal(state.launchpads.at(-1).ID, id);
});

test("jumpTo on a fresh visit opens only the target, not the previous selection", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  assert.deepEqual(await store.jumpTo("lp2"), { found: true, entryId: "c", needsConfirm: false });
  const state = get(store);
  assert.equal(state.selectedLaunchpadId, "lp2");
  assert.equal(state.draftsByLaunchpad.lp1, undefined);
});

test("jumpTo selects an entry linked after the launchpad's entries loaded", async () => {
  const entries = { lp1: [entry("a")], lp2: [entry("c")] };
  const api = fakeApi({ launchpads: [{ ID: "lp1", Name: "Login" }, { ID: "lp2", Name: "Search" }], entries });
  const store = createLaunchpadStore(api);
  await store.populate();
  await store.selectLaunchpad("lp2");
  entries.lp1 = [entry("a"), entry("z")];
  assert.deepEqual(await store.jumpTo("lp1"), { found: true, entryId: "z", needsConfirm: false });
  assert.equal(get(store).selectedEntryByLaunchpad.lp1, "z");
});

test("jumpTo an unknown launchpad reports it missing and keeps the selection", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  await store.selectLaunchpad("lp2");
  assert.deepEqual(await store.jumpTo("gone"), { found: false, entryId: null, needsConfirm: false });
  assert.equal(get(store).selectedLaunchpadId, "lp2");
});

test("jumpTo asks before replacing a dirty draft with the newest entry", async () => {
  const store = createLaunchpadStore(twoLaunchpads());
  await store.populate();
  await store.selectEntry("lp1", "a");
  store.updateDraft("lp1", "edited");
  await store.selectLaunchpad("lp2");
  assert.deepEqual(await store.jumpTo("lp1"), { found: true, entryId: "b", needsConfirm: true });
  const state = get(store);
  assert.equal(state.selectedLaunchpadId, "lp1");
  assert.equal(state.draftsByLaunchpad.lp1.raw, "edited");
});

test("jumpTo an empty launchpad opens it with no entry to select", async () => {
  const api = twoLaunchpads();
  const store = createLaunchpadStore(api);
  await store.populate();
  const id = await api.createLaunchpad("Empty", "");
  assert.deepEqual(await store.jumpTo(id), { found: true, entryId: null, needsConfirm: false });
  assert.equal(get(store).selectedLaunchpadId, id);
});

// Summaries: Marasi's launchpad list carries EntryCount and LastStatusCode.

function summarised() {
  return fakeApi({
    launchpads: [
      { ID: "lp1", Name: "Login", EntryCount: 2, LastStatusCode: 200 },
      { ID: "lp2", Name: "Search", EntryCount: 1, LastStatusCode: 404 },
    ],
    entries: {
      lp1: [entry("a"), entry("b")],
      lp2: [{ ...entry("c"), StatusCode: 404 }],
    },
    raws: { a: "GET /a HTTP/1.1\r\n\r\n", b: "GET /b HTTP/1.1\r\n\r\n" },
  });
}
const summaryOf = (store, id) => {
  const { EntryCount, LastStatusCode } = get(store).launchpads.find((l) => l.ID === id);
  return { EntryCount, LastStatusCode };
};

test("opening the page loads only the open launchpad's entries", async () => {
  const api = summarised();
  const calls = [];
  const getEntries = api.getEntries;
  api.getEntries = (id) => (calls.push(id), getEntries(id));
  const store = createLaunchpadStore(api);
  await store.populate();
  assert.deepEqual(calls, ["lp1"]);
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 1, LastStatusCode: 404 });
});

test("a launch arriving in an unexpanded launchpad updates its count and last status live", async () => {
  const store = createLaunchpadStore(summarised());
  await store.populate();
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\n\r\n");
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 2, LastStatusCode: null });
  store.onResponse({ ID: "d", StatusCode: 201 });
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 2, LastStatusCode: 201 });
});

test("a response to an older entry leaves the last status to the newest", async () => {
  const store = createLaunchpadStore(summarised());
  await store.populate();
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\n\r\n");
  arrive(store, "e", "lp2", "GET /e HTTP/1.1\r\n\r\n");
  store.onResponse({ ID: "d", StatusCode: 201 });
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 3, LastStatusCode: null });
  store.onResponse({ ID: "e", StatusCode: 500 });
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 3, LastStatusCode: 500 });
});

test("a launched entry keeps its pair number and is the newest by capture", async () => {
  const api = summarised();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.getEntries = async () => [{ ...entry("c"), Number: 7, StatusCode: 404 }];
  await store.loadEntries("lp2");
  store.onLaunchStarted(launchState("d", "lp2", "pending"));
  store.onRequest({ ...launched("d", "GET /d HTTP/1.1\r\n\r\n"), Number: 8 });
  const arrived = get(store).entriesByLaunchpad.lp2.find((item) => item.ID === "d");
  assert.equal(arrived.Number, 8);
  assert.equal(newestEntryOf(get(store), "lp2")?.ID, "d");
});

test("a repeated request event does not count twice", async () => {
  const store = createLaunchpadStore(summarised());
  await store.populate();
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\n\r\n");
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\n\r\n");
  assert.equal(summaryOf(store, "lp2").EntryCount, 2);
});

test("loading a launchpad's entries refreshes its summary", async () => {
  const api = summarised();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.getEntries = async () => [entry("c"), { ...entry("x"), StatusCode: 302 }];
  await store.loadEntries("lp2");
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 2, LastStatusCode: 302 });
});

test("the summary follows the newest entry by capture, not the last in entry order", async () => {
  const api = summarised();
  const store = createLaunchpadStore(api);
  await store.populate();
  // Entry order: the newest pair (Number 3) was moved to the top.
  api.getEntries = async () => [
    { ...entry("n"), Number: 3, StatusCode: 404 },
    { ...entry("c"), Number: 1, StatusCode: 200 },
    { ...entry("x"), Number: 2, StatusCode: 302 },
  ];
  await store.loadEntries("lp2");
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 3, LastStatusCode: 404 });
  assert.equal(newestEntryOf(get(store), "lp2")?.ID, "n");
});

test("a pending or cancelled newest entry leaves the last status empty", async () => {
  const api = summarised();
  const store = createLaunchpadStore(api);
  await store.populate();
  api.getEntries = async () => [
    { ...entry("c"), Number: 1, StatusCode: 200 },
    { ...entry("n"), Number: 3, StatusCode: 0 },
    { ...entry("x"), Number: 2, StatusCode: 302 },
  ];
  await store.loadEntries("lp2");
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 3, LastStatusCode: null });
  // Marasi stores a cancelled launch's status code as -1.
  api.getEntries = async () => [
    { ...entry("n"), Number: 3, StatusCode: -1, Metadata: { launch: { status: "cancelled" } } },
    { ...entry("c"), Number: 1, StatusCode: 200 },
  ];
  await store.loadEntries("lp2");
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 2, LastStatusCode: null });
  assert.equal(launchOf(get(store), newestEntryOf(get(store), "lp2").ID)?.Status, "cancelled");
});

test("a new launchpad starts with no entries", async () => {
  const store = createLaunchpadStore(summarised());
  await store.populate();
  const id = await store.createLaunchpad({ name: "Fresh" });
  assert.deepEqual(summaryOf(store, id), { EntryCount: 0, LastStatusCode: null });
});

test("a response after a page revisit still updates the last status", async () => {
  const api = summarised();
  const store = createLaunchpadStore(api);
  await store.populate();
  arrive(store, "d", "lp2", "GET /d HTTP/1.1\r\n\r\n");
  // Marasi now reports the in-flight entry as the newest, still launching.
  api.pending.push(launchState("d", "lp2", "pending"));
  api.getLaunchpads = async () => [
    { ID: "lp1", Name: "Login", EntryCount: 2, LastStatusCode: 200 },
    { ID: "lp2", Name: "Search", EntryCount: 2, LastStatusCode: null },
  ];
  await store.populate();
  store.onResponse({ ID: "d", StatusCode: 201 });
  assert.deepEqual(summaryOf(store, "lp2"), { EntryCount: 2, LastStatusCode: 201 });
});

// Entry search: the tree's search box also asks Marasi for matching entries.

// Lets pending promise callbacks run; setImmediate is not mocked.
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A summarised backend whose searchEntries answers are released by the test.
function searchable() {
  const api = summarised();
  api.searches = [];
  api.searchEntries = (query) =>
    new Promise((resolve, reject) => api.searches.push({ query, resolve, reject }));
  return api;
}

function withTimers(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return t.mock.timers;
}

test("typing searches Marasi once, 250 ms after the last keystroke", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("tok");
  timers.tick(100);
  store.setSearch("toke");
  timers.tick(249);
  assert.equal(api.searches.length, 0);
  timers.tick(1);
  assert.deepEqual(
    api.searches.map((s) => s.query),
    [entrySearchQuery("toke").query],
  );
});

test("terms shorter than three characters never query Marasi", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("to");
  timers.tick(1000);
  assert.equal(api.searches.length, 0);
  assert.equal(get(store).entrySearch.matches, null);
});

test("matches are stored by launchpad and their entry lists load", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  assert.equal(get(store).entriesByLaunchpad.lp2, undefined);
  store.setSearch("secret");
  timers.tick(250);
  assert.equal(get(store).entrySearch.status, "loading");
  api.searches[0].resolve({ EntriesByLaunchpad: { lp1: ["a"], lp2: ["c"] }, QueryError: null });
  await settle();
  await settle();
  const state = get(store);
  assert.deepEqual(state.entrySearch, { status: "done", matches: { lp1: ["a"], lp2: ["c"] }, error: null });
  assert.deepEqual(state.entriesByLaunchpad.lp2.map((e) => e.ID), ["c"]);
});

test("a stale response never replaces a newer term's matches", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("first");
  timers.tick(250);
  store.setSearch("second");
  timers.tick(250);
  api.searches[1].resolve({ EntriesByLaunchpad: { lp1: ["b"] }, QueryError: null });
  await settle();
  api.searches[0].resolve({ EntriesByLaunchpad: { lp2: ["c"] }, QueryError: null });
  await settle();
  assert.deepEqual(get(store).entrySearch.matches, { lp1: ["b"] });
});

test("a response arriving after the search was cleared is ignored", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("secret");
  timers.tick(250);
  store.setSearch("");
  api.searches[0].resolve({ EntriesByLaunchpad: { lp2: ["c"] }, QueryError: null });
  await settle();
  assert.deepEqual(get(store).entrySearch, { status: "idle", matches: null, error: null });
});

test("an invalid query is reported as the search error", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("secret");
  timers.tick(250);
  api.searches[0].resolve({ EntriesByLaunchpad: null, QueryError: { Message: "bad term", Position: 4 } });
  await settle();
  assert.deepEqual(get(store).entrySearch, { status: "error", matches: null, error: "bad term" });
});

test("a failing search binding is reported, not thrown", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("secret");
  timers.tick(250);
  api.searches[0].reject("database is locked");
  await settle();
  assert.equal(get(store).entrySearch.status, "error");
  assert.match(get(store).entrySearch.error, /database is locked/);
});

test("text too long to search is an error without a query", async (t) => {
  const timers = withTimers(t);
  const api = searchable();
  const store = createLaunchpadStore(api);
  await store.populate();
  store.setSearch("x".repeat(5000));
  timers.tick(1000);
  assert.equal(api.searches.length, 0);
  assert.equal(get(store).entrySearch.status, "error");
});
