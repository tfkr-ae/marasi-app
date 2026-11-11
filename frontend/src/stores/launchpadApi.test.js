// Launchpad over the service: createLaunchpadApi (over a fake service client)
// maps the control API's routes and shapes to what createLaunchpadStore
// reads, including a cancel that lost the race. The store's own logic has its fake-api
// suites in launchpadStore.test.js and the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createLaunchpadApi, launchpadsChangedBy, toLaunch as toLaunchEvent, toLaunchpadSummary } from "./launchpadApi.js";
import { toRequestEvent, toResponseEvent } from "./trafficApi.js";
import { createLaunchpadStore, isDraftDirty } from "./createLaunchpadStore.js";
import { serviceError } from "../lib/service/errors.js";
import { entrySearchQuery } from "../lib/launchpad/entrySearch.js";
import { pendingLaunchIDs } from "../lib/launchPending.js";
import { fakeServiceClient } from "./fakeServiceClient.js";
import { marasiMoveRefusal } from "../lib/launchpad/entryMove.js";

// A fake service client: `routes` maps "METHOD /path" to a body, or to a
// function of (query or body) that returns one or throws. A missing route
// is the service's text 404. Calls are recorded as [method, path, arg].
function fakeClient(routes) {
  const calls = [];
  const call = (method) => async (path, arg) => {
    calls.push([method, path, arg]);
    const answer = routes[`${method} ${path}`];
    if (answer === undefined) {
      throw serviceError({ method, path, status: 404, body: null, text: "404 page not found" });
    }
    return typeof answer === "function" ? answer(arg) : answer;
  };
  return { calls, get: call("GET"), post: call("POST"), del: call("DELETE") };
}

// What the service answers a refused call with.
const refusal = (method, path, status, body) => {
  throw serviceError({ method, path, status, body });
};

const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

const summary = (id, number, fields = {}) => ({
  id,
  number,
  scheme: "https",
  method: "GET",
  host: "a.test",
  path: `/${id}`,
  status: "200 OK",
  status_code: 200,
  content_type: "text/plain",
  length: "2",
  metadata: {},
  requested_at: "2026-11-06T22:07:49.626213+04:00",
  responded_at: "2026-11-06T22:07:49.726213+04:00",
  highlight: null,
  upstream_proxy: { name: "", address: "" },
  ...fields,
});

// ---- Search across launchpads (GET /launchpad/search) ----

const needle = entrySearchQuery("needle-7f").query;

test("search is one GET /launchpad/search, mapping each launchpad to its matching entries", async () => {
  const client = fakeClient({
    "GET /launchpad/search": (query) => {
      assert.equal(query.q, needle);
      return { lp1: ["orig", "shared"], lp2: ["shared"] };
    },
  });
  const result = await createLaunchpadApi(client).searchEntries(needle);
  assert.deepEqual(result, { EntriesByLaunchpad: { lp1: ["orig", "shared"], lp2: ["shared"] }, QueryError: null });
  assert.deepEqual(client.calls.map(([method, path]) => `${method} ${path}`), ["GET /launchpad/search"]);
});

test("search with no match is an empty map", async () => {
  const client = fakeClient({ "GET /launchpad/search": {} });
  assert.deepEqual(await createLaunchpadApi(client).searchEntries(needle), { EntriesByLaunchpad: {}, QueryError: null });
});

test("search reports an invalid query as data, positioned in the researcher's text", async () => {
  const client = fakeClient({
    "GET /launchpad/search": () =>
      refusal("GET", "/launchpad/search", 400, { error: "invalid_query", message: "unbalanced parenthesis", position: 4 }),
  });
  const result = await createLaunchpadApi(client).searchEntries(needle);
  assert.deepEqual(result, { EntriesByLaunchpad: {}, QueryError: { Message: "unbalanced parenthesis", Position: 4 } });
});

