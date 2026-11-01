// The sitemap's bindings: both read Marasi's POST /traffic/sitemap/levels,
// as v1 read the library's ListSitemapLevels, and answer in v1's shapes.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const request = { method, path: parsed.pathname, body: init.body ? JSON.parse(init.body) : undefined };
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

const child = (name, segment, pairs, extra = {}) => ({
  name,
  segment,
  pairs,
  errors: 0,
  has_children: true,
  matching: null,
  matching_errors: null,
  ...extra,
});

test("ListSitemapLevels reads all traffic minus the exclusion, in v1's shape", async () => {
  answers["POST /traffic/sitemap/levels"] = {
    levels: [
      { node: "", items: [child("https://a.test", "https://a.test", 7, { errors: 2 })], next_cursor: "c1", missing: false },
      { node: "https://a.test", items: [child("https://a.test/v1", "v1", 3, { has_children: false })], next_cursor: null, missing: false },
    ],
    sitemap: { complete: false },
  };
  const result = await App.ListSitemapLevels({
    Nodes: ["", "https://a.test"],
    Cursors: {},
    Limit: 500,
    Query: "",
    AsOf: "",
    Matching: false,
    Exclusion: ["Image/*"],
  });
  assert.deepEqual(sent.at(-1).body, {
    nodes: ["", "https://a.test"],
    scope: "all",
    exclusion: ["image/*"],
    cursors: {},
    limit: 500,
  });
  assert.deepEqual(result, {
    Levels: [
      {
        Node: "",
        Children: [{ Name: "https://a.test", Segment: "https://a.test", Pairs: 7, Errors: 2, HasChildren: true, Matching: null }],
        NextCursor: "c1",
        Missing: false,
      },
      {
        Node: "https://a.test",
        Children: [{ Name: "https://a.test/v1", Segment: "v1", Pairs: 3, Errors: 0, HasChildren: false, Matching: null }],
        NextCursor: null,
        Missing: false,
      },
    ],
    Complete: false,
    QueryError: null,
  });
});

const queried = {
  Nodes: [""],
  Cursors: { "": "c0" },
  Limit: 500,
  Query: 'method = "POST"',
  AsOf: "019a0000-0000-7000-8000-000000000009",
  Exclusion: ["image/*"],
};

test("ListSitemapLevels with a query adds each child's matching count in All traffic", async () => {
  answers["POST /traffic/sitemap/levels"] = {
    levels: [{ node: "", items: [child("https://a.test", "https://a.test", 7, { errors: 2, matching: 4, matching_errors: 1 })], next_cursor: null, missing: false }],
    sitemap: { complete: true },
  };
  const result = await App.ListSitemapLevels({ ...queried, Matching: false });
  assert.deepEqual(sent.at(-1).body, {
    nodes: [""],
    scope: "all",
    exclusion: ["image/*"],
    selection: { query: 'method = "POST"', exclusion: ["image/*"], as_of: "019a0000-0000-7000-8000-000000000009" },
    cursors: { "": "c0" },
    limit: 500,
  });
  assert.deepEqual(result.Levels[0].Children, [
    { Name: "https://a.test", Segment: "https://a.test", Pairs: 7, Errors: 2, HasChildren: true, Matching: 4 },
  ]);
});

test("ListSitemapLevels Matching the query counts only the matches", async () => {
  answers["POST /traffic/sitemap/levels"] = {
    levels: [{ node: "", items: [child("https://a.test", "https://a.test", 7, { errors: 2, matching: 4, matching_errors: 1 })], next_cursor: null, missing: false }],
    sitemap: { complete: true },
  };
  const result = await App.ListSitemapLevels({ ...queried, Matching: true });
  assert.equal(sent.at(-1).body.scope, "matching");
  assert.deepEqual(result.Levels[0].Children, [
    { Name: "https://a.test", Segment: "https://a.test", Pairs: 4, Errors: 1, HasChildren: true, Matching: null },
  ]);
});

test("ListSitemapLevels answers an invalid query as v1's QueryError", async () => {
  answers["POST /traffic/sitemap/levels"] = () =>
    json({ error: "invalid_query", message: "unknown field nope", position: 3 }, 400);
  const result = await App.ListSitemapLevels({ ...queried, Query: "nope = 1", Matching: false });
  assert.deepEqual(result.QueryError, { Message: "unknown field nope", Position: 3 });
});

test("ListSitemapChildren reads one node's page from its cursor, in v1's shape", async () => {
  answers["POST /traffic/sitemap/levels"] = {
    levels: [{ node: "https://a.test", items: [child("https://a.test/v1", "v1", 3)], next_cursor: "c2", missing: false }],
    sitemap: { complete: false },
  };
  const result = await App.ListSitemapChildren({
    Node: "https://a.test",
    Cursor: "c1",
    Limit: 500,
    Query: "",
    AsOf: "",
    Matching: false,
    Exclusion: [],
  });
  assert.deepEqual(sent.at(-1).body, {
    nodes: ["https://a.test"],
    scope: "all",
    exclusion: [],
    cursors: { "https://a.test": "c1" },
    limit: 500,
  });
  assert.deepEqual(result, {
    Children: [{ Name: "https://a.test/v1", Segment: "v1", Pairs: 3, Errors: 0, HasChildren: true, Matching: null }],
    NextCursor: "c2",
    Complete: false,
    Missing: false,
    QueryError: null,
  });
});

test("ListSitemapChildren of a node that's gone answers Missing with no children", async () => {
  answers["POST /traffic/sitemap/levels"] = {
    levels: [{ node: "https://gone.test", items: [], next_cursor: null, missing: true }],
    sitemap: { complete: false },
  };
  const result = await App.ListSitemapChildren({ Node: "https://gone.test", Cursor: "", Exclusion: [] });
  assert.deepEqual(sent.at(-1).body.cursors, {});
  assert.deepEqual(result, { Children: [], NextCursor: null, Complete: true, Missing: true, QueryError: null });
});
