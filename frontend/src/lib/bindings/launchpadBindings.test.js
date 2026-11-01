// The Launchpad's ported bindings: launchpads, their entries, moves, links
// and search. Each sends its control API route and answers in the shape
// v1's frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";
import { pendingLaunchIDs } from "../launchPending.js";
import { marasiMoveRefusal } from "../launchpad/entryMove.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The connected instance answers each route from `answers`, by "METHOD path"
// (a function gets the request); any other route is Marasi's 404 not_found.
beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const request = { method, path: parsed.pathname, search: parsed.search, body: init.body ? JSON.parse(init.body) : undefined };
    sent.push(request);
    const answer = answers[`${method} ${parsed.pathname}`];
    if (answer === undefined) return json({ error: "not_found" }, 404);
    return typeof answer === "function" ? answer(request) : json(answer);
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const LP1 = "11111111-1111-4111-8111-111111111111";
const LP2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const summary = (id, number) => ({
  id,
  number,
  scheme: "https",
  method: "GET",
  host: "example.com",
  path: `/p${number}`,
  status: "200 OK",
  status_code: 200,
  content_type: "text/html",
  length: "12",
  metadata: {},
  requested_at: "2026-11-01T01:05:13Z",
  responded_at: "2026-11-01T01:05:14Z",
  highlight: null,
  upstream_proxy: { name: "", address: "" },
});

test("GetLaunchpads lists Marasi's launchpads in v1's Launchpad shape", async () => {
  answers["GET /launchpad"] = {
    items: [
      { id: LP1, name: "Login", description: "auth flow", entry_count: 2, last_status_code: 302 },
      { id: LP2, name: "Empty", description: "", entry_count: 0, last_status_code: null },
    ],
  };
  assert.deepEqual(await App.GetLaunchpads(), [
    { ID: LP1, Name: "Login", Description: "auth flow", EntryCount: 2, LastStatusCode: 302 },
    { ID: LP2, Name: "Empty", Description: "", EntryCount: 0, LastStatusCode: null },
  ]);
});

test("GetLaunchpadRequests lists a launchpad's entries in entry order as v1's summaries", async () => {
  answers[`GET /launchpad/${LP1}`] = { id: LP1, name: "Login", description: "", items: [summary(B, 7), summary(A, 3)], index: { complete: true } };
  const entries = await App.GetLaunchpadRequests(LP1);
  assert.deepEqual(entries.map((entry) => [entry.ID, entry.Number, entry.StatusCode]), [[B, 7, 200], [A, 3, 200]]);
});

test("CreateLaunchpadEntry creates a launchpad and resolves its id", async () => {
  answers["POST /launchpad"] = (request) => json({ id: LP1, ...request.body });
  assert.equal(await App.CreateLaunchpadEntry("Login", "auth flow"), LP1);
  assert.deepEqual(sent[0].body, { name: "Login", description: "auth flow" });
});

test("UpdateLaunchpadEntry sets a launchpad's name and description", async () => {
  answers[`POST /launchpad/${LP1}`] = (request) => json({ id: LP1, ...request.body });
  await App.UpdateLaunchpadEntry(LP1, "Logout", "");
  assert.deepEqual(sent.map((request) => [request.method, request.path, request.body]), [
    ["POST", `/launchpad/${LP1}`, { name: "Logout", description: "" }],
  ]);
});

test("DeleteLaunchpad deletes a launchpad", async () => {
  answers[`DELETE /launchpad/${LP1}`] = { id: LP1 };
  await App.DeleteLaunchpad(LP1);
  assert.deepEqual(sent.map((request) => [request.method, request.path]), [["DELETE", `/launchpad/${LP1}`]]);
});

test("a delete Marasi refuses for a pending launch names the launch's pairs, as v1's did", async () => {
  answers[`DELETE /launchpad/${LP1}`] = () => json({ error: "launch_pending", message: "launch pending", request_ids: [A] }, 409);
  const error = await App.DeleteLaunchpad(LP1).catch((err) => err);
  assert.deepEqual(pendingLaunchIDs(error), [A]);
});