test("search passes on a failure that isn't a query error", async () => {
  const client = fakeClient({
    "GET /launchpad/search": () => refusal("GET", "/launchpad/search", 500, { error: "internal_server_error" }),
  });
  await assert.rejects(createLaunchpadApi(client).searchEntries(needle), /internal_server_error/);
});

// ---- The store over the adapter ----

const RAW_A = "GET /a HTTP/1.1\r\nHost: a.test\r\n\r\n";
const RAW_B = "POST /b HTTP/1.1\r\nHost: a.test\r\n\r\nnaïve";

const pair = (id, number, raw, response = null) => ({
  id,
  number,
  note: "",
  metadata: {},
  highlight: null,
  request: { scheme: "https", method: "GET", host: "a.test", path: `/${id}`, raw: b64(raw), requested_at: "2026-11-06T22:07:49+04:00" },
  response: response ?? { status: "", status_code: -1, content_type: "", length: "", raw: "", responded_at: null },
  prettified: { request: null, response: null },
  upstream_proxy: null,
});

// One launchpad "Login" with entries a and b, both answered.
function loginRoutes(extra = {}) {
  const answered = { status: "200 OK", status_code: 200, content_type: "text/plain", length: "2", raw: b64("HTTP/1.1 200 OK\r\n\r\nok"), responded_at: "2026-11-06T22:07:50+04:00" };
  return {
    "GET /launchpad": { items: [{ id: "lp1", name: "Login", description: "auth flow", entry_count: 2, last_status_code: 200 }] },
    "GET /launchpad/lp1": { id: "lp1", name: "Login", description: "auth flow", items: [summary("a", 1), summary("b", 2)] },
    "GET /traffic/a": pair("a", 1, RAW_A, answered),
    "GET /traffic/b": pair("b", 2, RAW_B, answered),
    "GET /launch": { items: [] },
    ...extra,
  };
}

function setup(routes = loginRoutes()) {
  const client = fakeClient(routes);
  const store = createLaunchpadStore(createLaunchpadApi(client));
  return { client, store };
}

test("populate lists launchpads and seeds the draft from the last entry's raw request as text", async () => {
  const { store } = setup();
  await store.populate();
  const state = get(store);
  assert.deepEqual(state.launchpads, [
    { ID: "lp1", Name: "Login", Description: "auth flow", EntryCount: 2, LastStatusCode: 200, NewestEntryID: "b" },
  ]);
  assert.deepEqual(state.entriesByLaunchpad.lp1.map((e) => [e.ID, e.Number, e.StatusCode]), [["a", 1, 200], ["b", 2, 200]]);
  assert.equal(state.draftsByLaunchpad.lp1.raw, RAW_B);
  assert.equal(state.detailsById.b.Response.Raw, "HTTP/1.1 200 OK\r\n\r\nok");
  assert.equal(isDraftDirty(state, "lp1"), false);
});

test("launch sends the draft as base64 over the draft's scheme and records it pending", async () => {
  const { client, store } = setup(loginRoutes({ "POST /launchpad/lp1/launch": { launch_id: "c", status: "pending" } }));
  await store.populate();
  store.updateDraft("lp1", "GET /é HTTP/1.1\nHost: a.test\n\n");
  const id = await store.launch("lp1");
  assert.equal(id, "c");
  const [, , body] = client.calls.find(([method, path]) => method === "POST" && path === "/launchpad/lp1/launch");
  assert.deepEqual(body, { raw: b64("GET /é HTTP/1.1\nHost: a.test\n\n"), scheme: "https" });
  assert.equal(get(store).launchesById.c.Status, "pending");
});

test("launch events from the stream end a pending launch", async () => {
  const { store } = setup(loginRoutes({ "POST /launchpad/lp1/launch": { launch_id: "c", status: "pending" } }));
  await store.populate();
  await store.launch("lp1");
  store.onLaunchFinished(toLaunchEvent({ launch_id: "c", launchpad_id: "lp1", status: "failed", reason: "network_error" }));
  assert.deepEqual(get(store).launchesById.c, { ID: "c", LaunchpadID: "lp1", Status: "failed", Reason: "network_error" });
});

