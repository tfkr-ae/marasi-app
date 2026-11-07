// The Ledger's api over the service client: each call reads or writes a
// control API route and maps its answer to the shapes createLedgerStore
// reads. Tested over a fake service client whose routes answer as the
// service does (snake_case, refusals as ServiceErrors).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeServiceClient as fakeClient } from "./fakeServiceClient.js";
import { createLedgerApi, toUpgradeEvent } from "./ledgerApi.js";
import { toRequestEvent, toResponseEvent } from "./trafficApi.js";
import { createExclusion } from "./contentTypeExclusion.js";

const notFound = { status: 404, body: { error: "not_found" } };

// The app config's half of the exclusion: the app default.
function fakeAppConfig(defaultExclusion = ["image/*"]) {
  const config = { defaultExclusion };
  return {
    config,
    getDefaultExclusion: async () => config.defaultExclusion,
    setDefaultExclusion: async (types) => {
      config.defaultExclusion = types;
    },
  };
}

const summary = (n, extra = {}) => ({
  id: `0190000${n}`,
  number: n,
  scheme: "https",
  method: "GET",
  host: "api.acme.test",
  path: `/${n}`,
  status: "200 OK",
  status_code: 200,
  content_type: "application/json",
  length: "10",
  metadata: {},
  requested_at: "2026-11-06T22:07:49.626213+04:00",
  responded_at: "2026-11-06T22:07:49.700000+04:00",
  highlight: null,
  upstream_proxy: { name: "", address: "" },
  ...extra,
});

function setup(routes, appConfig = fakeAppConfig()) {
  const client = fakeClient(routes);
  const exclusion = createExclusion(client, appConfig);
  return { client, appConfig, api: createLedgerApi(client, { exclusion, appConfig }) };
}

test("queryTraffic reads a page in display order, as the table's rows", async () => {
  const { api } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    // The service lists a page in reverse display order.
    "GET /traffic": {
      items: [summary(1), summary(2, { highlight: 3, upstream_proxy: { name: "corp", address: "http://10.0.0.1:3128" } })],
      next_cursor: "n1",
      prev_cursor: null,
      as_of: "01900002",
      index: { complete: false },
    },
  });
  const page = await api.queryTraffic({ Query: "", OrderBy: "requested_at desc", Cursor: "", Direction: "forward", AsOf: "", Limit: 200 });
  assert.deepEqual(
    page.Items.map((row) => row.Number),
    [2, 1],
  );
  assert.deepEqual(page.Items[0], {
    ID: "01900002",
    Number: 2,
    Scheme: "https",
    Method: "GET",
    Host: "api.acme.test",
    Path: "/2",
    Status: "200 OK",
    StatusCode: 200,
    ContentType: "application/json",
    Length: "10",
    Metadata: {},
    RequestedAt: "2026-11-06T22:07:49.626213+04:00",
    RespondedAt: "2026-11-06T22:07:49.700000+04:00",
    Highlight: 3,
    Route: { Name: "corp", Address: "http://10.0.0.1:3128" },
  });
  assert.equal(page.NextCursor, "n1");
  assert.equal(page.PrevCursor, null);
  assert.equal(page.AsOf, "01900002");
  assert.equal(page.IndexComplete, false);
  assert.equal(page.QueryError, null);
});

test("queryTraffic leaves out the project's exclusion, or the app default it follows", async () => {
  let own = notFound;
  const { api, client } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": () => own,
    "GET /traffic": { items: [], next_cursor: null, prev_cursor: null, as_of: null, index: { complete: true } },
  });
  await api.queryTraffic({ Query: "host = \"a\"", OrderBy: "number", Cursor: "c1", Direction: "backward", AsOf: "0190", Limit: 50 });
  const read = client.calls.find((call) => call.path === "/traffic");
  assert.deepEqual(read.query, {
    q: 'host = "a"',
    exclude: ["image/*"],
    order_by: "number",
    cursor: "c1",
    direction: "backward",
    as_of: "0190",
    limit: 50,
  });

  // The project's own list, once it has one (read afresh after a resync).
  own = { client: "marasi-app", key: "ledger.exclusion", value: ["text/css"] };
  api.forgetExclusion();
  await api.queryTraffic({ Query: "", OrderBy: "", Cursor: "", Direction: "forward", AsOf: "", Limit: 10 });
  const second = client.calls.filter((call) => call.path === "/traffic")[1];
  // An empty query and sort are left out: the live view, newest first.
  assert.deepEqual(second.query, { exclude: ["text/css"], direction: "forward", limit: 10 });
});

