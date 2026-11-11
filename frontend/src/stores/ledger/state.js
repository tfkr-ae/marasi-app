// The Ledger store's state: its shape, the pure helpers over rows and the window, and the selection's invariants.
import { LEDGER_DOCK } from "../../lib/dock/dock.js";
import { pairIDSet, sameID } from "../../lib/ledger/pairs.js";
import { DEFAULT_SORT } from "../../lib/ledger/table.js";

/** The drawer's share of the table area's height: default and limits. */
export const DRAWER_SPLIT = { default: 0.42, min: 0.15, max: 0.85 };

/** The default sort: newest first. */
export { DEFAULT_SORT };

export function emptyResults() {
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

export function emptyQueryState(runID = 0) {
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
export function initialLayout() {
  return {
    // The sitemap dock: its width in px, and whether it is collapsed to a strip.
    dock: { width: LEDGER_DOCK.default, collapsed: false },
    // The drawer's share of the table area's height, whether it covers the
    // table, and whether its details column is expanded from the rail.
    drawer: { split: DRAWER_SPLIT.default, maximised: false, expanded: false },
  };
}

export function emptySelection() {
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

export function initialState(runID = 0, layout = initialLayout(), sort = DEFAULT_SORT) {
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

// The IDs of the rows from `a` to `b` in table order, both included; just
// [b] when either has left the table.
export function rowRange(rows, a, b) {
  const i = rows.findIndex((row) => sameID(row.ID, a));
  const j = rows.findIndex((row) => sameID(row.ID, b));
  if (i < 0 || j < 0) return [String(b)];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((row) => String(row.ID));
}

/** `split` within the drawer's limits. */
export function clampDrawerSplit(split) {
  return Math.min(DRAWER_SPLIT.max, Math.max(DRAWER_SPLIT.min, split));
}

// A live event's pair as a table row: without the raw and prettified
// bodies, which the drawer reads itself.
export function withoutBodies(pair) {
  if (!("Raw" in pair) && !("Prettified" in pair)) return pair;
  const { Raw, Prettified, ...row } = pair;
  return row;
}

// Applies `fn` to every row of `chunks`; returns `chunks` itself when `fn`
// replaced none.
export function mapChunks(chunks, fn) {
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
export function locate(chunks, index) {
  let start = 0;
  for (let c = 0; c < chunks.length; c++) {
    const length = chunks[c].items.length;
    if (index < start + length) return { c, k: index - start, start };
    start += length;
  }
  return null;
}

// The selection only holds pairs the results list: when a query, an
// exclusion or a project switch removes some, they leave the selection.
// When the focused pair leaves, the focus moves to the last one left, and
// with none left the drawer closes.
export function prunedSelection(state) {
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
export function withQueryRows(state) {
  const selection = state.selection;
  const ids = coveredRows(state, selection.query.asOf);
  if (ids.length === selection.ids.size && ids.every((id) => selection.ids.has(id))) return selection;
  return { ...selection, ids: new Set(ids) };
}

// The IDs of the loaded rows captured up to `asOf`.
export function coveredRows(state, asOf) {
  const ids = [];
  for (const row of tableRows(state)) if (String(row.ID) <= asOf) ids.push(String(row.ID));
  return ids;
}
