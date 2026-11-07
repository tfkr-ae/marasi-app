// The sitemap's api over the service client: POST /traffic/sitemap/levels
// mapped to what createSitemapStore reads, with the app-side rules the Go
// binding kept (the project's exclusion when none is given, a query's
// selection needing its as_of, matching mode's counts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeServiceClient as fakeClient } from "./fakeServiceClient.js";
import { createSitemapApi } from "./sitemapApi.js";
import { createExclusion } from "./contentTypeExclusion.js";

const notFound = { status: 404, body: { error: "not_found" } };

const child = (name, extra = {}) => ({
  name,
  segment: name.split("/").pop(),
  pairs: 10,
  errors: 1,
  has_children: true,
  matching: null,
  matching_errors: null,
  ...extra,
});

function setup(levels) {
  const client = fakeClient({
    "GET /client-settings/marasi-app/ledger.exclusion": notFound,
    "POST /traffic/sitemap/levels": levels,
  });
  const exclusion = createExclusion(client, { getDefaultExclusion: async () => ["image/*"], setDefaultExclusion: async () => {} });
  return { client, api: createSitemapApi(client, { exclusion }) };
}

test("listSitemapLevels reads all traffic's levels in the store's shape", async () => {
  const { api, client } = setup({
    levels: [
      { node: "", items: [child("https://a.test", { matching: 4 })], next_cursor: "c1", missing: false },
      { node: "https://gone.test", items: [], next_cursor: null, missing: true },
    ],
    sitemap: { complete: false },
  });
  const result = await api.listSitemapLevels({
    Nodes: ["", "https://gone.test"],
    Cursors: {},
    Limit: 50,
    Query: "method = \"GET\"",
    AsOf: "0190",
    Matching: false,
    Exclusion: ["Text/CSS"],
  });
  assert.deepEqual(client.calls.at(-1).body, {
    nodes: ["", "https://gone.test"],
    scope: "all",
    exclusion: ["text/css"],
    selection: { query: 'method = "GET"', exclusion: ["text/css"], as_of: "0190" },
    limit: 50,
  });
  assert.deepEqual(result, {
    Levels: [
      {
        Node: "",
        Children: [{ Name: "https://a.test", Segment: "https://a.test".split("/").pop(), Pairs: 10, Errors: 1, HasChildren: true, Matching: 4 }],
        NextCursor: "c1",
        Missing: false,
      },
      { Node: "https://gone.test", Children: [], NextCursor: null, Missing: true },
    ],
    Complete: false,
    QueryError: null,
  });
});

test("without an exclusion the project's own applies, and no query sends no selection", async () => {
  const { api, client } = setup({ levels: [{ node: "", items: [], next_cursor: null, missing: false }], sitemap: { complete: true } });
  await api.listSitemapLevels({ Nodes: [""], Cursors: { "": "c9" }, Limit: 0, Query: "", AsOf: "", Matching: false, Exclusion: null });
  assert.deepEqual(client.calls.at(-1).body, { nodes: [""], scope: "all", exclusion: ["image/*"], cursors: { "": "c9" }, limit: 500 });
});

test("matching mode counts only the matches", async () => {
  const { api, client } = setup({
    levels: [{ node: "", items: [child("https://a.test", { matching: 3, matching_errors: 0 })], next_cursor: null, missing: false }],
    sitemap: { complete: true },
  });
  const result = await api.listSitemapLevels({ Nodes: [""], Cursors: {}, Limit: 10, Query: "x", AsOf: "0190", Matching: true, Exclusion: [] });
  assert.equal(client.calls.at(-1).body.scope, "matching");
  const [only] = result.Levels[0].Children;
  assert.equal(only.Pairs, 3);
  assert.equal(only.Errors, 0);
  assert.equal(only.Matching, null);
});

test("a query without its results' as_of is refused before reading", async () => {
  const { api, client } = setup({});
  await assert.rejects(
    api.listSitemapLevels({ Nodes: [""], Cursors: {}, Limit: 10, Query: "x", AsOf: "", Matching: false, Exclusion: [] }),
    /as_of/,
  );
  assert.equal(client.calls.length, 0);
});

test("an invalid query comes back as data", async () => {
  const { api } = setup({ status: 400, body: { error: "invalid_query", message: "bad", position: 2 } });
  const result = await api.listSitemapLevels({ Nodes: [""], Cursors: {}, Limit: 10, Query: "(", AsOf: "0190", Matching: false, Exclusion: [] });
  assert.deepEqual(result.QueryError, { Message: "bad", Position: 2 });
});

test("listSitemapChildren reads one node's page; a node that's gone is empty", async () => {
  const { api, client } = setup((_, body) => ({
    levels: [
      body.nodes[0] === "https://gone.test"
        ? { node: body.nodes[0], items: [], next_cursor: null, missing: true }
        : { node: body.nodes[0], items: [child("https://a.test/v1")], next_cursor: "c2", missing: false },
    ],
    sitemap: { complete: false },
  }));
  const page = await api.listSitemapChildren({ Node: "https://a.test", Cursor: "c1", Limit: 25, Query: "", AsOf: "", Matching: false, Exclusion: [] });
  assert.deepEqual(client.calls.at(-1).body.cursors, { "https://a.test": "c1" });
  assert.equal(page.Children[0].Name, "https://a.test/v1");
  assert.equal(page.NextCursor, "c2");
  assert.equal(page.Complete, false);
  assert.equal(page.Missing, false);

  const gone = await api.listSitemapChildren({ Node: "https://gone.test", Cursor: "", Limit: 25, Query: "", AsOf: "", Matching: false, Exclusion: [] });
  assert.deepEqual(gone, { Children: [], NextCursor: null, Complete: true, Missing: true, QueryError: null });
});