test("queryTraffic with IgnoreExclusion lists every content type", async () => {
  const { api, client } = setup({
    "GET /traffic": { items: [], next_cursor: null, prev_cursor: null, as_of: null, index: { complete: true } },
  });
  await api.queryTraffic({ Query: "", OrderBy: "number", Cursor: "", Direction: "forward", AsOf: "", Limit: 1, IgnoreExclusion: true });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].query.exclude, undefined);
});

test("queryTraffic returns an invalid query as data, with its position", async () => {
  const { api } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    "GET /traffic": { status: 400, body: { error: "invalid_query", message: "unexpected token", position: 7 } },
  });
  const page = await api.queryTraffic({ Query: "host = ", OrderBy: "", Cursor: "", Direction: "forward", AsOf: "", Limit: 10 });
  assert.deepEqual(page.QueryError, { Message: "unexpected token", Position: 7 });
  assert.deepEqual(page.Items, []);
});

test("queryTraffic reads past the service's 500-row page, forward and backward", async () => {
  // 1200 pairs, newest first; cursors name the row they stand at.
  const all = Array.from({ length: 1200 }, (_, i) => summary(1200 - i));
  const at = (cursor) => (cursor ? Number(cursor.slice(1)) : null);
  const { api, client } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    "GET /traffic": (query) => {
      assert.ok(query.limit <= 500);
      let rows;
      const from = at(query.cursor);
      if (query.direction === "backward") {
        const end = from == null ? all.length : from;
        rows = all.slice(Math.max(0, end - query.limit), end);
        const start = end - rows.length;
        return page(rows, start);
      }
      const start = from == null ? 0 : from + 1;
      rows = all.slice(start, start + query.limit);
      return page(rows, start);
    },
  });
  function page(rows, start) {
    const end = start + rows.length;
    return {
      items: [...rows].reverse(),
      next_cursor: end < all.length ? `c${end - 1}` : null,
      prev_cursor: start > 0 ? `c${start}` : null,
      as_of: "01901200",
      index: { complete: true },
    };
  }

  const forward = await api.queryTraffic({ Query: "", OrderBy: "", Cursor: "", Direction: "forward", AsOf: "", Limit: 1000 });
  assert.equal(forward.Items.length, 1000);
  assert.equal(forward.Items[0].Number, 1200);
  assert.equal(forward.Items[999].Number, 201);
  assert.equal(forward.PrevCursor, null);
  assert.equal(forward.NextCursor, "c999");
  // Later pages pass the first page's as_of.
  const reads = client.calls.filter((call) => call.path === "/traffic");
  assert.equal(reads.length, 2);
  assert.equal(reads[1].query.as_of, "01901200");
  assert.equal(reads[1].query.limit, 500);

  const backward = await api.queryTraffic({ Query: "", OrderBy: "", Cursor: "", Direction: "backward", AsOf: "", Limit: 700 });
  assert.equal(backward.Items.length, 700);
  assert.equal(backward.Items[0].Number, 700);
  assert.equal(backward.Items[699].Number, 1);
  assert.equal(backward.PrevCursor, "c500");
  assert.equal(backward.NextCursor, null);
});

test("countTraffic counts matches after a pair or up to an as_of, minus the exclusion", async () => {
  const { api, client } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    "GET /traffic/count": { count: 100000, capped: true, index: { complete: true } },
  });
  const counted = await api.countTraffic("method = \"GET\"", "0190a", { AsOf: "0190b" });
  assert.equal(counted.Count, 100000);
  assert.equal(counted.Capped, true);
  assert.equal(counted.QueryError, null);
  assert.deepEqual(client.calls.at(-1).query, { q: 'method = "GET"', exclude: ["image/*"], as_of: "0190b", after: "0190a" });

  await api.countTraffic("", "", { IgnoreExclusion: true });
  assert.deepEqual(client.calls.at(-1).query, {});
});

test("countTraffic returns an invalid query as data", async () => {
  const { api } = setup({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    "GET /traffic/count": { status: 400, body: { error: "invalid_query", message: "bad", position: 1 } },
  });
  const counted = await api.countTraffic("(", "");
  assert.deepEqual(counted.QueryError, { Message: "bad", Position: 1 });
});