test("cancelling a launch that already ended records its final state without an error", async () => {
  const routes = loginRoutes({
    "GET /launch": { items: [{ launch_id: "c", launchpad_id: "lp1", status: "pending" }] },
    "POST /launch/c/cancel": () =>
      refusal("POST", "/launch/c/cancel", 409, { error: "launch_finished", launch_id: "c", launchpad_id: "lp1", status: "completed" }),
  });
  const { store } = setup(routes);
  await store.populate();
  await store.cancelLaunch("lp1");
  assert.equal(get(store).launchesById.c.Status, "completed");
});

test("deleting a launchpad with a pending launch keeps the launch_pending code and learns the launch", async () => {
  let pending = [];
  const routes = loginRoutes({
    "GET /launch": () => ({ items: pending }),
    "DELETE /launchpad/lp1": () => {
      pending = [{ launch_id: "c", launchpad_id: "lp1", status: "pending" }];
      refusal("DELETE", "/launchpad/lp1", 409, { error: "launch_pending", request_ids: ["c"] });
    },
  });
  const { store } = setup(routes);
  await store.populate();
  const err = await store.deleteLaunchpad("lp1").catch((e) => e);
  assert.deepEqual(pendingLaunchIDs(err), ["c"]);
  assert.equal(get(store).launchesById.c.Status, "pending");
  assert.equal(get(store).launchpads.length, 1);
});

test("a move the service refuses because an entry left the source reads as stale", async () => {
  const routes = loginRoutes({
    "GET /launchpad": {
      items: [
        { id: "lp1", name: "Login", description: "", entry_count: 2, last_status_code: 200 },
        { id: "lp2", name: "Other", description: "", entry_count: 0, last_status_code: null },
      ],
    },
    "GET /launchpad/lp2": { id: "lp2", items: [] },
    "POST /launchpad/lp1/move": () => refusal("POST", "/launchpad/lp1/move", 404, { error: "not_found" }),
  });
  const { store } = setup(routes);
  await store.populate();
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp2", ids: ["a"] });
  assert.equal(result.refused, "An entry is no longer in Login; nothing was moved");
});

test("a move sends the target and the entry to go before, and selects the moved entries", async () => {
  const { client, store } = setup(loginRoutes({
    "POST /launchpad/lp1/move": { source_launchpad_id: "lp1", target_launchpad_id: "lp1", request_ids: ["b"] },
  }));
  await store.populate();
  const result = await store.moveEntries({ sourceId: "lp1", targetId: "lp1", ids: ["b"], before: "a" });
  assert.deepEqual(result, { moved: ["b"], refused: null });
  const [, , body] = client.calls.find(([, path]) => path === "/launchpad/lp1/move");
  assert.deepEqual(body, { request_ids: ["b"], target_launchpad_id: "lp1", before_request_id: "a" });
});

test("removing entries unlinks them from the launchpad in bulk and reports the count", async () => {
  const { client, store } = setup(loginRoutes({ "POST /traffic/bulk/unlink": { count: 1 } }));
  await store.populate();
  const result = await store.removeEntries("lp1", ["a"]);
  assert.equal(result.removed, 1);
  const [, , body] = client.calls.find(([, path]) => path === "/traffic/bulk/unlink");
  assert.deepEqual(body, { selection: { ids: ["a"] }, launchpad_id: "lp1" });
});

test("linking entries to a test case names it by its keyed id", async () => {
  const { client, store } = setup(loginRoutes({ "POST /traffic/bulk/link": { count: 2 } }));
  await store.populate();
  assert.equal(await store.linkEntriesToRecord(["a", "b"], "test_case", "t1"), 2);
  const [, , body] = client.calls.find(([, path]) => path === "/traffic/bulk/link");
  assert.deepEqual(body, { selection: { ids: ["a", "b"] }, test_case_id: "t1" });
});

