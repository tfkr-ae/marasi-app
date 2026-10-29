// The Ledger store: the rows the table shows, the query, the sort, the
// content-type exclusion and new matches. Every backend call goes through
// the injected `api` (see ledgerStore.js for the Wails one), so this module
// loads under node --test.
//
// The table shows one set of results: the live view (an empty query) or a
// query's results, under the sort. It never holds the whole project. Rows
// arrive in pages from Marasi's ListTraffic, read by cursor in either
// direction, and the store keeps a window of a few pages around the rows in
// view, dropping pages far from them. Every page of one set of results
// passes the same `as_of`, so the pages agree on which pairs they list.
//
// Cursors are opaque, bound to their sort, and point at a page's edge rows;
// a read starts just past its cursor. A page read from the top has no cursor
// at its first row.
//
// New pairs: the newest-first live view shows them at the top while the
// researcher is at the top; anywhere else, and under any other sort or a
// query, rows never move and the store counts the new matches after `as_of`
// until the researcher asks for them.
//
// A pair's number ("Request N", the # column) is its position in the
// current results, counted from the top; it is unknown ("?") while the
// window's position is.
import { writable } from "svelte/store";
import { webSocketMetadataPatch } from "../lib/websocket/metadataPatch.js";
import { LEDGER_DOCK } from "../lib/dock/dock.js";
import { toggleQueryTerm } from "../lib/ledgerQueryFields.js";
import { hiddenBy, normalizeContentType } from "../lib/ledger/contentTypes.js";
import { searchRequests } from "../lib/requestPicker.js";
import { select } from "../lib/storeSelect.js";
import { LAUNCHPADS_EACH_MAX, pairIDSet, sameID } from "../lib/ledger/pairs.js";
import { formatCount, matchNoun, requestCount } from "../lib/ledger/counts.js";
import { incompleteJobs } from "../lib/ledger/selectionIncomplete.js";
import { pendingLaunchIDs } from "../lib/launchPending.js";
import { DEFAULT_SORT } from "../lib/ledger/table.js";

/** The drawer's share of the table area's height: default and limits. */
export const DRAWER_SPLIT = { default: 0.42, min: 0.15, max: 0.85 };

/** How long the query box waits after the last keystroke before running. */
export const QUERY_DELAY_MS = 700;

// New matches are counted on a debounce: each traffic event restarts a
// NEW_MATCHES_DELAY_MS wait, so a burst is counted once it pauses. Under
// steady traffic that never pauses, the count still runs once
// NEW_MATCHES_MAX_WAIT_MS has passed since the first uncounted event.

/** How long traffic must pause before new matches are counted. */
export const NEW_MATCHES_DELAY_MS = 500;

/** The longest new matches wait to be counted under steady traffic. */
export const NEW_MATCHES_MAX_WAIT_MS = 3000;

/** How often buffered request and response events reach the table. */
export const FLUSH_INTERVAL_MS = 200;

/** Rows per ListTraffic page. */
export const PAGE_SIZE = 200;

/** The most rows the window keeps; pages far from the rows in view go. */
export const MAX_WINDOW_ROWS = PAGE_SIZE * 5;

/** Marasi's largest page; a refresh in place reads at most this many. */
const MAX_PAGE_ROWS = 1000;

/** How close to the window's edge the rows in view get before the next page loads. */
export const EDGE_ROWS = 60;

/** The default sort: newest first. */
export { DEFAULT_SORT };
// Fields a header click sorts newest first rather than ascending.
const NEWEST_FIRST_FIELDS = new Set(["number", "requested_at"]);

// Past this many buffered events, they reach the table at once.
const MAX_BUFFERED = 500;

/** Marasi's order_by for a sort. */
export function orderBy(sort) {
  return sort.desc ? `${sort.field} desc` : sort.field;
}

function emptyResults() {
  return {
    // Changes each time fresh results load from the top, so the table can
    // scroll there; a refresh in place keeps it.
    reset: 0,
    // The loaded pages, top to bottom: { items, first, last }, where
    // `first` and `last` are the cursors at the page's first and last rows,
    // or null when unknown (a page read from the top) or at the end.
    chunks: [],
    // Whether rows exist above or below the window.
    hasBefore: false,
    hasAfter: false,
    // The window's first row's position in the results, or null when
    // unknown (after a refresh in place, until the top is loaded again).
    start: 0,
    // The as_of every page of these results passes; null before the first
    // page, or when the project had no pairs.
    asOf: null,
    // The newest pair the table shows: `asOf`, or the newest live pair that
    // joined the top of the newest-first live view since. Counts, new
    // matches and ⌘A go by it; pages still pass `asOf`.
    shownAsOf: null,
    // True until the first page arrives.
    loading: true,
    // True when reading a page failed; pages stop loading until a reload.
    failed: false,
    indexComplete: true,
    // { count, capped } once counted; null until then.
    count: null,
    // Pairs the content-type exclusion hides from these results; null when
    // unknown.
    hidden: null,
    // Matches captured after `as_of` that the table doesn't show.
    newCount: 0,
    newCapped: false,
  };
}

function emptyQueryState(runID = 0) {
  return {
    // The last query that ran successfully; "" in the live view.
    ranQuery: "",
    // Increases each time a query runs successfully.
    runID,
    // The last failed query: { query, message, position }, where position is
    // marasi's 1-based character offset into `query`, or null when the failure
    // wasn't in the query text. null when the last query that ran was valid.
    error: null,
  };
}

// The table and drawer layout. It outlasts a project switch.
function initialLayout() {
  return {
    // The sitemap dock: its width in px, and whether it is collapsed to a strip.
    dock: { width: LEDGER_DOCK.default, collapsed: false },
    // The drawer's share of the table area's height, whether it covers the
    // table, and whether its details column is expanded from the rail.
    drawer: { split: DRAWER_SPLIT.default, maximised: false, expanded: false },
  };
}

function emptySelection() {
  return {
    // The selected pairs' IDs, as strings. Replaced, never mutated, so a
    // subscriber can tell a change by identity.
    ids: new Set(),
    // Where ⇧-click and ⇧↑/↓ ranges start: the last row clicked without ⇧.
    anchor: null,
    // The pair the drawer shows, or null when nothing is selected. Always
    // one of `ids`.
    focus: null,
    // The focused pair's response when it arrived after the pair was
    // selected, so the drawer can show it without reloading.
    incomingResponse: null,
    // After ⌘A, the whole query instead of listed pairs: { text, exclusion,
    // asOf, count }, where `count` is { count, capped } once counted. `ids`
    // then holds the loaded rows it covers. null otherwise.
    query: null,
  };
}

function initialState(runID = 0, layout = initialLayout(), sort = DEFAULT_SORT) {
  return {
    layout,
    selection: emptySelection(),
    // The focused pair's row, kept while its page is out of the window.
    focusRow: null,
    // Content types the table hides: exact types and major/* values.
    exclusion: [],
    // True once the project's exclusion has loaded (or failed to).
    exclusionLoaded: false,
    // True when the project keeps its own exclusion, false when it follows
    // the app default, null until known.
    ownExclusion: null,
    // The app default exclusion, once loaded for Settings.
    defaultExclusion: null,
    // The Types menu's pair counts per content type (CountContentTypes'
    // Counts), loaded when the menu opens. `complete` is the sitemap job's.
    typeCounts: { counts: [], complete: true, loaded: false },
    // The table's sort; it outlasts a project switch.
    sort,
    // The text in the query box.
    queryText: "",
    // True while the query box's delay timer is waiting to run a query.
    queryPending: false,
    // True while Marasi reads fresh results from the top (a query, a sort,
    // the live view again); the table shows ghost rows meanwhile.
    querying: false,
    query: emptyQueryState(runID),
    results: emptyResults(),
  };
}

