// The results window: reading pages of the live view or a query by cursor, trimming the window, counting the results and new matches.
import { pairIDSet } from "../../lib/ledger/pairs.js";
import { emptyResults, locate, tableRows } from "./state.js";
import { newMatchesKind } from "./selectors.js";

// New matches are counted on a debounce: each traffic event restarts a
// NEW_MATCHES_DELAY_MS wait, so a burst is counted once it pauses. Under
// steady traffic that never pauses, the count still runs once
// NEW_MATCHES_MAX_WAIT_MS has passed since the first uncounted event.

/** How long traffic must pause before new matches are counted. */
export const NEW_MATCHES_DELAY_MS = 500;

/** The longest new matches wait to be counted under steady traffic. */
export const NEW_MATCHES_MAX_WAIT_MS = 3000;

/** Rows per ListTraffic page. */
export const PAGE_SIZE = 200;

/** The most rows the window keeps; pages far from the rows in view go. */
export const MAX_WINDOW_ROWS = PAGE_SIZE * 5;

/** Marasi's largest page; a refresh in place reads at most this many. */
const MAX_PAGE_ROWS = 1000;

/** How close to the window's edge the rows in view get before the next page loads. */
export const EDGE_ROWS = 60;

/** Marasi's order_by for a sort. */
export function orderBy(sort) {
  return sort.desc ? `${sort.field} desc` : sort.field;
}

/**
 * The window over `api`. `exclusionLoaded()` settles once the project's
 * exclusion has loaded; counts wait for it. Navigation's jumps read a fresh
 * window themselves through `beginRead`, `isLatest`, `endRead`, `nextReset`
 * and `viewport`.
 */
