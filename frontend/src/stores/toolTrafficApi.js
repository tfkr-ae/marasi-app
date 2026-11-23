// Traffic as the tool pages read it (lib/tools): the rows of the pairs on a
// drawing's cards, and the Insert panel's newest pairs for a query. Rows
// are the Ledger's shape (trafficApi.js's toRow).
import { RAW_ONLY, pairQuery, readTraffic, toDetails } from "./trafficApi.js";
import { pairText } from "../lib/tools/cyberchef/send.js";

// Resolves to null when the service answers not_found.
async function orNull(promise) {
  try {
    return await promise;
  } catch (err) {
    if (err?.code === "not_found") return null;
    throw err;
  }
}

/** The most pairs one query asks for by id. */
export const PAIR_ROWS_CHUNK = 50;
/** How many of the newest pairs the Insert panel lists. */
export const TRAFFIC_LIST_LIMIT = 100;

const newest = (client, query, limit) =>
  readTraffic(client, { Query: query, OrderBy: "", Direction: "backward", Cursor: "", AsOf: "", Limit: limit }, null);

/** A Marasi query for the pairs with these ids. */
export const idsQuery = (ids) => ids.map((id) => `id = ${JSON.stringify(String(id))}`).join(" OR ");

export function createToolTrafficApi(client) {
  return {
    /** The client bound to its connection now (boundAction.js). */
    bind: () => client.bind?.(),
    /** The rows of the pairs `ids` (at most PAIR_ROWS_CHUNK) the service still has. */
    async readPairs(ids) {
      const page = await newest(client, idsQuery(ids), ids.length);
      if (page.QueryError) throw new Error(page.QueryError.Message);
      return page.Items;
    },
    /**
     * Pair `id`'s raw messages, as CyberChef's Insert reads them (raw only):
     * { Request, Response } with LF line endings, Response "" while it has
     * none; null when the service no longer has the pair.
     */
    async readRaw(id) {
      const pair = await orNull(client.get(`/traffic/${id}`, pairQuery(RAW_ONLY)));
      if (!pair) return null;
      const details = toDetails(pair);
      return { Request: pairText(details.Request.Raw), Response: pairText(details.Response.Raw) };
    },
    /** The newest pairs matching `query`: { Items, QueryError }. */
    readList: (query) => newest(client, query, TRAFFIC_LIST_LIMIT),
  };
}