test("a launched entry arriving over the stream reads its raw request and response from the service", async () => {
  const routes = loginRoutes({ "POST /launchpad/lp1/launch": { launch_id: "c", status: "pending" } });
  const { store } = setup(routes);
  await store.populate();
  store.updateDraft("lp1", RAW_A);
  await store.launch("lp1");
  routes["GET /traffic/c"] = pair("c", 3, RAW_A);
  await store.onRequest(toRequestEvent({ id: "c", number: 3, scheme: "https", method: "GET", host: "a.test", path: "/a", metadata: {}, requested_at: "t" }));
  let state = get(store);
  assert.equal(state.detailsById.c.Request.Raw, RAW_A);
  assert.equal(state.selectedEntryByLaunchpad.lp1, "c");
  assert.equal(isDraftDirty(state, "lp1"), false);
  routes["GET /traffic/c"] = pair("c", 3, RAW_A, { status: "201 Created", status_code: 201, content_type: "text/plain", length: "0", raw: b64("HTTP/1.1 201 Created\r\n\r\n"), responded_at: "t2" });
  await store.onResponse(toResponseEvent({ id: "c", status: "201 Created", status_code: 201, content_type: "text/plain", length: "0", metadata: {}, responded_at: "t2" }));
  state = get(store);
  assert.equal(state.detailsById.c.Response.Raw, "HTTP/1.1 201 Created\r\n\r\n");
  assert.equal(state.entriesByLaunchpad.lp1.at(-1).StatusCode, 201);
});

// ---- Resync after a reconnect to the same project ----

test("resync replaces server data in place and keeps the draft, selection and search", async () => {
  const routes = loginRoutes({
    "POST /launchpad/lp1/launch": { launch_id: "c", status: "pending" },
    "GET /launch": { items: [{ launch_id: "c", launchpad_id: "lp1", status: "pending" }] },
  });
  const { store } = setup(routes);
  await store.populate();
  await store.selectEntry("lp1", "a");
  store.toggleEntry("lp1", "b");
  store.updateDraft("lp1", "GET /edited HTTP/1.1\nHost: a.test\n\n");
  store.setSearch("ab");

  // While the app was away: entry c arrived and answered, its launch ended,
  // and a second launchpad was made elsewhere.
  routes["GET /launchpad"] = {
    items: [
      { id: "lp1", name: "Login", description: "auth flow", entry_count: 3, last_status_code: 201 },
      { id: "lp2", name: "Made elsewhere", description: "", entry_count: 0, last_status_code: null },
    ],
  };
  routes["GET /launchpad/lp1"] = { id: "lp1", items: [summary("a", 1), summary("b", 2), summary("c", 3, { status_code: 201 })] };
  routes["GET /launch"] = { items: [] };
  routes["GET /launch/c"] = { launch_id: "c", launchpad_id: "lp1", status: "completed" };
  const before = get(store);

  await store.resync();

  const state = get(store);
  assert.deepEqual(state.launchpads.map((l) => [l.ID, l.EntryCount]), [["lp1", 3], ["lp2", 0]]);
  assert.deepEqual(state.entriesByLaunchpad.lp1.map((e) => e.ID), ["a", "b", "c"]);
  assert.equal(state.launchesById.c.Status, "completed");
  assert.equal(state.draftsByLaunchpad.lp1, before.draftsByLaunchpad.lp1);
  assert.equal(isDraftDirty(state, "lp1"), true);
  assert.equal(state.selectedLaunchpadId, "lp1");
  assert.equal(state.selectedEntryByLaunchpad.lp1, "a");
  assert.deepEqual(state.entrySelection, before.entrySelection);
  assert.equal(state.search, "ab");
});