/** True when the query state `q` shows query results instead of the live view. */
export function isQueryActive(q) {
  return q.ranQuery !== "";
}

/** True when the table shows the live view newest first. */
export function isLiveNewestFirst(state) {
  return (
    !isQueryActive(state.query) &&
    state.sort.field === DEFAULT_SORT.field &&
    state.sort.desc === DEFAULT_SORT.desc
  );
}

/**
 * How new pairs reach the table: "top" when they appear at the top of the
 * newest-first live view ("N new" returns there), "pill" when rows never
 * move and "N new matches · Show" refreshes in place.
 */
export function newMatchesKind(state) {
  return isLiveNewestFirst(state) ? "top" : "pill";
}

// tableRows' last result, so the same chunks give the same array and a
// subscriber can tell an unchanged table by identity.
let tableRowsCache = { chunks: null, rows: [] };

/** The rows the Ledger table holds, top to bottom: the loaded window. */
export function tableRows(state) {
  const chunks = state.results.chunks;
  if (tableRowsCache.chunks !== chunks) {
    tableRowsCache = { chunks, rows: chunks.flatMap((chunk) => chunk.items) };
  }
  return tableRowsCache.rows;
}

/**
 * How many pairs the content-type exclusion hides from the live view or the
 * query's results, or null when unknown.
 */
export function hiddenByTypeCount(state) {
  return state.results.hidden;
}

/**
 * The status bar's count: "N in the live view" or "N matching", "…" until
 * it is counted, "100,000+" past Marasi's cap.
 */
export function countLabel(state) {
  const count = state.results.count;
  if (!count) return "…";
  const n = formatCount(count.count, count.capped);
  return isQueryActive(state.query) ? `${n} matching` : `${n} in the live view`;
}

/** "N new" or "N new matches"; "" when there are none. */
export function newMatchesLabel(state) {
  const { newCount, newCapped } = state.results;
  if (!newCount) return "";
  const n = formatCount(newCount, newCapped);
  return newMatchesKind(state) === "top" ? `${n} new` : `${n} new ${matchNoun(newCount, newCapped)}`;
}

/** True while a pair is selected; the drawer shows it. */
export function isDrawerOpen(state) {
  return state.selection.focus != null;
}

/** The pair the drawer shows, or undefined. */
export function focusedPair(state) {
  const focus = state.selection.focus;
  if (focus == null || !sameID(state.focusRow?.ID, focus)) return undefined;
  return state.focusRow;
}

/** True when the pair with this ID is selected. */
export function isSelected(state, id) {
  return id != null && state.selection.ids.has(String(id));
}

/** True when the selection is the whole query (⌘A), not listed pairs. */
export function isAllSelected(state) {
  return state.selection.query != null;
}

/**
 * The selection as Marasi takes it (marasi docs/adr/2026-10-14-query-selections-stop-at-as-of.md): { ids }, or after ⌘A
 * { query, exclusion, as_of }, which never lists ids. null when nothing is
 * selected.
 */
export function selectionSpec(state) {
  const { ids, query } = state.selection;
  if (query) return { query: query.text, exclusion: [...query.exclusion], as_of: query.asOf };
  if (ids.size === 0) return null;
  return { ids: [...ids] };
}

/** How many pairs are selected; null while a ⌘A selection is being counted. */
export function selectionSize(state) {
  const { ids, query } = state.selection;
  return query ? query.count?.count ?? null : ids.size;
}

/**
 * The matches a ⌘A selection leaves out because they arrived after its
 * as_of: new matches not shown yet, and any shown since.
 */
export function newMatchesNotSelected(state) {
  const query = state.selection.query;
  if (!query) return 0;
  const { shownAsOf, count, newCount } = state.results;
  let shown = 0;
  if (shownAsOf !== query.asOf && count && query.count && !count.capped && !query.count.capped) {
    shown = Math.max(0, count.count - query.count.count);
  }
  return shown + newCount;
}

/**
 * The status bar's "All N matching selected", plus "· M new matches not
 * included" when there are new matches; "" without a ⌘A selection.
 */
export function allSelectedLabel(state) {
  const query = state.selection.query;
  if (!query) return "";
  const n = query.count
    ? formatCount(query.count.count, query.count.capped)
    : "…";
  const left = newMatchesNotSelected(state);
  const note = left ? ` · ${formatCount(left)} new ${matchNoun(left)} not included` : "";
  return `All ${n} matching selected${note}`;
}

/** The selected pairs, in table order. */
export function selectedPairs(state) {
  const ids = state.selection.ids;
  if (ids.size === 0) return [];
  const rows = tableRows(state).filter((row) => ids.has(String(row.ID)));
  // The drawer's pair can be one a jump opened outside the loaded rows.
  const outside = state.focusRow;
  if (outside && ids.has(String(outside.ID)) && !rows.some((row) => sameID(row.ID, outside.ID))) rows.push(outside);
  return rows;
}

/**
 * What an action runs on: the loaded selected pairs, the selection in
 * Marasi's shape (listed ids, or after ⌘A the query, exclusion and as_of),
 * whether it is ⌘A, and how many pairs it holds (null while a ⌘A selection
 * is counted).
 */
export function selectionTarget(state) {
  return {
    pairs: selectedPairs(state),
    selection: selectionSpec(state),
    all: isAllSelected(state),
    count: selectionSize(state),
  };
}

/**
 * What the row menu acts on when this row is right-clicked: the selection
 * when the row is in it, else the row alone. The selection and the drawer
 * stay as they are.
 */
export function rowMenuTarget(state, id) {
  if (isSelected(state, id)) return selectionTarget(state);
  const pair = tableRows(state).find((row) => sameID(row.ID, id));
  if (!pair) return { pairs: [], selection: null, all: false, count: 0 };
  return { pairs: [pair], selection: { ids: [String(pair.ID)] }, all: false, count: 1 };
}

// The IDs of the rows from `a` to `b` in table order, both included; just
// [b] when either has left the table.
function rowRange(rows, a, b) {
  const i = rows.findIndex((row) => sameID(row.ID, a));
  const j = rows.findIndex((row) => sameID(row.ID, b));
  if (i < 0 || j < 0) return [String(b)];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((row) => String(row.ID));
}

/**
 * The drawer as the keybinding contexts see it: whether it is open, and the
 * focused pair in the shape `canOpenDrawerStream` reads (lower-case
 * `metadata`, the loaded `response`, and one that arrived live).
 */
export function drawerKeybindingState(state) {
  const pair = focusedPair(state);
  if (!pair) return { open: false, meta: null };
  return {
    open: true,
    meta: {
      metadata: pair.Metadata ?? {},
      response: { StatusCode: pair.StatusCode, ContentType: pair.ContentType },
      incomingResponse: state.selection.incomingResponse,
    },
  };
}

/** `split` within the drawer's limits. */
export function clampDrawerSplit(split) {
  return Math.min(DRAWER_SPLIT.max, Math.max(DRAWER_SPLIT.min, split));
}