test("LinkRequestToLaunchpad links one pair to a launchpad", async () => {
  answers[`POST /launchpad/${LP1}/link`] = { launchpad_id: LP1, request_id: A };
  await App.LinkRequestToLaunchpad(A, LP1);
  assert.deepEqual(sent[0].body, { request_id: A });
});

test("MoveLaunchpadEntries moves entries before another and resolves the moved ids in their new order", async () => {
  answers[`POST /launchpad/${LP1}/move`] = { source_launchpad_id: LP1, target_launchpad_id: LP2, request_ids: [B, A] };
  assert.deepEqual(await App.MoveLaunchpadEntries(LP1, LP2, [B, A], A), [B, A]);
  assert.deepEqual(sent[0].body, { request_ids: [B, A], target_launchpad_id: LP2, before_request_id: A });
});

test("MoveLaunchpadEntries with no entry to go before moves to the end", async () => {
  answers[`POST /launchpad/${LP1}/move`] = { source_launchpad_id: LP1, target_launchpad_id: LP1, request_ids: [A] };
  await App.MoveLaunchpadEntries(LP1, LP1, [A], "");
  assert.deepEqual(sent[0].body, { request_ids: [A], target_launchpad_id: LP1 });
});

test("a move into a launchpad that already holds the pair is refused as in v1", async () => {
  answers[`POST /launchpad/${LP1}/move`] = () => json({ error: "already_linked" }, 409);
  const error = await App.MoveLaunchpadEntries(LP1, LP2, [A], "").catch((err) => err);
  assert.equal(marasiMoveRefusal(error, { sourceName: "Login", targetName: "Search" }), "An entry is already in Search; nothing was moved");
});

test("a move of a pending launch's entry is refused with v1's explanation", async () => {
  answers[`POST /launchpad/${LP1}/move`] = () => json({ error: "launch_pending", message: "launch pending", request_ids: [A, B] }, 409);
  const error = await App.MoveLaunchpadEntries(LP1, LP2, [A, B], "").catch((err) => err);
  assert.equal(marasiMoveRefusal(error, { sourceName: "Login", targetName: "Search" }), "2 entries are still launching; nothing was moved");
});

test("a move Marasi can't find an entry or launchpad for reads as a changed launchpad", async () => {
  answers[`POST /launchpad/${LP1}/move`] = () => json({ error: "not_found" }, 404);
  const error = await App.MoveLaunchpadEntries(LP1, LP2, [A], "").catch((err) => err);
  assert.equal(marasiMoveRefusal(error, { sourceName: "Login", targetName: "Search" }), "The launchpad changed; nothing was moved");
});

test("SearchLaunchpadEntries asks each launchpad for its matching entries when any launchpad entry matches", async () => {
  answers["GET /traffic"] = { items: [summary(A, 3)] };
  answers["GET /launchpad"] = { items: [{ id: LP1, name: "Login" }, { id: LP2, name: "Search" }] };
  answers[`GET /launchpad/${LP1}`] = { id: LP1, items: [summary(A, 3), summary(B, 7)] };
  answers[`GET /launchpad/${LP2}`] = { id: LP2, items: [] };
  const result = await App.SearchLaunchpadEntries('request_head:"login"');
  assert.deepEqual(result, { EntriesByLaunchpad: { [LP1]: [A, B] }, QueryError: null });
  const params = (request) => Object.fromEntries(new URLSearchParams(request.search));
  assert.deepEqual(params(sent[0]), { q: 'launchpad:* AND (request_head:"login")', limit: "1" });
  assert.deepEqual(params(sent.find((request) => request.path === `/launchpad/${LP1}`)), { q: 'request_head:"login"' });
});

test("SearchLaunchpadEntries reads no launchpad when no launchpad entry matches", async () => {
  answers["GET /traffic"] = { items: [] };
  assert.deepEqual(await App.SearchLaunchpadEntries('request_head:"nope"'), { EntriesByLaunchpad: {}, QueryError: null });
  assert.equal(sent.length, 1);
});

test("SearchLaunchpadEntries answers an invalid query as v1's QueryError, at its place in the researcher's text", async () => {
  answers["GET /traffic"] = () => json({ error: "invalid_query", message: "unexpected )", position: 22 }, 400);
  assert.deepEqual(await App.SearchLaunchpadEntries("a)"), {
    EntriesByLaunchpad: {},
    QueryError: { Message: "unexpected )", Position: 5 },
  });
});