test("the exclusion: the app default until the project keeps its own, and back", async () => {
  const stored = new Map();
  const key = "/client-settings/marasi-app/ledger.exclusion";
  const { api, appConfig } = setup({
    [`GET ${key}`]: () => (stored.has("x") ? { key: "ledger.exclusion", value: stored.get("x") } : notFound),
    [`PUT ${key}`]: (_, body) => {
      stored.set("x", body.value);
      return { key: "ledger.exclusion", value: body.value };
    },
    [`DELETE ${key}`]: () => {
      stored.delete("x");
      return { client: "marasi-app", key: "ledger.exclusion" };
    },
  });
  assert.deepEqual(await api.getExclusion(), ["image/*"]);
  assert.equal(await api.hasOwnExclusion(), false);

  // Saved as Marasi keeps it: lowercase, no parameters, no duplicates.
  await api.setExclusion(["Text/CSS; charset=utf-8", "text/css", "font/*"]);
  assert.deepEqual(stored.get("x"), ["text/css", "font/*"]);
  assert.deepEqual(await api.getExclusion(), ["text/css", "font/*"]);
  assert.equal(await api.hasOwnExclusion(), true);

  await api.resetExclusion();
  assert.equal(stored.has("x"), false);
  assert.deepEqual(await api.getExclusion(), ["image/*"]);

  // The app default is the app config's.
  await api.setDefaultExclusion(["video/*"]);
  assert.deepEqual(appConfig.config.defaultExclusion, ["video/*"]);
  assert.deepEqual(await api.getDefaultExclusion(), ["video/*"]);
  assert.deepEqual(await api.getExclusion(), ["video/*"]);
});

test("countContentTypes reads the project's content types and the sitemap job's state", async () => {
  const { api } = setup({
    "GET /traffic/content-types": {
      items: [
        { content_type: "text/html", count: 4 },
        { content_type: "", count: 1 },
      ],
      sitemap: { complete: false },
    },
  });
  assert.deepEqual(await api.countContentTypes(), {
    Counts: [
      { ContentType: "text/html", Count: 4 },
      { ContentType: "", Count: 1 },
    ],
    Complete: { sitemap: false },
  });
});

test("getRawDetails reads the full pair with its bodies as text", async () => {
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
  const { api } = setup({
    "GET /traffic/0190a": {
      id: "0190a",
      number: 4,
      note: "check this",
      metadata: { has_note: 1 },
      highlight: 2,
      request: { scheme: "https", method: "POST", host: "a.test", path: "/x", raw: b64("POST /x HTTP/1.1\r\n\r\nü"), requested_at: "t1" },
      response: { status: "200 OK", status_code: 200, content_type: "text/plain", length: "2", raw: b64("HTTP/1.1 200 OK\r\n\r\nok"), responded_at: "t2" },
      prettified: { request: null, response: "pretty" },
      upstream_proxy: null,
    },
  });
  const details = await api.getRawDetails("0190a");
  assert.equal(details.Request.Raw, "POST /x HTTP/1.1\r\n\r\nü");
  assert.equal(details.Request.Method, "POST");
  assert.equal(details.Response.Raw, "HTTP/1.1 200 OK\r\n\r\nok");
  assert.equal(details.Response.StatusCode, 200);
  assert.equal(details.Response.RespondedAt, "t2");
  assert.deepEqual(details.Prettified, { Request: "", Response: "pretty" });
  assert.equal(details.Note, "check this");
  assert.equal(details.Highlight, 2);
  assert.equal(details.Route, null);
});

test("getRawDetails resolves to null for a pair that is gone", async () => {
  const { api } = setup({});
  assert.equal(await api.getRawDetails("0190a"), null);
});

test("getMetadata reads a pair's metadata", async () => {
  const { api } = setup({ "GET /traffic/0190a/metadata": { has_note: 1, tag: "x" } });
  assert.deepEqual(await api.getMetadata("0190a"), { has_note: 1, tag: "x" });
});

test("notes: a missing note reads as empty, and saving an empty one deletes it", async () => {
  const notes = new Map([["0190a", "first"]]);
  const { api, client } = setup({
    "GET /notes/0190a": () => (notes.has("0190a") ? { id: "0190a", note: notes.get("0190a") } : notFound),
    "PUT /notes/0190a": (_, body) => {
      notes.set("0190a", body.note);
      return { id: "0190a", note: body.note };
    },
    "DELETE /notes/0190a": () => {
      notes.delete("0190a");
      return { id: "0190a" };
    },
  });
  assert.equal(await api.getNote("0190a"), "first");
  await api.updateNote("0190a", "second");
  assert.equal(notes.get("0190a"), "second");
  await api.updateNote("0190a", "");
  assert.equal(notes.has("0190a"), false);
  assert.equal(await api.getNote("0190a"), "");
  assert.deepEqual(
    client.calls.map((call) => `${call.method} ${call.path}`),
    ["GET /notes/0190a", "PUT /notes/0190a", "DELETE /notes/0190a", "GET /notes/0190a"],
  );
});