/** Shown while a query is active and older traffic is still being indexed. */
export function indexWarning(state) {
  return isQueryActive(state.query) && !state.results.indexComplete
    ? "Search index still building"
    : "";
}

// A live event's pair as a table row: without the raw and prettified
// bodies, which the drawer reads itself.
function withoutBodies(pair) {
  if (!("Raw" in pair) && !("Prettified" in pair)) return pair;
  const { Raw, Prettified, ...row } = pair;
  return row;
}

// Applies `fn` to every row of `chunks`; returns `chunks` itself when `fn`
// replaced none.
function mapChunks(chunks, fn) {
  let changed = false;
  const mapped = chunks.map((chunk) => {
    let chunkChanged = false;
    const items = [];
    for (const item of chunk.items) {
      const next = fn(item);
      if (next !== item) chunkChanged = true;
      if (next) items.push(next);
    }
    if (!chunkChanged) return chunk;
    changed = true;
    return { ...chunk, items };
  });
  return changed ? mapped : chunks;
}

// The chunk holding row `index` of the window, and the row's offset in it.
function locate(chunks, index) {
  let start = 0;
  for (let c = 0; c < chunks.length; c++) {
    const length = chunks[c].items.length;
    if (index < start + length) return { c, k: index - start, start };
    start += length;
  }
  return null;
}