test("LinkTraffic links a selection to a launchpad and resolves how many pairs were linked", async () => {
  answers["POST /traffic/bulk/link"] = { count: 2 };
  assert.equal(await App.LinkTraffic({ ids: [A, B] }, { Kind: "launchpad", ID: LP1 }), 2);
  assert.deepEqual(sent[0].body, { selection: { ids: [A, B] }, launchpad_id: LP1 });
});

test("UnlinkTraffic unlinks a query selection from a finding or test case", async () => {
  answers["POST /traffic/bulk/unlink"] = { count: 5 };
  const selection = { query: "host:x", exclusion: [], as_of: A };
  assert.equal(await App.UnlinkTraffic(selection, { Kind: "test_case", ID: LP2 }), 5);
  assert.deepEqual(sent[0].body, { selection, test_case_id: LP2 });
});

test("a removal Marasi refuses for a pending launch names the launch's pairs", async () => {
  answers["POST /traffic/bulk/unlink"] = () => json({ error: "launch_pending", message: "launch pending", request_ids: [A] }, 409);
  const error = await App.UnlinkTraffic({ ids: [A] }, { Kind: "launchpad", ID: LP1 }).catch((err) => err);
  assert.deepEqual(pendingLaunchIDs(error), [A]);
});

test("PendingLaunches lists Marasi's pending launches as v1's Launch", async () => {
  answers["GET /launch"] = { items: [{ launch_id: A, launchpad_id: LP1, status: "pending" }] };
  assert.deepEqual(await App.PendingLaunches(), [{ ID: A, LaunchpadID: LP1, Status: "pending", Reason: "" }]);
});

test("GetLaunch reads one launch's outcome as v1's Launch", async () => {
  answers[`GET /launch/${A}`] = { launch_id: A, launchpad_id: LP1, status: "failed", reason: "network_error" };
  assert.deepEqual(await App.GetLaunch(A), { ID: A, LaunchpadID: LP1, Status: "failed", Reason: "network_error" });
});

test("Launch sends the draft as Marasi's base64 bytes over its scheme and resolves the launch id", async () => {
  answers[`POST /launchpad/${LP1}/launch`] = { launch_id: A, status: "pending" };
  const raw = "POST /login HTTP/1.1\nHost: example.com\n\nname=é";
  assert.equal(await App.Launch(raw, LP1, true), A);
  assert.equal(await App.Launch(raw, LP1, false), A);
  assert.deepEqual(sent.map((request) => request.body), [
    { raw: Buffer.from(raw, "utf8").toString("base64"), scheme: "https" },
    { raw: Buffer.from(raw, "utf8").toString("base64"), scheme: "http" },
  ]);
});

test("a launch Marasi can't start rejects", async () => {
  answers[`POST /launchpad/${LP1}/launch`] = () => json({ error: "invalid_launchpad_request" }, 400);
  await assert.rejects(App.Launch("nonsense", LP1, true), /invalid_launchpad_request/);
});

test("CancelLaunch cancels a launch and resolves it cancelled, as v1's Launch", async () => {
  answers[`POST /launch/${A}/cancel`] = { launch_id: A, launchpad_id: LP1, status: "cancelled" };
  assert.deepEqual(await App.CancelLaunch(A), { ID: A, LaunchpadID: LP1, Status: "cancelled", Reason: "" });
});

test("cancelling a launch that already ended resolves its final state, as v1's did", async () => {
  answers[`POST /launch/${A}/cancel`] = () =>
    json({ error: "launch_finished", launch_id: A, launchpad_id: LP1, status: "completed" }, 409);
  assert.deepEqual(await App.CancelLaunch(A), { ID: A, LaunchpadID: LP1, Status: "completed", Reason: "" });
});

test("cancelling a launch Marasi doesn't know rejects", async () => {
  await assert.rejects(App.CancelLaunch(B), /not_found/);
});

test("SetUnsavedDraftCount tells the main process the window's dirty draft count", async () => {
  const reported = [];
  globalThis.window = { marasiApp: { reportDrafts: async (count) => reported.push(count) } };
  try {
    await App.SetUnsavedDraftCount(2);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(reported, [2]);
});
