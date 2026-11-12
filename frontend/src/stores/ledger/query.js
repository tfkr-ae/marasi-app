// The query box and the sort: running, delaying and clearing queries, back to live, and counting a query's matches.
import { toggleQueryTerm } from "../../lib/ledgerQueryFields.js";
import { DEFAULT_SORT, emptyQueryState } from "./state.js";
import { isLiveNewestFirst, isQueryActive } from "./selectors.js";

/** How long the query box waits after the last keystroke before running. */
export const QUERY_DELAY_MS = 700;

// Fields a header click sorts newest first rather than ascending.
const NEWEST_FIRST_FIELDS = new Set(["number", "requested_at"]);

/** The query over the window `win`, which reads its results. */
export function createQuery(core, api, win) {
  const { update, track } = core;
  const { readFirstPage, reload } = win;

  let delayTimer = null;
  // Identifies the newest query request, so a slower, older response can't
  // overwrite a newer one or a cleared query.
  let latestRequest = 0;

  function cancelDelay() {
    clearTimeout(delayTimer);
    delayTimer = null;
    if (core.current.queryPending) update((state) => ({ ...state, queryPending: false }));
  }

  /**
   * Runs `text` as the ledger's query now. Blank text returns to the live
   * view instead, because an empty query is never sent. An invalid query
   * records the error and leaves the previous results in place.
   */
  async function runQuery(text = core.current.queryText) {
    cancelDelay();
    if (text.trim() === "") return clearQuery({ keepText: true });
    const request = ++latestRequest;
    const failure = await track(
      readFirstPage(text, {
        onSuccess: (state) => ({
          ...state,
          query: { ...state.query, ranQuery: text, runID: state.query.runID + 1, error: null },
        }),
      }),
    );
    if (request !== latestRequest || !failure) return;
    update((state) => ({ ...state, query: { ...state.query, error: { query: text, ...failure } } }));
  }

  /** Runs the query box's text once it has been left alone for the delay. */
  function scheduleQuery(text = core.current.queryText) {
    cancelDelay();
    if (text.trim() === "") {
      clearQuery({ keepText: true });
      return;
    }
    update((state) => ({ ...state, queryPending: true }));
    delayTimer = setTimeout(() => runQuery(text), QUERY_DELAY_MS);
  }

  /** Reads the active results again, for example after the exclusion changed. */
  function rerunQuery() {
    return reload();
  }

  /**
   * Returns to the live view: empties the query box (unless `keepText`),
   * ignores any query still in flight and reads the live view from the top.
   */
  function clearQuery({ keepText = false } = {}) {
    cancelDelay();
    latestRequest++;
    const wasActive = isQueryActive(core.current.query);
    update((state) => ({
      ...state,
      queryText: keepText ? state.queryText : "",
      query: { ...emptyQueryState(state.query.runID) },
    }));
    if (wasActive || core.current.results.loading) return reload();
    return Promise.resolve();
  }

  /**
   * Back to the newest-first live view: empties the query (and with it any
   * mark, highlight, sitemap or saved-query term), restores the default sort
   * and reads from the top. Nothing is read when the table already shows it.
   */
  function backToLive() {
    if (isLiveNewestFirst(core.current) && !core.current.queryText && !core.current.results.loading) {
      return Promise.resolve();
    }
    cancelDelay();
    latestRequest++;
    win.viewport = { first: 0, last: 0, atTop: true };
    update((state) => ({
      ...state,
      queryText: "",
      query: { ...emptyQueryState(state.query.runID) },
      sort: DEFAULT_SORT,
    }));
    return reload();
  }

  /**
   * Sorts by a Marasi order_by field. The same field again reverses it;
   * another starts newest first for number and requested_at, and ascending
   * otherwise.
   * A cursor only works with its sort, so the rows load from the top.
   */
  function sortBy(field) {
    update((state) => {
      const sort =
        state.sort.field === field
          ? { field, desc: !state.sort.desc }
          : { field, desc: NEWEST_FIRST_FIELDS.has(field) };
      return { ...state, sort };
    });
    // A sort only reorders the results, so their count stands.
    return reload({ reuseCount: true });
  }

  return {
    runQuery,
    scheduleQuery,
    rerunQuery,
    clearQuery,
    backToLive,
    sortBy,
    setQueryText: (queryText) => update((state) => ({ ...state, queryText })),

    /**
     * Adds `term` to the query box, or removes it when the query has it as a
     * condition of its own, and runs the result at once (a menu's choice).
     */
    toggleQueryTerm: (term) => {
      const text = toggleQueryTerm(core.current.queryText, term);
      update((state) => ({ ...state, queryText: text }));
      return runQuery(text);
    },

    /**
     * Counts the pairs `query` matches, minus the content-type exclusion:
     * { count, capped }, or null when it failed. Counts stop at marasi's
     * cap, 100,000; `capped` means more matched.
     */
    countQuery: async (query) => {
      try {
        const result = await api.countTraffic(query, "");
        return result.QueryError ? null : { count: result.Count, capped: result.Capped };
      } catch (err) {
        console.error(`Counting matches for ${query} failed:`, err);
        return null;
      }
    },

    // A project switch: a waiting or running query is dropped.
    reset: () => {
      cancelDelay();
      latestRequest++;
    },
  };
}
