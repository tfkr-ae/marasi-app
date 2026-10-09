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
    // The last failed query: { query, message, position }, where position is
    // marasi's 1-based character offset into `query`, or null when the failure
    // wasn't in the query text. null when the last query that ran was valid.
    error: null,
    // Pairs that match the query but aren't loaded yet, newest first. They
    // join `items` only when merged, so the shown rows don't move.
    newMatches: [],
    // Increases each time new matches are merged into the results.
    mergeID: 0,
  };
}

/** The query's state. Read it; change it through the functions below. */
export const ledgerQuery = writable(emptyQueryState());

/** True when the ledger shows query results instead of the live view. */
export const queryActive = derived(ledgerQuery, ($q) => $q.ranQuery !== "");

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
  trafficChanged = false;
  ledgerQuery.update((q) => ({
    ...q,
    ranQuery: text,
    runID: q.runID + 1,
    items: result.Items ?? [],
    nextCursor: result.NextCursor ?? null,
    indexComplete: result.IndexComplete,
    error: null,
    newMatches: [],
  }));
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
  ledgerQuery.update((q) => ({
    ...emptyQueryState(),
    runID: q.runID,
    mergeID: q.mergeID,
  }));
}

function sameID(a, b) {
  return a != null && b != null && String(a) === String(b);
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
 * Applies `update(item)` to the query result with this ID, in the loaded
 * results and in the new matches. Does nothing when neither holds the pair.
 */
function patchQueryResult(id, update) {
  ledgerQuery.update((q) => {
    let changed = false;
    const patchList = (list) =>
      list.map((item) => {
        if (!sameID(item.ID, id)) return item;
        changed = true;
        return update(item);
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
  patchQueryResult(id, (item) => ({
    ...item,
    Metadata: { ...(item.Metadata || {}), ...patch },
  }));
}

/**
 * Fills in the responses that arrived for loaded query results, in place by
 * pair ID. `responses` maps pair IDs to response summaries. Rows are never
 * removed, even when they no longer match.
 */
export function patchQueryResultResponses(responses) {
  if (responses.size === 0) return;
  ledgerQuery.update((q) => {
    if (q.ranQuery === "") return q;
    let changed = false;
    const patchList = (list) =>
      list.map((item) => {
        const res = responses.get(item.ID);
        if (!res) return item;
        changed = true;
        return { ...item, ...res };
      });
    const items = patchList(q.items);
    const newMatches = patchList(q.newMatches);
    return changed ? { ...q, items, newMatches } : q;
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
  const { ranQuery, runID } = get(ledgerQuery);
  if (ranQuery === "" || !trafficChanged) return;
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
    const loaded = new Set(q.items.map((item) => String(item.ID)));
    const isNew = (item) =>
      !loaded.has(String(item.ID)) &&
      (q.nextCursor == null || String(item.ID) > String(q.nextCursor));
    const fresh = (result.Items ?? []).filter(isNew);
    const freshIDs = new Set(fresh.map((item) => String(item.ID)));
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
 * Merges the new matches into the query results in newest-first order.
 * The ledger goes back to page 1 when `mergeID` changes.
 */
export function mergeNewMatches() {
  ledgerQuery.update((q) => {
    if (q.newMatches.length === 0) return q;
    return {
      ...q,
      items: [...q.items, ...q.newMatches].sort(newestFirst),
      newMatches: [],
      mergeID: q.mergeID + 1,
    };
  });
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
