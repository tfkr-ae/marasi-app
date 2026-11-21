// Traffic as the tool pages read it (lib/tools): the rows of the pairs on a
// drawing's cards, and the Insert panel's newest pairs for a query. Rows
// are the Ledger's shape (trafficApi.js's toRow).
import { readTraffic } from "./trafficApi.js";

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
    /** The newest pairs matching `query`: { Items, QueryError }. */
    readList: (query) => newest(client, query, TRAFFIC_LIST_LIMIT),
  };
}
