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
    // Pairs that match the query but aren't loaded yet, newest first. They
    // join `items` only when merged, so the shown rows don't move.
    newMatches: [],
  };
}

/** The query's state. Read it; change it through the functions below. */
export const ledgerQuery = writable(emptyQueryState());

/** True when the query state `q` shows query results instead of the live view. */
export function isQueryActive(q) {
  return q.ranQuery !== "";
}

/** True when the ledger shows query results instead of the live view. */
export const queryActive = derived(ledgerQuery, isQueryActive);

/** True when both are pair IDs and they name the same pair. */
export function sameID(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/** The IDs of `items`, as strings. */
export function pairIDSet(items) {
  return new Set(items.map((item) => String(item.ID)));
}

/** "match" or "matches" for `count`; `more` means there could be more. */
export function matchNoun(count, more = false) {
  return count === 1 && !more ? "match" : "matches";
}

/**
 * The page the ledger shows in query mode. The live view keeps its own page in
 * `pagination`, so clearing the query returns to it. Each run starts at 0.
 */
export const queryPageIndex = writable(0);

/**
 * "N matches", or "N+ matches" while older pages remain. "" in the live view.
 */
export const matchCountLabel = derived(ledgerQuery, ($q) => {
  if (!isQueryActive($q)) return "";
  const count = $q.items.length;
  const more = $q.nextCursor ? "+" : "";
  return `${count.toLocaleString()}${more} ${matchNoun(count, !!more)}`;
});

/** The status line under the query box in query mode; "" in the live view. */
export const queryStatusLabel = derived(matchCountLabel, ($label) =>
  $label ? `${$label} · newest first · column sorting off` : "",
);

/** Shown while a query is active and older traffic is still being indexed. */
export const indexWarning = derived(ledgerQuery, ($q) =>
  isQueryActive($q) && !$q.indexComplete
    ? "Indexing older traffic — text matches may be incomplete"
    : "",
);

/** How often query mode checks for new matches after traffic changed. */
export const NEW_MATCHES_POLL_MS = 5000;

// Set by request and response events and by edits made in the app; cleared
// when the newest page of the query is fetched.
let trafficChanged = false;

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
  let failure = null;
  try {
    result = await QueryTraffic(text, null);
    if (result.QueryError) {
      failure = {
        message: result.QueryError.Message,
        position: result.QueryError.Position,
      };
    }
  } catch (err) {
    console.error("Querying traffic failed:", err);
    failure = { message: String(err), position: null };
  }
  if (request !== latestRequest) return;
  if (failure) {
    ledgerQuery.update((q) => ({ ...q, error: { query: text, ...failure } }));
    return;
  }
  trafficChanged = false;
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
    newMatches: [],
  }));
  queryPageIndex.set(0);
}

/**
 * True when the ledger, showing `pageIndex` at `pageSize` rows per page, is on
 * the last loaded page of query results while older pages remain.
 */
export function needsOlderPage(q, pageIndex, pageSize) {
  if (!isQueryActive(q) || !q.nextCursor || q.loadingOlder || q.olderFailed)
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
  if (!isQueryActive(start) || !start.nextCursor || start.loadingOlder) return;
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
    const loaded = pairIDSet(q.items);
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
  const q = get(ledgerQuery);
  if (isQueryActive(q)) return runQuery(q.ranQuery);
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

// Pair IDs are UUIDv7 strings, so comparing them as strings orders pairs by
// capture time, the same order marasi returns query results in.
function newestFirst(a, b) {
  const x = String(a.ID);
  const y = String(b.ID);
  return x < y ? 1 : x > y ? -1 : 0;
}

/**
 * Records that traffic changed: a request or response arrived, or a pair was
 * edited in the app. The next poll in query mode then checks for new matches.
 */
export function markTrafficChanged() {
  trafficChanged = true;
}

/**
 * Applies `update(item)` to every loaded query result and new match.
 * `update` returns the item itself to leave it alone, or a replacement.
 * Subscribers are notified only when something was replaced.
 */
function patchQueryResults(update) {
  ledgerQuery.update((q) => {
    let changed = false;
    const patchList = (list) =>
      list.map((item) => {
        const patched = update(item);
        if (patched !== item) changed = true;
        return patched;
      });
    const items = patchList(q.items);
    const newMatches = patchList(q.newMatches);
    return changed ? { ...q, items, newMatches } : q;
  });
}

/**
 * Merges `patch` into the Metadata of the query result with this ID.
 * Does nothing when the pair isn't loaded.
 */
export function patchQueryResultMetadata(id, patch) {
  patchQueryResults((item) =>
    sameID(item.ID, id)
      ? { ...item, Metadata: { ...(item.Metadata || {}), ...patch } }
      : item,
  );
}

/**
 * Fills in the responses that arrived for loaded query results, in place by
 * pair ID. `responses` maps pair IDs to response summaries. Rows are never
 * removed, even when they no longer match.
 */
export function patchQueryResultResponses(responses) {
  if (responses.size === 0 || !isQueryActive(get(ledgerQuery))) return;
  patchQueryResults((item) => {
    const res = responses.get(item.ID);
    return res ? { ...item, ...res } : item;
  });
}

/**
 * Checks for new matches when traffic changed since the last check: fetches
 * the newest page of the active query and keeps the pairs that aren't loaded
 * as new matches. Pairs older than the next page's cursor are left out,
 * because loading older pages brings them in. Does nothing in the live view
 * or when traffic hasn't changed.
 */
export async function checkForNewMatches() {
  const start = get(ledgerQuery);
  if (!isQueryActive(start) || !trafficChanged) return;
  const { ranQuery, runID } = start;
  trafficChanged = false;
  let result;
  try {
    result = await QueryTraffic(ranQuery, null);
  } catch (err) {
    console.error("Checking for new matches failed:", err);
    trafficChanged = true;
    return;
  }
  if (result.QueryError) return;
  ledgerQuery.update((q) => {
    // A different query ran, or the ledger went back to the live view.
    if (q.ranQuery !== ranQuery || q.runID !== runID) return q;
    const loaded = pairIDSet(q.items);
    const isNew = (item) =>
      !loaded.has(String(item.ID)) &&
      (q.nextCursor == null || String(item.ID) > String(q.nextCursor));
    const fresh = (result.Items ?? []).filter(isNew);
    const freshIDs = pairIDSet(fresh);
    // Earlier new matches can fall off the newest page when a lot of
    // traffic arrives; keep them.
    const kept = q.newMatches.filter(
      (item) => isNew(item) && !freshIDs.has(String(item.ID)),
    );
    return {
      ...q,
      newMatches: [...fresh, ...kept].sort(newestFirst),
      indexComplete: result.IndexComplete,
    };
  });
}

/**
 * Merges the new matches into the query results in newest-first order and
 * goes back to page 1 of the query results.
 */
export function mergeNewMatches() {
  if (get(ledgerQuery).newMatches.length === 0) return;
  ledgerQuery.update((q) => ({
    ...q,
    items: [...q.items, ...q.newMatches].sort(newestFirst),
    newMatches: [],
  }));
  queryPageIndex.set(0);
}

// Polls for new matches only while query mode is active.
if (typeof window !== "undefined") {
  let pollTimer = null;
  queryActive.subscribe((active) => {
    if (active && pollTimer === null) {
      pollTimer = setInterval(checkForNewMatches, NEW_MATCHES_POLL_MS);
    } else if (!active && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
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
