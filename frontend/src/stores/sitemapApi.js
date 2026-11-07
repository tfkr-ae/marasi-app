// The sitemap's api over the service client: the object createSitemapStore
// takes. One route, POST /traffic/sitemap/levels, serves both calls; the
// rules the Go binding added on top live here: the project's exclusion when
// a read names none, a query's selection needing its results' as_of, and
// matching mode's counts standing in for the totals.
import { normalizeExclusion } from "./contentTypeExclusion.js";
import { queryErrorOf } from "./trafficApi.js";

/** Marasi's largest sitemap page; a read naming no limit asks for it. */
export const MAX_SITEMAP_PAGE = 500;

function toChild(item, matching) {
  // Matching mode counts only the matches, so they are the counts.
  if (matching && item.matching != null) {
    return {
      Name: item.name,
      Segment: item.segment,
      Pairs: item.matching,
      Errors: item.matching_errors ?? item.errors,
      HasChildren: item.has_children,
      Matching: null,
    };
  }
  return {
    Name: item.name,
    Segment: item.segment,
    Pairs: item.pairs,
    Errors: item.errors,
    HasChildren: item.has_children,
    Matching: item.matching ?? null,
  };
}

export function createSitemapApi(client, { exclusion }) {
  // { Nodes, Cursors, Limit, Query, AsOf, Matching, Exclusion } →
  // { Levels: [{ Node, Children, NextCursor, Missing }], Complete, QueryError }.
  async function listSitemapLevels(req) {
    const list = req.Exclusion == null ? await exclusion.effective() : normalizeExclusion(req.Exclusion);
    const body = { nodes: req.Nodes, scope: req.Matching ? "matching" : "all", exclusion: list };
    if (req.Query) {
      if (!req.AsOf) throw new Error("a query needs the results' as_of");
      body.selection = { query: req.Query, exclusion: list, as_of: req.AsOf };
    } else if (req.Matching) {
      throw new Error("matching mode needs a query");
    }
    if (req.Cursors && Object.keys(req.Cursors).length) body.cursors = req.Cursors;
    body.limit = req.Limit > 0 ? req.Limit : MAX_SITEMAP_PAGE;
    let answer;
    try {
      answer = await client.post("/traffic/sitemap/levels", body);
    } catch (err) {
      const queryError = queryErrorOf(err);
      if (queryError) return { Levels: [], Complete: true, QueryError: queryError };
      throw err;
    }
    return {
      Levels: (answer.levels ?? []).map((level) => ({
        Node: level.node,
        Children: (level.items ?? []).map((item) => toChild(item, req.Matching)),
        NextCursor: level.next_cursor ?? null,
        Missing: Boolean(level.missing),
      })),
      Complete: answer.sitemap?.complete ?? true,
      QueryError: null,
    };
  }

  return {
    listSitemapLevels,
    // { Node, Cursor, Limit, Query, AsOf, Matching, Exclusion } →
    // { Children, NextCursor, Complete, Missing, QueryError }: a levels
    // read of one node.
    async listSitemapChildren(req) {
      const result = await listSitemapLevels({
        Nodes: [req.Node],
        Cursors: req.Cursor ? { [req.Node]: req.Cursor } : {},
        Limit: req.Limit,
        Query: req.Query,
        AsOf: req.AsOf,
        Matching: req.Matching,
        Exclusion: req.Exclusion,
      });
      if (result.QueryError) return { Children: [], NextCursor: null, Complete: true, Missing: false, QueryError: result.QueryError };
      const level = result.Levels[0];
      if (!level || level.Missing) return { Children: [], NextCursor: null, Complete: true, Missing: true, QueryError: null };
      return { Children: level.Children, NextCursor: level.NextCursor, Complete: result.Complete, Missing: false, QueryError: null };
    },
  };
}