export function createLedgerStore(api) {
  let current = initialState();
  const { subscribe, set: setStore } = writable(current);

  function set(next) {
    // A fresh read of the results drops the selected pairs it doesn't list.
    // Pages leaving the window as the researcher scrolls drop nothing.
    if (next.results.reset !== current.results.reset) {
      next = { ...next, selection: prunedSelection(next) };
    }
    // A ⌘A selection covers every loaded row up to its as_of.
    if (next.selection.query) {
      const selection = withQueryRows(next);
      if (selection !== next.selection) next = { ...next, selection };
    }
    // The drawer keeps the focused pair's row while its page is out of the
    // window, and follows the row while it is in it. Focusing a pair the
    // table doesn't hold clears the selection.
    const focus = next.selection.focus;
    if (focus != null) {
      const row = tableRows(next).find((item) => sameID(item.ID, focus));
      if (row) {
        if (next.focusRow !== row) next = { ...next, focusRow: row };
      } else if (!sameID(next.focusRow?.ID, focus)) {
        next = { ...next, selection: emptySelection(), focusRow: null };
      }
    } else if (next.focusRow) {
      next = { ...next, focusRow: null };
    }
    current = next;
    setStore(next);
  }

  // The selection only holds pairs the results list: when a query, an
  // exclusion or a project switch removes some, they leave the selection.
  // When the focused pair leaves, the focus moves to the last one left, and
  // with none left the drawer closes.
  function prunedSelection(state) {
    const selection = state.selection;
    // A ⌘A selection lasts while the query and exclusion it was made under do.
    if (selection.query) {
      const { text, exclusion } = selection.query;
      const same =
        text === state.query.ranQuery &&
        exclusion.length === state.exclusion.length &&
        exclusion.every((type, i) => type === state.exclusion[i]);
      return same ? selection : emptySelection();
    }
    if (selection.ids.size === 0) return selection;
    const shown = pairIDSet(tableRows(state));
    if (![...selection.ids].some((id) => !shown.has(id))) return selection;
    const ids = new Set([...selection.ids].filter((id) => shown.has(id)));
    if (ids.size === 0) return emptySelection();
    const focus = ids.has(selection.focus) ? selection.focus : [...ids].at(-1);
    return {
      ids,
      anchor: ids.has(selection.anchor) ? selection.anchor : focus,
      focus,
      incomingResponse: focus === selection.focus ? selection.incomingResponse : null,
      query: null,
    };
  }

  // The ⌘A selection with `ids` set to the loaded rows up to its as_of, or
  // the same selection when they haven't changed. Pair IDs sort by capture
  // time.
  function withQueryRows(state) {
    const selection = state.selection;
    const ids = coveredRows(state, selection.query.asOf);
    if (ids.length === selection.ids.size && ids.every((id) => selection.ids.has(id))) return selection;
    return { ...selection, ids: new Set(ids) };
  }

  // The IDs of the loaded rows captured up to `asOf`.
  function coveredRows(state, asOf) {
    const ids = [];
    for (const row of tableRows(state)) if (String(row.ID) <= asOf) ids.push(String(row.ID));
    return ids;
  }
  function update(fn) {
    set(fn(current));
  }
  function updateResults(fn) {
    update((state) => ({ ...state, results: fn(state.results) }));
  }

  // Counts reads from the top, for `results.reset`.
  let resets = 0;
  // Identifies the current set of results. Each reload bumps it, so a page
  // or count read for older results is dropped.
  let generation = 0;
  // Pages and counts in flight, so tests and callers can wait for them.
  const inflight = new Set();
  function track(promise) {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
    return promise;
  }

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
  // Bumped on a project switch, so the old project's exclusion is dropped.
  let projectVersion = 0;
  // Settles once the project's exclusion has loaded; counts wait for it.
  let exclusionLoaded = Promise.resolve();

  // Request and response events wait here until the next flush, so a burst
  // of traffic updates the table once.
  let requestBuffer = [];
  let responseBuffer = new Map();

  let delayTimer = null;
  // The new-match count's debounce, and its max wait.
  let newMatchesTimer = null;
  let newMatchesMaxTimer = null;
  // Identifies the newest query request, so a slower, older response can't
  // overwrite a newer one or a cleared query.
  let latestRequest = 0;

  function cancelDelay() {
    clearTimeout(delayTimer);
    delayTimer = null;
    if (current.queryPending) update((state) => ({ ...state, queryPending: false }));
  }

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
    await exclusionLoaded;
    if (gen !== generation) return;
    const { query, results, exclusion } = current;
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
    if (!current.querying) update((state) => ({ ...state, querying: true }));
    // Another kind of read (a jump, rows read again in place) can take
    // over; `querying` still clears once no first-page read is left.
    const settleStale = () => {
      if (firstPageGen === gen && current.querying) update((state) => ({ ...state, querying: false }));
    };
    let page;
    try {
      page = await api.queryTraffic(pageRequest(text, current.sort));
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
    return track(readFirstPage(current.query.ranQuery));
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
    const r = current.results;
    const edge = r.chunks.at(-1)?.last;
    if (!r.hasAfter || !edge || loadingForward || reading || r.failed) return;
    const gen = generation;
    loadingForward = true;
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(current.query.ranQuery, current.sort, { Cursor: edge, AsOf: r.asOf ?? "" }),
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
      const loaded = pairIDSet(tableRows(current));
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
    const r = current.results;
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
        pageRequest(current.query.ranQuery, current.sort, {
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
    const loaded = pairIDSet(tableRows(current));
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
    const r = current.results;
    if (r.loading || reading) return;
    const rows = tableRows(current);
    if (
      newMatchesKind(current) === "top" &&
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
    const r = current.results;
    if (r.loading || reading) return;
    let counted;
    try {
      counted = await api.countTraffic(current.query.ranQuery, r.shownAsOf ?? "");
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
    const r = current.results;
    if (r.loading || r.failed || !r.shownAsOf) return reload();
    const ok = await track(readInPlace({ asOf: r.shownAsOf, keepNew: true }));
    if (!ok) await reload();
  }

  // Reads the results again from the nearest cursor above the top row in
  // view, under `asOf` ("" for a new one). `keepNew` keeps the new-match
  // count, which a read under the same as_of leaves as it was. Returns false
  // when the read failed.
  async function readInPlace({ asOf, keepNew = false }) {
    const r = current.results;
    const rows = tableRows(current);
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
        pageRequest(current.query.ranQuery, current.sort, { Cursor: cursor, Limit: limit, AsOf: asOf }),
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

  /** Waits until no page or count is in flight. */
  async function settled() {
    while (inflight.size > 0) await Promise.allSettled([...inflight]);
  }

  // Loads the project's first page and content-type exclusion. Each arrives
  // on its own; a failure leaves the other in place.
  async function populate() {
    const version = projectVersion;
    const fresh = () => version === projectVersion;
    exclusionLoaded = api
      .getExclusion()
      .then((exclusion) => {
        if (fresh()) update((state) => ({ ...state, exclusion: exclusion ?? [], exclusionLoaded: true }));
      })
      .catch((err) => {
        console.error("Loading the content-type exclusion failed:", err);
        if (fresh()) update((state) => ({ ...state, exclusionLoaded: true }));
      });
    await Promise.all([
      reload(),
      exclusionLoaded,
      api
        .hasOwnExclusion()
        .then((own) => {
          if (fresh()) update((state) => ({ ...state, ownExclusion: own }));
        })
        .catch((err) => console.error("Reading whether the project has its own exclusion failed:", err)),
    ]);
  }

  // Stores a new exclusion. The caller reads the results again so they
  // reflect it, which drops the pairs it hides from the selection.
  function applyExclusion(exclusion, ownExclusion) {
    update((state) => ({ ...state, exclusion, ownExclusion }));
  }

  /**
   * Loads the Types menu's pair counts. Counts for a project that has
   * since closed are dropped; a failure keeps the last counts.
   */
  async function loadTypeCounts() {
    const version = projectVersion;
    try {
      const result = await api.countContentTypes();
      if (version !== projectVersion) return;
      update((state) => ({
        ...state,
        typeCounts: {
          counts: result?.Counts ?? [],
          complete: result?.Complete?.sitemap ?? true,
          loaded: true,
        },
      }));
    } catch (err) {
      console.error("Counting content types failed:", err);
    }
  }

  /**
   * Moves buffered requests and responses into the table. Responses fill in
   * loaded rows in place. At the top of the newest-first live view, new
   * pairs join at the top; anywhere else, new matches are counted.
   *
   * Live pairs joining the top leave the results' as_of alone, so the pages
   * below still agree; they raise `shownAsOf` instead. Once they push the
   * window past MAX_WINDOW_ROWS, the top page is read again in place under
   * a new as_of, so the oldest rows go and load back by cursor.
   */
  function flush() {
    if (requestBuffer.length === 0 && responseBuffer.size === 0) return;
    const live = newMatchesKind(current) === "top";
    // A read under way replaces the rows; pairs arriving meanwhile wait
    // for it, so the ones it leaves out still join the top.
    if (live && reading) return;
    const requests = requestBuffer;
    const responses = responseBuffer;
    requestBuffer = [];
    responseBuffer = new Map();

    const r = current.results;
    const showAtTop =
      live && !r.loading && !r.hasBefore && viewport.atTop && r.newCount === 0;
    const exclusion = current.exclusion;

    updateResults((r) => {
      let chunks = r.chunks;
      if (responses.size > 0) {
        chunks = mapChunks(chunks, (item) => {
          const res = responses.get(item.ID);
          if (!res) return item;
          const next = withoutBodies({ ...item, ...res });
          // The live view drops a pair once its response shows the
          // exclusion hides it.
          return live && hiddenBy(next.ContentType, exclusion) ? null : next;
        });
      }
      if (!showAtTop || requests.length === 0) return { ...r, chunks };
      // A pair joins once, however many times its request event came.
      const loaded = pairIDSet(tableRows({ results: { chunks } }));
      const fresh = requests.filter((req) => {
        if (loaded.has(String(req.ID))) return false;
        loaded.add(String(req.ID));
        return true;
      });
      const arrived = fresh
        .map((req) => withoutBodies(responses.has(req.ID) ? { ...req, ...responses.get(req.ID) } : req))
        .filter((pair) => !hiddenBy(pair.ContentType, exclusion))
        .sort((a, b) => (String(a.ID) < String(b.ID) ? 1 : -1));
      if (arrived.length === 0) return { ...r, chunks };
      const [top, ...rest] = chunks.length ? chunks : [{ items: [], first: null, last: null }];
      const newest = String(arrived[0].ID);
      return trim({
        ...r,
        chunks: [{ ...top, items: [...arrived, ...top.items] }, ...rest],
        shownAsOf: r.shownAsOf && r.shownAsOf > newest ? r.shownAsOf : newest,
        count: r.count && { ...r.count, count: r.count.count + (r.count.capped ? 0 : arrived.length) },
      });
    });
    if (!showAtTop) scheduleNewMatches();
    else if (tableRows(current).length > MAX_WINDOW_ROWS) track(readInPlace({ asOf: "" }));
  }

  /**
   * Merges `patch` into the Metadata of the loaded pair with this ID.
   */
  function patchMetadata(id, patch) {
    patchPairs([String(id)], (item) => ({ ...item, Metadata: { ...(item.Metadata || {}), ...patch } }));
  }

  // Applies `fn` to the loaded rows with these IDs, and to the drawer's pair
  // when a jump opened it outside them. `fn` returns the item itself when
  // nothing changes.
  function patchPairs(ids, fn) {
    const wanted = new Set(ids);
    update((state) => {
      const chunks = mapChunks(state.results.chunks, (item) => (wanted.has(String(item.ID)) ? fn(item) : item));
      const outside = state.focusRow;
      const focusRow = outside && wanted.has(String(outside.ID)) ? fn(outside) : outside;
      if (chunks === state.results.chunks && focusRow === outside) return state;
      return { ...state, results: { ...state.results, chunks }, focusRow };
    });
  }

  /**
   * Saves `text` as the pair's note, and marks whether the pair has one.
   * Rejects, leaving the mark as it was, when Marasi fails to save it.
   */
  async function saveNote(id, text) {
    await api.updateNote(id, text);
    patchMetadata(id, { has_note: text.length > 0 ? 1 : 0 });
  }

  /**
   * Runs `text` as the ledger's query now. Blank text returns to the live
   * view instead, because an empty query is never sent. An invalid query
   * records the error and leaves the previous results in place.
   */
  async function runQuery(text = current.queryText) {
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
  function scheduleQuery(text = current.queryText) {
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
    const wasActive = isQueryActive(current.query);
    update((state) => ({
      ...state,
      queryText: keepText ? state.queryText : "",
      query: { ...emptyQueryState(state.query.runID) },
    }));
    if (wasActive || current.results.loading) return reload();
    return Promise.resolve();
  }

  /**
   * Back to the newest-first live view: empties the query (and with it any
   * mark, highlight, sitemap or saved-query term), restores the default sort
   * and reads from the top. Nothing is read when the table already shows it.
   */
  function backToLive() {
    if (isLiveNewestFirst(current) && !current.queryText && !current.results.loading) {
      return Promise.resolve();
    }
    cancelDelay();
    latestRequest++;
    viewport = { first: 0, last: 0, atTop: true };
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
    return reload();
  }

  function setSelection(selection) {
    update((state) => ({ ...state, selection }));
  }

  // Selects `ids` with this anchor and focus. The incoming response stays
  // only while the focus does.
  function selectIDs(ids, anchor, focus) {
    const previous = current.selection;
    const focusID = focus == null ? null : String(focus);
    setSelection({
      ids: new Set(ids),
      anchor: anchor == null ? null : String(anchor),
      focus: focusID,
      incomingResponse: sameID(previous.focus, focusID) ? previous.incomingResponse : null,
      query: null,
    });
  }

  /** Selects only the pair with this ID; the drawer opens on it. */
  function selectPair(id) {
    if (id == null) return;
    const { ids, focus } = current.selection;
    if (ids.size === 1 && sameID(focus, id)) return;
    selectIDs([String(id)], id, id);
  }

  /**
   * A click on a row. Plain selects only that row. `toggle` (⌘/Ctrl) adds or
   * removes it. `range` (⇧) selects from the anchor to it, replacing the
   * selection, or adding to it with `toggle` too. Only ranges keep the
   * anchor where it was.
   */
  function clickRow(id, { toggle = false, range = false } = {}) {
    if (id == null) return;
    const { ids, anchor } = current.selection;
    if (range && anchor != null) {
      const span = rowRange(tableRows(current), anchor, id);
      selectIDs(toggle ? [...ids, ...span] : span, anchor, id);
    } else if (toggle) {
      const key = String(id);
      const next = new Set(ids);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Removing the focused row moves the focus to the last one selected.
      const focus = next.has(key) ? key : [...next].at(-1) ?? null;
      selectIDs(next, id, focus);
    } else {
      selectPair(id);
    }
  }

  /** Clears the selection; the drawer closes and stops covering the table. */
  function clearSelection() {
    update((state) => ({
      ...state,
      selection: emptySelection(),
      layout: { ...state.layout, drawer: { ...state.layout.drawer, maximised: false } },
    }));
  }

  /**
   * Moves the focus `step` rows down (negative steps go up), stopping at the
   * window's ends, and selects only that row. With `extend` (⇧), selects the
   * range from the anchor to it instead. With nothing selected, a step down
   * selects the top row and a step up the bottom one.
   */
  function stepSelection(step, { extend = false } = {}) {
    const rows = tableRows(current);
    const { focus, anchor } = current.selection;
    const at = focus == null ? -1 : rows.findIndex((row) => sameID(row.ID, focus));
    // From a pair a jump opened outside the loaded rows, steps go by #: next
    // is the next pair down, previous the next one up, until one is loaded.
    if (at === -1 && focus != null && sameID(current.focusRow?.ID, focus)) return stepOutside(step);
    if (rows.length === 0) return;
    const target =
      at === -1
        ? step > 0
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, at + step));
    const id = rows[target].ID;
    if (extend && anchor != null) selectIDs(rowRange(rows, anchor, id), anchor, id);
    else selectPair(id);
  }

  async function stepOutside(step) {
    const number = current.focusRow.Number;
    let pair = null;
    try {
      pair = step > 0 ? await onePair(`number < ${number}`, "number desc") : await onePair(`number > ${number}`, "number");
    } catch (err) {
      console.error("Reading traffic failed:", err);
    }
    if (!pair) return;
    const shown = tableRows(current).find((row) => sameID(row.ID, pair.ID));
    if (shown) selectPair(shown.ID);
    else focusOutside(pair);
  }

  /**
   * ⌘⇧] / ⌘⇧[: the pair with the next higher (`step` > 0) or lower number
   * in the project, whether the results hold it or not, past the query, the
   * type exclusion and the results' as_of. A loaded pair is selected in the
   * table; any other opens on its own. Returns { pair }, null at either end
   * of the project or when the focus moved on before the pair arrived.
   */
  async function stepNumber(step) {
    const from = current.selection.focus;
    if (from == null) return { pair: null };
    const number = pairNumber(from);
    if (number === "?") return { pair: null };
    let pair = shownPairAtNumber(number + Math.sign(step)) ?? null;
    if (!pair) {
      try {
        const page = await api.queryTraffic({
          ...pageRequest(`number ${step > 0 ? ">" : "<"} ${number}`, current.sort, { Limit: 1 }),
          OrderBy: step > 0 ? "number" : "number desc",
          IgnoreExclusion: true,
        });
        pair = page.QueryError ? null : (page.Items?.[0] ?? null);
      } catch (err) {
        console.error("Reading traffic failed:", err);
      }
    }
    if (!pair || !sameID(current.selection.focus, from)) return { pair: null };
    const shown = findShownPair(pair.ID);
    if (shown) selectPair(shown.ID);
    else focusOutside(pair);
    return { pair: shown ?? pair };
  }

  /**
   * ⌘] / ⌘[: the results' highest- or lowest-numbered pair, selected alone.
   * Under a # sort it is the table's top or bottom row (see goToEdge);
   * under another sort it is read alone, selected where the table holds it
   * and opened on its own otherwise. Returns { pair }, null when the results
   * are empty.
   */
  async function goToNumberEnd(highest) {
    const { field, desc } = current.sort;
    if (field === "number") return goToEdge(highest !== desc);
    const r = current.results;
    let pair = null;
    try {
      const page = await api.queryTraffic({
        ...pageRequest(current.query.ranQuery, current.sort, { AsOf: r.shownAsOf ?? r.asOf ?? "", Limit: 1 }),
        OrderBy: highest ? "number desc" : "number",
      });
      pair = page.QueryError ? null : (page.Items?.[0] ?? null);
    } catch (err) {
      console.error("Reading traffic failed:", err);
    }
    if (!pair) return { pair: null };
    const shown = findShownPair(pair.ID);
    if (shown) selectPair(shown.ID);
    else focusOutside(pair);
    return { pair: shown ?? pair };
  }

  /**
   * The results' first or (`end`) last row, selected alone. A
   * window that holds that edge selects it there; else the edge's page is
   * read into a fresh window (the last one backward from the end) under the
   * as_of the table shows. Returns { pair }, null when the results are empty.
   */
  async function goToEdge(end) {
    const r = current.results;
    if (end ? !r.hasAfter : !r.hasBefore) {
      const rows = tableRows(current);
      const pair = (end ? rows.at(-1) : rows[0]) ?? null;
      if (pair) selectPair(pair.ID);
      return { pair };
    }
    const gen = ++generation;
    loadingForward = loadingBackward = false;
    reading = true;
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(current.query.ranQuery, current.sort, {
          AsOf: r.shownAsOf ?? r.asOf ?? "",
          Direction: end ? "backward" : "forward",
        }),
      );
      if (page.QueryError) throw new Error(page.QueryError.Message);
    } catch (err) {
      console.error("Reading traffic failed:", err);
      if (gen === generation) reading = false;
      return { pair: null };
    }
    if (gen !== generation) return { pair: null };
    reading = false;
    const items = page.Items ?? [];
    viewport = { first: 0, last: 0, atTop: !end };
    updateResults((prev) => {
      const total = prev.count && !prev.count.capped ? prev.count.count : null;
      return {
        ...resultsFromPage(page, ""),
        chunks: [
          end
            ? { items, first: page.PrevCursor ?? null, last: null }
            : { items, first: null, last: page.NextCursor ?? null },
        ],
        hasBefore: end && page.PrevCursor != null,
        hasAfter: !end && page.NextCursor != null,
        start: end ? (total == null ? null : total - items.length) : 0,
        asOf: page.AsOf ?? prev.shownAsOf ?? prev.asOf,
        shownAsOf: page.AsOf ?? prev.shownAsOf,
        count: prev.count,
        hidden: prev.hidden,
        newCount: prev.newCount,
        newCapped: prev.newCapped,
        reset: ++resets,
      };
    });
    const pair = (end ? items.at(-1) : items[0]) ?? null;
    if (pair) selectPair(pair.ID);
    return { pair };
  }

  /**
   * ⌘A: selects the whole query, not just the loaded rows: its text, the
   * exclusion and the newest pair shown as its as_of, so new matches stay
   * out. The top row is focused. The selection's count arrives after.
   */
  function selectAll() {
    const rows = tableRows(current);
    const { shownAsOf: asOf, count } = current.results;
    if (rows.length === 0 || !asOf) return;
    const query = {
      text: current.query.ranQuery,
      exclusion: [...current.exclusion],
      asOf,
      count: count ?? null,
    };
    const focus = String(rows[0].ID);
    const previous = current.selection;
    setSelection({
      ids: new Set(),
      anchor: String(rows.at(-1).ID),
      focus,
      incomingResponse: sameID(previous.focus, focus) ? previous.incomingResponse : null,
      query,
    });
    track(countSelection(query));
  }

  // Counts a ⌘A selection's pairs; dropped when the selection has changed.
  async function countSelection(query) {
    let counted;
    try {
      counted = await api.countTraffic(query.text, "", { AsOf: query.asOf });
    } catch (err) {
      console.error("Counting the selection failed:", err);
      return;
    }
    const now = current.selection.query;
    if (counted.QueryError || now?.asOf !== query.asOf || now.text !== query.text) return;
    setSelection({
      ...current.selection,
      query: { ...now, count: { count: counted.Count, capped: counted.Capped } },
    });
  }

  /**
   * Selects the pairs with these IDs that the table lists, focusing the
   * topmost. With none listed, clears the selection.
   */
  function selectListed(ids) {
    const wanted = new Set([...ids].map(String));
    const rows = tableRows(current).filter((row) => wanted.has(String(row.ID)));
    if (rows.length === 0) return clearSelection();
    selectIDs(rows.map((row) => String(row.ID)), rows[0].ID, rows[0].ID);
  }

  /**
   * Shows a selected pair in the drawer, keeping the selection. Any other
   * pair is selected alone.
   */
  function focusPair(id) {
    if (!isSelected(current, id)) return selectPair(id);
    const { ids, anchor, query } = current.selection;
    selectIDs(ids, anchor, id);
    if (query) setSelection({ ...current.selection, query });
  }

  // A drag across rows: the row it started on, or null when none is under way.
  let sweepFrom = null;

  /** Pressing a row starts a sweep: the row is selected alone. */
  function startSweep(id) {
    sweepFrom = String(id);
    selectPair(id);
  }

  /** Dragging over a row selects the range from where the sweep started. */
  function sweepTo(id) {
    if (sweepFrom == null) return;
    selectIDs(rowRange(tableRows(current), sweepFrom, id), sweepFrom, id);
  }

  function endSweep() {
    sweepFrom = null;
  }

  /** The loaded pair with this ID, or undefined. */
  function findShownPair(id) {
    return tableRows(current).find((item) => sameID(item.ID, id));
  }

  /**
   * The pair's number ("Request N"): Marasi's pair number, which follows
   * capture order and never changes, or "?" when the pair isn't loaded.
   */
  function pairNumber(id) {
    const outside = sameID(current.focusRow?.ID, id) ? current.focusRow : null;
    return (findShownPair(id) ?? outside)?.Number || "?";
  }

  /** The loaded pair whose pair number is `number`, or undefined. */
  function shownPairAtNumber(number) {
    return tableRows(current).find((item) => item.Number === number);
  }

  // The current query with `condition` too.
  function withinQuery(condition) {
    const text = current.query.ranQuery;
    return text ? `(${text}) AND ${condition}` : condition;
  }

  // The one pair of the current results that `condition` picks first under
  // `orderBy`, or null.
  async function onePair(condition, orderBy) {
    const page = await api.queryTraffic({
      ...pageRequest(withinQuery(condition), current.sort, { AsOf: current.results.asOf ?? "", Limit: 1 }),
      OrderBy: orderBy,
    });
    return page.QueryError ? null : (page.Items?.[0] ?? null);
  }

  // Pair `number` wherever it is: outside the query, the type exclusion and
  // the results' as_of. Null when the project has no such pair.
  async function anyPair(number) {
    const page = await api.queryTraffic({
      ...pageRequest(`number = ${number}`, current.sort, { Limit: 1 }),
      OrderBy: "number",
      IgnoreExclusion: true,
    });
    return page.QueryError ? null : (page.Items?.[0] ?? null);
  }

  // Selects only `pair`, which the loaded rows don't hold, and shows it in
  // the drawer; the table stays as it is.
  function focusOutside(pair) {
    const id = String(pair.ID);
    update((state) => ({
      ...state,
      selection: { ids: new Set([id]), anchor: id, focus: id, incomingResponse: null, query: null },
      focusRow: pair,
    }));
  }

  /**
   * A jump to pair `number` in the current results: the loaded pair; else,
   * under a pair-number sort, the rows around it read into a fresh window
   * with the query, sort and as_of left as they are (Marasi's cursors name
   * only the sort and the row, so the edges of the two reads keep paging the
   * same results); else the pair alone, selected and in the drawer while
   * the table stays as it is. A pair the results don't hold (the query or
   * the type filter leaves it out) opens on its own the same way. Returns
   * { pair }, or { reason: "missing" } when the project has no pair N.
   */
  async function goToNumber(number) {
    const found = await jumpWithin(number);
    if (found.pair) return found;
    // Not in these results (the query, the type filter, or newer than them):
    // it opens on its own, and the table stays as it is.
    let pair = null;
    try {
      pair = await anyPair(number);
    } catch (err) {
      console.error("Reading traffic failed:", err);
    }
    if (!pair) return { reason: "missing" };
    focusOutside(pair);
    return { pair };
  }

  // The jump within the current results; { reason: "missing" } when they
  // don't hold the pair.
  async function jumpWithin(number) {
    const shown = shownPairAtNumber(number);
    if (shown) return { pair: shown };
    if (current.sort.field !== "number") {
      let pair = null;
      try {
        pair = await onePair(`number = ${number}`, "number");
      } catch (err) {
        console.error("Reading traffic failed:", err);
      }
      if (!pair) return { reason: "missing" };
      focusOutside(pair);
      return { pair };
    }
    const { desc } = current.sort;
    const text = current.query.ranQuery;
    const within = (condition) => (text ? `(${text}) AND ${condition}` : condition);
    const asOf = current.results.asOf ?? "";
    // From N on (N first), and up to N (N last), read backward. These are
    // two walks joined at N, which Marasi's cursors don't promise to line
    // up in general (a pair can keep its pre-response place within one
    // walk); under a # sort no pair ever moves, so the joined window is
    // exact and each side pages on with its own walk's cursors.
    const from = within(`number ${desc ? "<=" : ">="} ${number}`);
    const upTo = within(`number ${desc ? ">=" : "<="} ${number}`);
    const gen = ++generation;
    loadingForward = loadingBackward = false;
    reading = true;
    let after, before, above;
    try {
      [after, before, above] = await Promise.all([
        api.queryTraffic(pageRequest(from, current.sort, { AsOf: asOf })),
        api.queryTraffic(pageRequest(upTo, current.sort, { AsOf: asOf, Direction: "backward" })),
        api.countTraffic(within(`number ${desc ? ">" : "<"} ${number}`), "", { AsOf: asOf }),
      ]);
    } catch (err) {
      console.error("Reading traffic failed:", err);
      if (gen === generation) reading = false;
      return { reason: "missing" };
    }
    if (gen !== generation) return { reason: "missing" };
    reading = false;
    const pair = after.Items?.[0];
    if (after.QueryError || before.QueryError || pair?.Number !== number) return { reason: "missing" };
    const items = [...(before.Items ?? []).slice(0, -1), ...(after.Items ?? [])];
    viewport = { first: 0, last: 0, atTop: false };
    updateResults((r) => ({
      ...resultsFromPage(after, "x"),
      chunks: [{ items, first: before.PrevCursor ?? null, last: after.NextCursor ?? null }],
      hasBefore: before.PrevCursor != null,
      start: above.Capped || above.QueryError ? null : above.Count - (items.length - (after.Items ?? []).length),
      asOf: r.asOf ?? after.AsOf ?? null,
      shownAsOf: r.shownAsOf ?? after.AsOf ?? null,
      count: r.count,
      hidden: r.hidden,
      reset: ++resets,
    }));
    return { pair };
  }


  function updateLayout(fn) {
    update((state) => ({ ...state, layout: fn(state.layout) }));
  }

  function setDock(dock) {
    updateLayout((layout) => ({ ...layout, dock: { ...layout.dock, ...dock } }));
  }

  return {
    subscribe,
    selectPair,
    clickRow,
    clearSelection,
    stepSelection,
    stepNumber,
    goToEdge,
    goToNumberEnd,
    selectAll,
    selectIDs: selectListed,
    focusPair,
    startSweep,
    sweepTo,
    endSweep,

    /** Sets the drawer's share of the table area's height (0-1). */
    setDrawerSplit: (split) =>
      updateLayout((layout) => ({
        ...layout,
        drawer: { ...layout.drawer, split: clampDrawerSplit(split) },
      })),
    /** Expands the drawer's details column from its rail, or collapses it. */
    setDrawerExpanded: (expanded) =>
      updateLayout((layout) => ({ ...layout, drawer: { ...layout.drawer, expanded: Boolean(expanded) } })),
    /** Maximises the open drawer over the table, or restores it. */
    toggleDrawerMaximised: () => {
      if (!isDrawerOpen(current)) return;
      updateLayout((layout) => ({
        ...layout,
        drawer: { ...layout.drawer, maximised: !layout.drawer.maximised },
      }));
    },
    /** Sets the dock's { width, collapsed }. */
    setDock,
    /** The dock's { width, collapsed } as a store with `set`, for Dock.svelte. */
    dockState: {
      subscribe: select({ subscribe }, (state) => state.layout.dock).subscribe,
      set: setDock,
    },
    clear: () => {
      generation++;
      projectVersion++;
      reading = false;
      exclusionLoaded = Promise.resolve();
      cancelDelay();
      cancelNewMatches();
      latestRequest++;
      requestBuffer = [];
      responseBuffer = new Map();
      loadingForward = loadingBackward = false;
      viewport = { first: 0, last: 0, atTop: true };
      sweepFrom = null;
      // The app default exclusion isn't the project's, so it stays.
      set({
        ...initialState(current.query.runID, current.layout, current.sort),
        defaultExclusion: current.defaultExclusion,
      });
    },
    populate,
    reload,
    settled,

    /**
     * The table reports the rows in view (window indexes) and whether it is
     * scrolled to the top; pages load around them.
     */
    setViewport: ({ first, last, atTop }) => {
      viewport = { first, last, atTop };
      loadAround();
    },
    sortBy,
    backToLive,
    countNewMatches,
    showNewMatches,
    goToTop,

    // Traffic events. They reach the table on the next flush, or at once
    // when the buffer is full.
    onRequest: (req) => {
      requestBuffer.push(req);
      if (requestBuffer.length > MAX_BUFFERED) flush();
    },
    onResponse: (res) => {
      if (sameID(current.selection.focus, res.ID)) {
        setSelection({ ...current.selection, incomingResponse: res });
      }
      responseBuffer.set(res.ID, res);
      if (responseBuffer.size > MAX_BUFFERED) flush();
    },
    flush,
    // A ws-open, ws-close or ws-state event changes its upgrade row.
    patchWebSocketMetadata: (conn) => {
      if (!conn?.RequestID) return;
      // The upgrade request may still be waiting in the buffer; a failed
      // handshake's ws-state arrives right behind it.
      flush();
      patchMetadata(conn.RequestID, webSocketMetadataPatch(conn));
    },
    patchMetadata,

    setQueryText: (queryText) => update((state) => ({ ...state, queryText })),
    runQuery,
    scheduleQuery,
    rerunQuery,
    clearQuery,

    /**
     * Adds `term` to the query box, or removes it when the query has it as a
     * condition of its own, and runs the result at once (a menu's choice).
     */
    toggleQueryTerm: (term) => {
      const text = toggleQueryTerm(current.queryText, term);
      update((state) => ({ ...state, queryText: text }));
      return runQuery(text);
    },

    /**
     * Counts the pairs each query matches, minus the content-type exclusion:
     * { [query]: { count, capped } }, or null for a query that failed. Counts
     * stop at marasi's cap, 100,000; `capped` means more matched.
     */
    countQueries: async (queries) => {
      const counts = await Promise.all(
        queries.map(async (query) => {
          try {
            const result = await api.countTraffic(query, "");
            return result.QueryError ? null : { count: result.Count, capped: result.Capped };
          } catch (err) {
            console.error(`Counting matches for ${query} failed:`, err);
            return null;
          }
        }),
      );
      return Object.fromEntries(queries.map((query, i) => [query, counts[i]]));
    },

    // Gives the project its own content-type exclusion, normalised as Marasi
    // does, then reads the results again from the top so they reflect it.
    // The drawer closes when the exclusion hides its pair.
    saveExclusion: async (types) => {
      const exclusion = [...new Set(types.map(normalizeContentType))];
      applyExclusion(exclusion, true);
      await api.setExclusion(exclusion);
      await rerunQuery();
    },
    // Drops the project's own exclusion so it follows the app default again.
    resetExclusion: async () => {
      await api.resetExclusion();
      applyExclusion(await api.getExclusion(), false);
      await rerunQuery();
    },
    loadTypeCounts,
    // Reads the app default exclusion into `defaultExclusion` and returns it.
    loadDefaultExclusion: async () => {
      const defaultExclusion = await api.getDefaultExclusion();
      update((state) => ({ ...state, defaultExclusion }));
      return defaultExclusion;
    },
    // Replaces the app default exclusion. A project that follows it hides
    // the new list at once.
    saveDefaultExclusion: async (types) => {
      const defaultExclusion = [...new Set(types.map(normalizeContentType))];
      update((state) => ({ ...state, defaultExclusion }));
      const follows = current.ownExclusion === false;
      if (follows) applyExclusion(defaultExclusion, false);
      await api.setDefaultExclusion(defaultExclusion);
      if (follows) await rerunQuery();
    },

    findShownPair,
    pairNumber,
    goToNumber,
    shownPairAtNumber,

    /** The request pickers' options: the newest pairs matching `text`. */
    searchRequests: (text) => searchRequests(api.queryTraffic, text),
    getDetails: (id) => api.getRawDetails(id),
    getMetadata: (id) => api.getMetadata(id),
    getNote: (id) => api.getNote(id),
    saveNote,
    setHighlight,

    refresh,

    // Bulk actions on a selection in Marasi's shape (selectionSpec): one
    // call each, which resolves to how many pairs Marasi changed. Marasi
    // emits no event for them, so the rows are read again in place.
    sendToNewLaunchpad,
    sendToLaunchpadsEach,
    addToLaunchpad: (selection, id) => link(selection, "launchpad", id),
    removeFromLaunchpad: (selection, id) => showLaunching(unlink(selection, "launchpad", id)),
    linkToFinding: (selection, id) => link(selection, "finding", id),
    unlinkFromFinding: (selection, id) => unlink(selection, "finding", id),
    linkToTestCase: (selection, id) => link(selection, "test_case", id),
    unlinkFromTestCase: (selection, id) => unlink(selection, "test_case", id),
    /** Adds `text` to each pair's note, after a blank line when it has one. */
    appendNote: (selection, text) => changed(api.appendNote(selection, text)),
    clearNotes: (selection) => changed(api.clearNotes(selection)),
    deleteFromProject,
    findingEvidence,
    /** One Armory template per pair; `results` holds the templates made. */
    sendToArmory: (ids) => eachPair(ids, (id) => api.sendToArmory(id)),
  };

  /**
   * Gives the pairs of `target` (a selection in Marasi's shape, or an array
   * of pair IDs) highlight `number` (1-8), or clears their
   * highlights when it is null, in one bulk call. Marasi emits no event for
   * it, so the loaded rows are repainted here, in place: none move, even
   * when they no longer match the query. Resolves to the number of pairs
   * Marasi changed.
   */
  async function setHighlight(target, number) {
    // A selection (selectionSpec), or the IDs of listed pairs.
    const selection = Array.isArray(target) ? { ids: target.map(String) } : target;
    const changed =
      number == null
        ? await api.clearHighlight(selection)
        : await api.setHighlight(selection, number);
    patchPairs(loadedIn(selection), (item) =>
      (item.Highlight ?? null) !== number ? { ...item, Highlight: number } : item,
    );
    return changed;
  }

  // Runs `fn` on each pair in turn. A failure is logged and counted, and the
  // rest still run.
  async function eachPair(ids, fn) {
    const results = [];
    let failed = 0;
    for (const id of ids) {
      try {
        results.push(await fn(id));
      } catch (err) {
        console.error(`Acting on pair ${id} failed:`, err);
        failed += 1;
      }
    }
    return { done: results.length, failed, results };
  }

  // The IDs of the loaded rows a selection covers.
  function loadedIn(selection) {
    if (selection.ids) return selection.ids.map(String);
    const sameResults =
      selection.query === current.query.ranQuery &&
      selection.exclusion.join() === current.exclusion.join();
    return sameResults ? coveredRows(current, selection.as_of) : [];
  }

  // Waits for a bulk operation's count, then reads the rows again in place
  // so they show the change.
  async function changed(operation) {
    const count = await operation;
    await refresh();
    return count;
  }

  // Links or unlinks the selection and a launchpad, finding or test case. A
  // link can change what the query matches.
  function link(selection, kind, id) {
    return changed(api.linkTraffic(selection, { Kind: kind, ID: id }));
  }
  function unlink(selection, kind, id) {
    return changed(api.unlinkTraffic(selection, { Kind: kind, ID: id }));
  }

  // Waits for a delete or a removal from a launchpad. When Marasi refuses it
  // for pairs still launching (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md), nothing changed: the loaded
  // ones become the selection, so the researcher sees which, and the error
  // goes on.
  async function showLaunching(operation) {
    try {
      return await operation;
    } catch (err) {
      const pending = new Set(pendingLaunchIDs(err) ?? []);
      const loaded = tableRows(current)
        .map((row) => String(row.ID))
        .filter((id) => pending.has(id));
      if (loaded.length) selectIDs(loaded, loaded[0], loaded[0]);
      throw err;
    }
  }

  /**
   * Deletes the selection from the project, with its notes, links and
   * WebSocket messages, then clears the selection and reads the rows again.
   */
  async function deleteFromProject(selection) {
    const count = await showLaunching(api.deleteTraffic(selection));
    clearSelection();
    await refresh();
    return count;
  }

  /**
   * How many of the selection's pairs are evidence in a finding: for listed
   * pairs from `findings` (each with Requests), for ⌘A by counting the
   * query's pairs linked to a finding.
   */
  async function findingEvidence(selection, findings = []) {
    if (selection.ids) {
      const linked = new Set(findings.flatMap((finding) => (finding.Requests ?? []).map(String)));
      return selection.ids.filter((id) => linked.has(String(id))).length;
    }
    const text = selection.query.trim() ? `(${selection.query}) AND finding:*` : "finding:*";
    const counted = await api.countTraffic(text, "", { AsOf: selection.as_of });
    return counted.QueryError ? 0 : counted.Count;
  }

  // A launchpad named for its pairs: "Request N", or "N requests".
  function launchpadName(ids, numberOf = pairNumber) {
    const numbers = ids.map((id) => numberOf(id));
    if (ids.length === 1) {
      return ["Request " + numbers[0], "Launchpad for Request " + numbers[0]];
    }
    return [`${ids.length} requests`, "Launchpad for Requests " + numbers.join(", ")];
  }

  /**
   * Creates one launchpad and links the selection to it. Listed pairs name
   * it after their numbers; a ⌘A selection after `count`. `numberOf(id)`
   * gives a pair's number when the caller knows pairs the Ledger hasn't
   * loaded.
   */
  async function sendToNewLaunchpad(selection, count = null, { numberOf = pairNumber } = {}) {
    const name = selection.ids
      ? launchpadName(selection.ids, numberOf)
      : count == null
        ? ["Matching requests", "Launchpad for the matching requests"]
        : [requestCount(count), `Launchpad for ${requestCount(count)}`];
    const launchpadId = await api.createLaunchpad(...name);
    let linked;
    try {
      linked = await link(selection, "launchpad", launchpadId);
    } catch (err) {
      // Marasi refused the selection (its query waits on a job still
      // building) and linked nothing: the launchpad goes again rather than
      // stay empty.
      if (incompleteJobs(err)) {
        await api.deleteLaunchpad(launchpadId).catch((cause) => console.error("Removing the empty launchpad failed:", cause));
      }
      throw err;
    }
    return { launchpadId, count: linked };
  }

  /** Creates a launchpad for each pair, up to LAUNCHPADS_EACH_MAX. */
  async function sendToLaunchpadsEach(ids) {
    if (ids.length > LAUNCHPADS_EACH_MAX) {
      throw new Error(`One launchpad each works on up to ${LAUNCHPADS_EACH_MAX} requests`);
    }
    const { results, failed } = await eachPair(ids, async (id) => {
      const launchpadId = await api.createLaunchpad(...launchpadName([id]));
      await api.linkTraffic({ ids: [String(id)] }, { Kind: "launchpad", ID: launchpadId });
      return launchpadId;
    });
    await refresh();
    return { launchpadIds: results, done: results.length, failed };
  }
}
