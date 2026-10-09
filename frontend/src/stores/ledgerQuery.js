// The ledger's query: the text in the query box and the query results fetched
// from marasi's indexed traffic query, newest first.
//
// Query mode is active exactly when the last query that ran successfully is
// non-empty. The live view (`proxyItems`) is untouched by anything here.
//
// The content-type exclusion is applied by the QueryTraffic binding, which
// reads it from the project config, so it never appears in the query text.
//
// Plain module: no Svelte component dependencies.
import { derived, get, writable } from "svelte/store";
import { QueryTraffic } from "../lib/wailsjs/go/main/App";

/** How long the query box waits after the last keystroke before running. */
export const QUERY_DELAY_MS = 700;

/** The text in the query box. */
export const queryText = writable("");

/** True while the query box's delay timer is waiting to run a query. */
export const queryPending = writable(false);

function emptyQueryState() {
  return {
    // The last query that ran successfully; "" in the live view.
    ranQuery: "",
    // Increases each time a query runs successfully, so the ledger can tell a
    // new run from other changes (for example, to go back to page 1).
    runID: 0,
    // The query results loaded so far, newest first.
    items: [],
    // Cursor for the next older page, or null when none exists.
    nextCursor: null,
    indexComplete: true,
    // True while the next older page is being fetched.
    loadingOlder: false,
    // True when fetching an older page failed. Older pages stop loading until
    // the query runs again.
    olderFailed: false,
    // The last failed query: { query, message, position }, where position is
    // marasi's 1-based character offset into `query`, or null when the failure
    // wasn't in the query text. null when the last query that ran was valid.
    error: null,
  };
}

/** The query's state. Read it; change it through the functions below. */
export const ledgerQuery = writable(emptyQueryState());

/** True when the ledger shows query results instead of the live view. */
export const queryActive = derived(ledgerQuery, ($q) => $q.ranQuery !== "");

/**
 * The page the ledger shows in query mode. The live view keeps its own page in
 * `pagination`, so clearing the query returns to it. Each run starts at 0.
 */
export const queryPageIndex = writable(0);

/**
 * "N matches", or "N+ matches" while older pages remain. "" in the live view.
 */
export const matchCountLabel = derived(ledgerQuery, ($q) => {
  if ($q.ranQuery === "") return "";
  const count = $q.items.length;
  const more = $q.nextCursor ? "+" : "";
  return `${count.toLocaleString()}${more} ${count === 1 && !more ? "match" : "matches"}`;
});

/** The status line under the query box in query mode; "" in the live view. */
export const queryStatusLabel = derived(matchCountLabel, ($label) =>
  $label ? `${$label} · newest first · column sorting off` : "",
);

/** Shown while a query is active and older traffic is still being indexed. */
export const indexWarning = derived(ledgerQuery, ($q) =>
  $q.ranQuery !== "" && !$q.indexComplete
    ? "Indexing older traffic — text matches may be incomplete"
    : "",
);

let delayTimer = null;
// Identifies the newest request, so a slower, older response can't overwrite
// a newer one or a cleared query.
let latestRequest = 0;

function cancelDelay() {
  clearTimeout(delayTimer);
  delayTimer = null;
  queryPending.set(false);
}

/**
 * Runs `text` as the ledger's query now. Blank text returns to the live view
 * instead, because an empty query is never sent. An invalid query records the
 * error and leaves the previous results in place.
 */
export async function runQuery(text = get(queryText)) {
  cancelDelay();
  if (text.trim() === "") {
    clearQuery({ keepText: true });
    return;
  }
  const request = ++latestRequest;
  let result;
  try {
    result = await QueryTraffic(text, null);
  } catch (err) {
    if (request !== latestRequest) return;
    console.error("Querying traffic failed:", err);
    ledgerQuery.update((q) => ({
      ...q,
      error: { query: text, message: String(err), position: null },
    }));
    return;
  }
  if (request !== latestRequest) return;
  if (result.QueryError) {
    ledgerQuery.update((q) => ({
      ...q,
      error: {
        query: text,
        message: result.QueryError.Message,
        position: result.QueryError.Position,
      },
    }));
    return;
  }
  ledgerQuery.update((q) => ({
    ...q,
    ranQuery: text,
    runID: q.runID + 1,
    items: result.Items ?? [],
    nextCursor: result.NextCursor ?? null,
    indexComplete: result.IndexComplete,
    loadingOlder: false,
    olderFailed: false,
    error: null,
  }));
  queryPageIndex.set(0);
}