export function createWindow(core, api, { exclusionLoaded }) {
  const { update, updateResults, track } = core;

  // Counts reads from the top, for `results.reset`.
  let resets = 0;
  // Identifies the current set of results. Each reload bumps it, so a page
  // or count read for older results is dropped.
  let generation = 0;
  // The rows in view, as indexes into the window, and whether the table is
  // scrolled to its very top. The table reports them as it scrolls.
  let viewport = { first: 0, last: 0, atTop: true };
  let loadingForward = false;
  let loadingBackward = false;
  // True while a fresh set of results is being read; pages for the old
  // window don't load meanwhile.
  let reading = false;
  // The generation of the latest first-page read.
  let firstPageGen = 0;

  // The new-match count's debounce, and its max wait.
  let newMatchesTimer = null;
  let newMatchesMaxTimer = null;

  function pageRequest(query, sort, extra) {
    return {
      Query: query,
      OrderBy: orderBy(sort),
      Cursor: "",
      Direction: "forward",
      AsOf: "",
      Limit: PAGE_SIZE,
      ...extra,
    };
  }

  // The results of a first page read from `cursor` ("" for the top).
  function resultsFromPage(page, cursor) {
    return {
      ...emptyResults(),
      chunks: [{ items: page.Items ?? [], first: cursor ? page.PrevCursor ?? null : null, last: page.NextCursor ?? null }],
      hasBefore: Boolean(cursor),
      hasAfter: page.NextCursor != null,
      start: cursor ? null : 0,
      asOf: page.AsOf || null,
      shownAsOf: page.AsOf || null,
      loading: false,
      indexComplete: page.IndexComplete ?? true,
    };
  }

  // Counts the results, and the pairs among them the exclusion hides. The
  // count never holds up the rows.
  async function loadCount(gen) {
    await exclusionLoaded();
    if (gen !== generation) return;
    const { query, results, exclusion } = core.current;
    const asOf = results.shownAsOf ?? "";
    try {
      const [counted, all] = await Promise.all([
        api.countTraffic(query.ranQuery, "", { AsOf: asOf }),
        exclusion.length
          ? api.countTraffic(query.ranQuery, "", { AsOf: asOf, IgnoreExclusion: true })
          : null,
      ]);
      if (gen !== generation || counted.QueryError) return;
      const hidden = !all ? 0 : all.Capped || counted.Capped || all.QueryError ? null : all.Count - counted.Count;
      updateResults((r) => ({
        ...r,
        count: { count: counted.Count, capped: counted.Capped },
        hidden,
      }));
    } catch (err) {
      console.error("Counting traffic failed:", err);
    }
  }

  /**
   * Reads the first page of `text` under the current sort into a fresh
   * window, then counts it. Returns the query error, if any, and leaves
   * the earlier results in place when there is one.
   */
  async function readFirstPage(text, { onSuccess } = {}) {
    const gen = ++generation;
    firstPageGen = gen;
    loadingForward = loadingBackward = false;
    reading = true;
    if (!core.current.querying) update((state) => ({ ...state, querying: true }));
    // Another kind of read (a jump, rows read again in place) can take
    // over; `querying` still clears once no first-page read is left.
    const settleStale = () => {
      if (firstPageGen === gen && core.current.querying) update((state) => ({ ...state, querying: false }));
    };
    let page;
    try {
      page = await api.queryTraffic(pageRequest(text, core.current.sort));
    } catch (err) {
      console.error("Reading traffic failed:", err);
      if (gen === generation) {
        reading = false;
        update((state) => ({
          ...state,
          querying: false,
          results: { ...state.results, loading: false, failed: true },
        }));
      } else settleStale();
      return { message: String(err), position: null };
    }
    if (gen !== generation) {
      settleStale();
      return null;
    }
    reading = false;
    if (page.QueryError) {
      update((state) => ({ ...state, querying: false }));
      return { message: page.QueryError.Message, position: page.QueryError.Position };
    }
    viewport = { first: 0, last: 0, atTop: true };
    update((state) => ({
      ...(onSuccess ? onSuccess(state) : state),
      querying: false,
      results: { ...resultsFromPage(page, ""), reset: ++resets },
    }));
    await loadCount(gen);
    return null;
  }

  /** Reads the current results again from the top. */
  function reload() {
    return track(readFirstPage(core.current.query.ranQuery));
  }

  // Drops pages far from the rows in view until the window fits. A page
  // goes only when its neighbour has the cursor to read it back.
  function trim(results) {
    let { chunks, start, hasBefore, hasAfter } = results;
    let total = chunks.reduce((n, chunk) => n + chunk.items.length, 0);
    if (total <= MAX_WINDOW_ROWS) return results;
    chunks = [...chunks];
    while (total > MAX_WINDOW_ROWS && chunks.length > 1) {
      const above = viewport.first;
      const below = total - viewport.last;
      const canDropTop = chunks[1].first != null && chunks[0].items.length <= above;
      const lastChunk = chunks.at(-1);
      const canDropBottom =
        chunks.at(-2).last != null && lastChunk.items.length <= below;
      if (canDropTop && (above >= below || !canDropBottom)) {
        const dropped = chunks.shift().items.length;
        total -= dropped;
        start = start == null ? null : start + dropped;
        hasBefore = true;
        viewport = { ...viewport, first: viewport.first - dropped, last: viewport.last - dropped };
      } else if (canDropBottom) {
        total -= chunks.pop().items.length;
        hasAfter = true;
      } else {
        break;
      }
    }
    return { ...results, chunks, start, hasBefore, hasAfter };
  }

  /** Loads the page below the window. */
  async function loadForward() {
    const r = core.current.results;
    const edge = r.chunks.at(-1)?.last;
    if (!r.hasAfter || !edge || loadingForward || reading || r.failed) return;
    const gen = generation;
    loadingForward = true;
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(core.current.query.ranQuery, core.current.sort, { Cursor: edge, AsOf: r.asOf ?? "" }),
      );
      if (page.QueryError) throw new Error(page.QueryError.Message);
    } catch (err) {
      console.error("Loading more traffic failed:", err);
      if (gen === generation) {
        loadingForward = false;
        updateResults((r) => ({ ...r, failed: true }));
      }
      return;
    }
    if (gen !== generation) return;
    loadingForward = false;
    updateResults((r) => {
      const loaded = pairIDSet(tableRows(core.current));
      const items = (page.Items ?? []).filter((item) => !loaded.has(String(item.ID)));
      return trim({
        ...r,
        chunks: [...r.chunks, { items, first: page.PrevCursor ?? edge, last: page.NextCursor ?? null }],
        hasAfter: page.NextCursor != null,
        indexComplete: page.IndexComplete ?? r.indexComplete,
      });
    });
  }

  /** Loads the page above the window. */
  async function loadBackward() {
    const r = core.current.results;
    if (!r.hasBefore || loadingBackward || reading || r.failed) return;
    const edge = r.chunks[0]?.first;
    // Only a page read from the top lacks its first cursor; the rows above
    // it are new pairs, so read the top again.
    if (!edge) return reload();
    const gen = generation;
    loadingBackward = true;
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(core.current.query.ranQuery, core.current.sort, {
          Cursor: edge,
          Direction: "backward",
          AsOf: r.asOf ?? "",
        }),
      );
      if (page.QueryError) throw new Error(page.QueryError.Message);
    } catch (err) {
      console.error("Loading earlier traffic failed:", err);
      if (gen === generation) {
        loadingBackward = false;
        updateResults((r) => ({ ...r, failed: true }));
      }
      return;
    }
    if (gen !== generation) return;
    loadingBackward = false;
    const loaded = pairIDSet(tableRows(core.current));
    const items = (page.Items ?? []).filter((item) => !loaded.has(String(item.ID)));
    const hasBefore = page.PrevCursor != null;
    viewport = { ...viewport, first: viewport.first + items.length, last: viewport.last + items.length };
    updateResults((r) =>
      trim({
        ...r,
        chunks: [{ items, first: page.PrevCursor ?? null, last: page.NextCursor ?? edge }, ...r.chunks],
        hasBefore,
        start: !hasBefore ? 0 : r.start == null ? null : r.start - items.length,
        indexComplete: page.IndexComplete ?? r.indexComplete,
      }),
    );
  }

  // Loads what the rows in view need: the page past either edge they near,
  // or, back at the top of the newest-first live view, the new pairs.
  function loadAround() {
    const r = core.current.results;
    if (r.loading || reading) return;
    const rows = tableRows(core.current);
    if (
      newMatchesKind(core.current) === "top" &&
      viewport.atTop &&
      !r.hasBefore &&
      r.newCount > 0
    ) {
      reload();
      return;
    }
    if (r.hasAfter && viewport.last >= rows.length - EDGE_ROWS) track(loadForward());
    if (r.hasBefore && viewport.first < EDGE_ROWS) track(loadBackward());
  }

  function cancelNewMatches() {
    clearTimeout(newMatchesTimer);
    clearTimeout(newMatchesMaxTimer);
    newMatchesTimer = newMatchesMaxTimer = null;
  }

  /** Counts the matches captured after the newest pair the table shows. */
  async function countNewMatches() {
    cancelNewMatches();
    const gen = generation;
    const r = core.current.results;
    if (r.loading || reading) return;
    let counted;
    try {
      counted = await api.countTraffic(core.current.query.ranQuery, r.shownAsOf ?? "");
    } catch (err) {
      console.error("Counting new matches failed:", err);
      return;
    }
    if (gen !== generation || counted.QueryError) return;
    updateResults((r) => ({ ...r, newCount: counted.Count, newCapped: counted.Capped }));
    loadAround();
  }

  // Debounces the new-match count: see NEW_MATCHES_DELAY_MS.
  function scheduleNewMatches() {
    const run = () => track(countNewMatches());
    clearTimeout(newMatchesTimer);
    newMatchesTimer = setTimeout(run, NEW_MATCHES_DELAY_MS);
    newMatchesTimer.unref?.();
    if (!newMatchesMaxTimer) {
      newMatchesMaxTimer = setTimeout(run, NEW_MATCHES_MAX_WAIT_MS);
      newMatchesMaxTimer.unref?.();
    }
  }

  /**
   * Shows the new matches in place: reads the results again under a new
   * as_of, from the nearest cursor above the top row in view, so that row
   * stays in the window (the table keeps it at the top). The rows above
   * load backward as the researcher scrolls up.
   */
  function showNewMatches() {
    return readInPlace({ asOf: "" });
  }

  /**
   * Reads the rows again in place up to the newest pair shown, as after a
   * bulk change Marasi reports no event for: rows a change removed from the
   * results go, and the view stays where it is. Falls back to a reload.
   */
  async function refresh() {
    const r = core.current.results;
    if (r.loading || r.failed || !r.shownAsOf) return reload();
    const ok = await track(readInPlace({ asOf: r.shownAsOf, keepNew: true }));
    if (!ok) await reload();
  }

  // Reads the results again from the nearest cursor above the top row in
  // view, under `asOf` ("" for a new one). `keepNew` keeps the new-match
  // count, which a read under the same as_of leaves as it was. Returns false
  // when the read failed.
  async function readInPlace({ asOf, keepNew = false }) {
    const r = core.current.results;
    const rows = tableRows(core.current);
    const top = Math.min(Math.max(viewport.first, 0), Math.max(rows.length - 1, 0));
    const at = locate(r.chunks, top);
    let cursor = "";
    let from = 0;
    if (at && at.k > 0 && r.chunks[at.c].first) {
      cursor = r.chunks[at.c].first;
      from = at.start + 1;
    } else if (at && at.c > 0 && r.chunks[at.c - 1].last) {
      cursor = r.chunks[at.c - 1].last;
      from = at.start;
    }
    const limit = Math.min(MAX_PAGE_ROWS, top - from + PAGE_SIZE);
    const gen = ++generation;
    loadingForward = loadingBackward = false;
    reading = true;
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(core.current.query.ranQuery, core.current.sort, { Cursor: cursor, Limit: limit, AsOf: asOf }),
      );
      if (page.QueryError) throw new Error(page.QueryError.Message);
    } catch (err) {
      console.error("Reading the rows again failed:", err);
      if (gen === generation) reading = false;
      return false;
    }
    if (gen !== generation) return true;
    reading = false;
    viewport = { ...viewport, first: top - from, last: viewport.last - from };
    updateResults((r) => ({
      ...resultsFromPage(page, cursor),
      reset: r.reset,
      ...(keepNew ? { newCount: r.newCount, newCapped: r.newCapped } : {}),
    }));
    await loadCount(gen);
    return true;
  }

  /**
   * Back to the top of the newest-first live view with its new pairs: reads
   * the top again.
   */
  function goToTop() {
    viewport = { first: 0, last: 0, atTop: true };
    return reload();
  }

  return {
    pageRequest,
    resultsFromPage,
    readFirstPage,
    reload,
    trim,
    loadAround,
    countNewMatches,
    cancelNewMatches,
    scheduleNewMatches,
    showNewMatches,
    refresh,
    readInPlace,
    goToTop,

    // A read that replaces the window (a jump): it bumps the generation, so
    // pages and counts read for the old window are dropped, and holds off
    // paging until `endRead`.
    beginRead: () => {
      const gen = ++generation;
      loadingForward = loadingBackward = false;
      reading = true;
      return gen;
    },
    isLatest: (gen) => gen === generation,
    endRead: () => {
      reading = false;
    },
    nextReset: () => ++resets,
    get reading() {
      return reading;
    },
    get viewport() {
      return viewport;
    },
    set viewport(next) {
      viewport = next;
    },

    // A project switch: reads under way are dropped and paging starts again.
    reset: () => {
      generation++;
      reading = false;
      cancelNewMatches();
      loadingForward = loadingBackward = false;
      viewport = { first: 0, last: 0, atTop: true };
    },
  };
}