test("bulk changes send the selection and resolve to the count", async () => {
  const bodies = [];
  const answer = (count) => (_, body) => {
    bodies.push(body);
    return { count };
  };
  const { api, client } = setup({
    "POST /traffic/bulk/highlight": answer(3),
    "POST /traffic/bulk/note": answer(2),
    "POST /traffic/bulk/link": answer(4),
    "POST /traffic/bulk/unlink": answer(1),
    "POST /traffic/bulk/delete": answer(5),
  });
  const ids = { ids: ["a", "b"] };
  const all = { query: "host = \"a\"", exclusion: ["image/*"], as_of: "0190" };
  assert.equal(await api.setHighlight(ids, 4), 3);
  assert.equal(await api.clearHighlight(all), 3);
  assert.equal(await api.appendNote(ids, "seen"), 2);
  assert.equal(await api.clearNotes(ids), 2);
  assert.equal(await api.linkTraffic(ids, { Kind: "launchpad", ID: "lp1" }), 4);
  assert.equal(await api.linkTraffic(ids, { Kind: "finding", ID: "f1" }), 4);
  assert.equal(await api.unlinkTraffic(all, { Kind: "test_case", ID: "t1" }), 1);
  assert.equal(await api.deleteTraffic(ids), 5);
  assert.deepEqual(bodies, [
    { selection: ids, highlight: 4 },
    { selection: all, highlight: null },
    { selection: ids, append: "seen" },
    { selection: ids, clear: true },
    { selection: ids, launchpad_id: "lp1" },
    { selection: ids, finding_id: "f1" },
    { selection: all, test_case_id: "t1" },
    { selection: ids },
  ]);
  assert.deepEqual(
    client.calls.map((call) => call.path),
    [
      "/traffic/bulk/highlight",
      "/traffic/bulk/highlight",
      "/traffic/bulk/note",
      "/traffic/bulk/note",
      "/traffic/bulk/link",
      "/traffic/bulk/link",
      "/traffic/bulk/unlink",
      "/traffic/bulk/delete",
    ],
  );
});

test("a bulk refusal keeps the code and ids the Ledger reads", async () => {
  const { api } = setup({
    "POST /traffic/bulk/delete": { status: 409, body: { error: "launch_pending", request_ids: ["a"] } },
    "POST /traffic/bulk/link": { status: 409, body: { error: "selection_incomplete", jobs: ["traffic_index"] } },
  });
  await assert.rejects(api.deleteTraffic({ ids: ["a"] }), /launch_pending \(a\)/);
  await assert.rejects(api.linkTraffic({ ids: ["a"] }, { Kind: "launchpad", ID: "x" }), /selection_incomplete \(traffic_index\)/);
});

test("createLaunchpad resolves to the new launchpad's id; deleteLaunchpad removes it", async () => {
  const { api, client } = setup({
    "POST /launchpad": (_, body) => ({ id: "lp9", ...body }),
    "DELETE /launchpad/lp9": { id: "lp9" },
  });
  assert.equal(await api.createLaunchpad("Request 4", "Launchpad for Request 4"), "lp9");
  assert.deepEqual(client.calls[0].body, { name: "Request 4", description: "Launchpad for Request 4" });
  await api.deleteLaunchpad("lp9");
  assert.equal(client.calls[1].method, "DELETE");
});

test("stream events map to the live request, response and upgrade shapes the Ledger patches with", () => {
  assert.deepEqual(
    toRequestEvent({ id: "a", number: 9, scheme: "https", method: "GET", host: "h", path: "/", metadata: {}, requested_at: "t1", sitemap_node: "https://h/" }),
    { ID: "a", Number: 9, Scheme: "https", Method: "GET", Host: "h", Path: "/", Metadata: {}, RequestedAt: "t1", SitemapNode: "https://h/" },
  );
  assert.deepEqual(
    toResponseEvent({ id: "a", status: "101 Switching Protocols", status_code: 101, content_type: "", length: "0", metadata: { protocol: "websocket" }, responded_at: "t2", upstream_proxy: null }),
    { ID: "a", Status: "101 Switching Protocols", StatusCode: 101, ContentType: "", Length: "0", Metadata: { protocol: "websocket" }, RespondedAt: "t2", Route: null },
  );
  assert.deepEqual(
    toUpgradeEvent({ id: "c1", request_id: "a", state: "closed", transport: "http/1.1", close_code: 1000, close_reason: "bye" }),
    { RequestID: "a", State: "closed", Transport: "http/1.1", CloseCode: 1000, CloseReason: "bye" },
  );
  // websocket.handshake_ended carries only the state.
  assert.deepEqual(toUpgradeEvent({ request_id: "a", state: "failed" }), { RequestID: "a", State: "failed" });
});