/**
 * True when the ledger, showing `pageIndex` at `pageSize` rows per page, is on
 * the last loaded page of query results while older pages remain.
 */
export function needsOlderPage(q, pageIndex, pageSize) {
  if (q.ranQuery === "" || !q.nextCursor || q.loadingOlder || q.olderFailed)
    return false;
  const lastLoaded = Math.max(Math.ceil(q.items.length / pageSize) - 1, 0);
  return pageIndex >= lastLoaded;
}

/**
 * Fetches the next older page of query results from the cursor and appends
 * it. The page can come back short or empty while a cursor remains, because
 * some content-type exclusions are applied after marasi returns the page; the
 * caller asks again while `needsOlderPage` holds. A result that arrives after
 * the query ran again or was cleared is dropped.
 */
export async function loadOlderPage() {
  const start = get(ledgerQuery);
  if (start.ranQuery === "" || !start.nextCursor || start.loadingOlder) return;
  const isCurrent = (q) =>
    q.runID === start.runID &&
    q.ranQuery === start.ranQuery &&
    q.nextCursor === start.nextCursor;
  ledgerQuery.update((q) => ({ ...q, loadingOlder: true }));
  let result;
  try {
    result = await QueryTraffic(start.ranQuery, start.nextCursor);
    if (result.QueryError) throw new Error(result.QueryError.Message);
  } catch (err) {
    console.error("Loading older query results failed:", err);
    ledgerQuery.update((q) =>
      isCurrent(q) ? { ...q, loadingOlder: false, olderFailed: true } : q,
    );
    return;
  }
  ledgerQuery.update((q) => {
    if (!isCurrent(q)) return q;
    const loaded = new Set(q.items.map((it) => String(it.ID)));
    const older = (result.Items ?? []).filter((it) => !loaded.has(String(it.ID)));
    return {
      ...q,
      items: [...q.items, ...older],
      nextCursor: result.NextCursor ?? null,
      indexComplete: result.IndexComplete,
      loadingOlder: false,
    };
  });
}

/** Runs the query box's text once it has been left alone for the delay. */
export function scheduleQuery(text = get(queryText)) {
  cancelDelay();
  if (text.trim() === "") {
    clearQuery({ keepText: true });
    return;
  }
  queryPending.set(true);
  delayTimer = setTimeout(() => runQuery(text), QUERY_DELAY_MS);
}

/**
 * Runs the active query again, for example after the content-type exclusion
 * changed. Does nothing in the live view.
 */
export function rerunQuery() {
  const { ranQuery } = get(ledgerQuery);
  if (ranQuery !== "") return runQuery(ranQuery);
}

/**
 * Returns to the live view: empties the query box (unless `keepText`), drops
 * the query results and ignores any query still in flight.
 */
export function clearQuery({ keepText = false } = {}) {
  cancelDelay();
  latestRequest++;
  if (!keepText) queryText.set("");
  ledgerQuery.update((q) => ({ ...emptyQueryState(), runID: q.runID }));
  queryPageIndex.set(0);
}

/**
 * Merges `patch` into the Metadata of the loaded query result with this ID.
 * Does nothing when the pair isn't loaded.
 */
export function patchQueryResultMetadata(id, patch) {
  ledgerQuery.update((q) => {
    const item = q.items.find((it) => String(it.ID) === String(id));
    if (item) item.Metadata = { ...(item.Metadata || {}), ...patch };
    return q;
  });
}

/**
 * Splits an invalid query around marasi's 1-based error position, counting
 * characters rather than UTF-16 units, so the problem can be marked:
 * { before, at, after }. `at` is a space when the position is past the end.
 * Returns null when the error has no position.
 */
export function markQueryError(error) {
  if (!error?.position) return null;
  const chars = Array.from(error.query);
  const index = Math.min(Math.max(error.position - 1, 0), chars.length);
  return {
    before: chars.slice(0, index).join(""),
    at: chars[index] ?? " ",
    after: chars.slice(index + 1).join(""),
  };
}
