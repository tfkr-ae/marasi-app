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

test("an invalid query answers as v1's QueryError rather than rejecting", async () => {
  answers["GET /traffic"] = () => json({ error: "invalid_query", message: "unexpected end of query", position: 8 }, 400);
  answers["GET /traffic/count"] = answers["GET /traffic"];
  const expected = { QueryError: { Message: "unexpected end of query", Position: 8 } };
  assert.deepEqual(await App.QueryTraffic({ Query: "method =" }), expected);
  assert.deepEqual(await App.CountTraffic("method =", ""), expected);
});

test("IgnoreExclusion reads every content type", async () => {
  answers["GET /traffic"] = { items: [], next_cursor: null, prev_cursor: null, as_of: null, index: { complete: true } };
  const page = await App.QueryTraffic({ Query: "", IgnoreExclusion: true });
  assert.deepEqual(new URLSearchParams(sent.at(-1).search).getAll("exclude"), []);
  assert.equal(page.AsOf, "", "no pairs, no as_of");
});

test("CountTraffic counts new matches after a pair, bounded by as_of, under the exclusion", async () => {
  answers["GET /traffic/count"] = { count: 100000, capped: true, index: { complete: true } };
  const counted = await App.CountTraffic("method = GET", "a7", { AsOf: "a9" });
  const query = new URLSearchParams(sent.at(-1).search);
  assert.equal(query.get("q"), "method = GET");
  assert.equal(query.get("after"), "a7");
  assert.equal(query.get("as_of"), "a9");
  assert.deepEqual(query.getAll("exclude"), ["image/*"]);
  assert.deepEqual(counted, { Count: 100000, Capped: true, IndexComplete: true, QueryError: null });

  await App.CountTraffic("", "", { IgnoreExclusion: true });
  assert.equal(sent.at(-1).search, "", "every pair, whatever its content type");
});

test("CountContentTypes counts the project's pairs per content type", async () => {
  answers["GET /traffic/content-types"] = {
    items: [
      { content_type: "text/html", count: 3 },
      { content_type: "", count: 1 },
    ],
    sitemap: { complete: false },
  };
  assert.deepEqual(await App.CountContentTypes(), {
    Counts: [
      { ContentType: "text/html", Count: 3 },
      { ContentType: "", Count: 1 },
    ],
    Complete: { sitemap: false },
  });
});

test("the exclusion follows the app default until the project keeps its own", async () => {
  assert.equal(await App.HasOwnContentTypeExclusion(), false);
  assert.deepEqual(await App.GetContentTypeExclusion(), ["image/*"]);

  let stored = null;
  answers["PUT /client-settings/marasi-app/ledger.exclusion"] = (request) => {
    stored = request.body.value;
    return json({ client: "marasi-app", key: "ledger.exclusion", value: stored });
  };
  await App.SetContentTypeExclusion(["Text/CSS; charset=utf-8", "font/*"]);
  assert.deepEqual(stored, ["text/css", "font/*"], "normalised as Marasi does");

  answers["GET /client-settings/marasi-app/ledger.exclusion"] = () => json({ value: stored });
  assert.equal(await App.HasOwnContentTypeExclusion(), true);
  assert.deepEqual(await App.GetContentTypeExclusion(), ["text/css", "font/*"]);
  appDefault = ["video/*"];
  assert.deepEqual(await App.GetContentTypeExclusion(), ["text/css", "font/*"], "the app default no longer applies");

  answers["DELETE /client-settings/marasi-app/ledger.exclusion"] = () => {
    delete answers["GET /client-settings/marasi-app/ledger.exclusion"];
    delete answers["DELETE /client-settings/marasi-app/ledger.exclusion"];
    return json({ client: "marasi-app", key: "ledger.exclusion" });
  };
  await App.ResetContentTypeExclusion();
  assert.equal(await App.HasOwnContentTypeExclusion(), false);
  assert.deepEqual(await App.GetContentTypeExclusion(), ["video/*"]);
  await App.ResetContentTypeExclusion(); // Marasi's not_found: nothing to drop
});

test("an empty own exclusion hides nothing, rather than following the default", async () => {
  answers["GET /client-settings/marasi-app/ledger.exclusion"] = { value: [] };
  assert.deepEqual(await App.GetContentTypeExclusion(), []);
});

test("SetContentTypeExclusion refuses a value that isn't a content type, and stores nothing", async () => {
  await assert.rejects(App.SetContentTypeExclusion(["*/png"]), /invalid content-type exclusion/);
  assert.equal(sent.length, 0);
});
