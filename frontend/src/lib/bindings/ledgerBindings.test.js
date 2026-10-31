// The Ledger's ported bindings: traffic pages and counts, the content-type
// exclusion, the full pair and its note. Each sends its control API route
// and answers in the shape v1's frontend reads.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
let appDefault;
const realFetch = globalThis.fetch;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// The connected instance answers each route from `answers`, by "METHOD path"
// (a function gets the request). A route with no answer is an unset client
// setting: Marasi's 404 not_found.
beforeEach(() => {
  sent = [];
  answers = {};
  appDefault = ["image/*"];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const request = { method, path: parsed.pathname, search: parsed.search, body: init.body ? JSON.parse(init.body) : undefined };
    sent.push(request);
    const answer = answers[`${method} ${parsed.pathname}`];
    if (answer === undefined) return json({ error: "not_found" }, 404);
    return typeof answer === "function" ? answer(request) : json(answer);
  };
  globalThis.window = {
    marasiApp: { appConfig: { defaultContentTypeExclusion: async () => ({ value: appDefault }) } },
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

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
  metadata: { has_note: 1 },
  requested_at: "2026-11-01T01:05:13.658408+04:00",
  responded_at: null,
  highlight: 3,
  upstream_proxy: { name: "", address: "" },
});

test("QueryTraffic reads a page under the project's exclusion, in display order and v1's shape", async () => {
  answers["GET /traffic"] = {
    // Marasi lists a page in reverse display order.
    items: [summary("a1", 1), summary("a2", 2)],
    next_cursor: "n",
    prev_cursor: null,
    as_of: "a2",
    index: { complete: false },
  };
  const page = await App.QueryTraffic({
    Query: 'host = "example.com"',
    OrderBy: "number desc",
    Cursor: "c",
    Direction: "backward",
    AsOf: "a2",
    Limit: 200,
  });
  const query = new URLSearchParams(sent.at(-1).search);
  assert.equal(query.get("q"), 'host = "example.com"');
  assert.equal(query.get("order_by"), "number desc");
  assert.equal(query.get("cursor"), "c");
  assert.equal(query.get("direction"), "backward");
  assert.equal(query.get("as_of"), "a2");
  assert.equal(query.get("limit"), "200");
  assert.deepEqual(query.getAll("exclude"), ["image/*"]);
  assert.deepEqual(
    page.Items.map((item) => item.ID),
    ["a2", "a1"],
  );
  assert.deepEqual(page.Items[0], {
    ID: "a2",
    Number: 2,
    Scheme: "https",
    Method: "GET",
    Host: "example.com",
    Path: "/p2",
    Status: "200 OK",
    StatusCode: 200,
    ContentType: "text/html",
    Length: "12",
    Metadata: { has_note: 1 },
    RequestedAt: "2026-11-01T01:05:13.658408+04:00",
    RespondedAt: "0001-01-01T00:00:00Z",
    Note: "",
    Highlight: 3,
    Route: { Name: "", Address: "" },
  });
  assert.equal(page.NextCursor, "n");
  assert.equal(page.PrevCursor, null);
  assert.equal(page.AsOf, "a2");
  assert.equal(page.IndexComplete, false);
  assert.equal(page.QueryError, null);
});