test("resync rereads a loaded pair that had no response yet", async () => {
  const routes = loginRoutes();
  routes["GET /traffic/b"] = pair("b", 2, RAW_B);
  const { store } = setup(routes);
  await store.populate();
  assert.equal(get(store).detailsById.b.Response, null);
  routes["GET /traffic/b"] = pair("b", 2, RAW_B, { status: "200 OK", status_code: 200, content_type: "text/plain", length: "2", raw: b64("HTTP/1.1 200 OK\r\n\r\nok"), responded_at: "t" });
  await store.resync();
  assert.equal(get(store).detailsById.b.Response.StatusCode, 200);
});

// ---- An entry's note and metadata (the entry menu's views) ----

test("an entry's note reads as text, and as empty when it has none", async () => {
  const api = createLaunchpadApi(fakeClient({
    "GET /notes/a": { id: "a", note: "check the token" },
    "GET /notes/b": () => refusal("GET", "/notes/b", 404, { error: "not_found" }),
  }));
  assert.equal(await api.getNote("a"), "check the token");
  assert.equal(await api.getNote("b"), "");
});

test("an entry's metadata is the service's object", async () => {
  const api = createLaunchpadApi(fakeClient({ "GET /traffic/a/metadata": { launch: { status: "completed" } } }));
  assert.deepEqual(await api.getMetadata("a"), { launch: { status: "completed" } });
});

test("a launch ending while its request's details are still being read seeds the draft from the stored request", async () => {
  const routes = loginRoutes({ "POST /launchpad/lp1/launch": { launch_id: "c", status: "pending" } });
  const { store } = setup(routes);
  await store.populate();
  const launched = "GET /c HTTP/1.1\nHost: a.test\n\n";
  const stored = "GET https://a.test/c HTTP/1.1\r\n\r\n";
  store.updateDraft("lp1", launched);
  await store.launch("lp1");
  const reads = [];
  routes["GET /traffic/c"] = () => new Promise((resolve) => reads.push(resolve));
  const arrival = store.onRequest(toRequestEvent({ id: "c", number: 3, scheme: "https", method: "GET", host: "a.test", path: "/c", metadata: {}, requested_at: "t" }));
  const ended = store.onLaunchFinished(toLaunchEvent({ launch_id: "c", launchpad_id: "lp1", status: "completed" }));
  const answer = (body) => reads.forEach((resolve) => resolve(body));
  answer(pair("c", 3, stored, { status: "200 OK", status_code: 200, content_type: "text/plain", length: "2", raw: b64("HTTP/1.1 200 OK\r\n\r\nok"), responded_at: "t2" }));
  await Promise.all([arrival, ended]);
  const state = get(store);
  assert.equal(state.selectedEntryByLaunchpad.lp1, "c");
  assert.equal(state.draftsByLaunchpad.lp1.raw, stored);
  assert.equal(isDraftDirty(state, "lp1"), false);
});

test("launchpad events map to the store's summary, and traffic.changed names the launchpads it touches", () => {
  assert.deepEqual(toLaunchpadSummary({ id: "lp1", name: "Login", description: "auth" }), {
    ID: "lp1",
    Name: "Login",
    Description: "auth",
  });
  const selection = { ids: ["p1"] };
  assert.deepEqual(launchpadsChangedBy({ change: "link", selection, target: { kind: "launchpad", id: "lp1" } }), ["lp1"]);
  assert.deepEqual(launchpadsChangedBy({ change: "link", selection, target: { kind: "finding", id: "f1" } }), []);
  assert.equal(launchpadsChangedBy({ change: "delete", selection }), null);
  assert.equal(launchpadsChangedBy({ change: "highlight", selection }), null);
});

test("getRawDetails reads only the raw text: Launchpad never shows the prettified copies", async () => {
  const client = fakeServiceClient({
    "GET /traffic/0190a": { id: "0190a", number: 1, request: { method: "GET", raw: "R0VUIC8=" }, response: { status_code: 200, raw: null }, prettified: { request: null, response: null } },
  });
  const details = await createLaunchpadApi(client).getRawDetails("0190a");
  assert.deepEqual(client.calls.at(-1).query, { prettified: false });
  assert.equal(details.Request.Raw, "GET /");
});
