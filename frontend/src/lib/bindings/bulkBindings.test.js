// The Ledger's bulk bindings on a selection, and the project's client
// settings. Each sends its control API route and answers as v1 did.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";
import { incompleteJobs } from "../ledger/selectionIncomplete.js";
import { pendingLaunchIDs } from "../launchPending.js";

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

const ids = { ids: ["a1", "a2"] };
const whole = { query: "host:example.com", exclusion: ["image/*"], as_of: "a9" };

test("SetHighlight highlights either kind of selection and resolves how many pairs changed", async () => {
  answers["POST /traffic/bulk/highlight"] = { count: 2 };
  assert.equal(await App.SetHighlight(ids, 3), 2);
  assert.equal(await App.SetHighlight(whole, 8), 2);
  assert.deepEqual(
    sent.map((request) => request.body),
    [
      { selection: ids, highlight: 3 },
      { selection: whole, highlight: 8 },
    ],
  );
});

test("ClearHighlight clears with a null highlight and resolves how many pairs had one", async () => {
  answers["POST /traffic/bulk/highlight"] = { count: 1 };
  assert.equal(await App.ClearHighlight(whole), 1);
  assert.deepEqual(sent[0], {
    method: "POST",
    path: "/traffic/bulk/highlight",
    search: "",
    body: { selection: whole, highlight: null },
  });
});

test("AppendNote and ClearNotes write the selection's notes and resolve how many", async () => {
  answers["POST /traffic/bulk/note"] = { count: 2 };
  assert.equal(await App.AppendNote(ids, "IDOR candidate"), 2);
  assert.equal(await App.ClearNotes(whole), 2);
  assert.deepEqual(
    sent.map((request) => [request.path, request.body]),
    [
      ["/traffic/bulk/note", { selection: ids, append: "IDOR candidate" }],
      ["/traffic/bulk/note", { selection: whole, clear: true }],
    ],
  );
});

test("DeleteTraffic deletes the selection and resolves how many pairs it deleted", async () => {
  answers["POST /traffic/bulk/delete"] = { count: 7 };
  assert.equal(await App.DeleteTraffic(whole), 7);
  assert.deepEqual(sent[0].body, { selection: whole });
});

test("LinkTraffic and UnlinkTraffic name v1's target by Marasi's id field", async () => {
  answers["POST /traffic/bulk/link"] = { count: 2 };
  answers["POST /traffic/bulk/unlink"] = { count: 1 };
  assert.equal(await App.LinkTraffic(ids, { Kind: "launchpad", ID: "lp1" }), 2);
  assert.equal(await App.LinkTraffic(whole, { Kind: "finding", ID: "f1" }), 2);
  assert.equal(await App.UnlinkTraffic(ids, { Kind: "test_case", ID: "t1" }), 1);
  assert.deepEqual(
    sent.map((request) => [request.path, request.body]),
    [
      ["/traffic/bulk/link", { selection: ids, launchpad_id: "lp1" }],
      ["/traffic/bulk/link", { selection: whole, finding_id: "f1" }],
      ["/traffic/bulk/unlink", { selection: ids, test_case_id: "t1" }],
    ],
  );
});

test("a refused bulk change reads as v1's coded error, so the Ledger offers its way out", async () => {
  answers["POST /traffic/bulk/highlight"] = () =>
    json({ error: "selection_incomplete", message: "unfinished", jobs: ["traffic_index", "sitemap"] }, 409);
  answers["POST /traffic/bulk/delete"] = () =>
    json({ error: "launch_pending", message: "pending", request_ids: ["a2"] }, 409);
  const incomplete = await App.SetHighlight(whole, 1).catch((error) => error);
  assert.deepEqual(incompleteJobs(incomplete), ["traffic_index", "sitemap"]);
  const pending = await App.DeleteTraffic(ids).catch((error) => error);
  assert.deepEqual(pendingLaunchIDs(pending), ["a2"]);
});
