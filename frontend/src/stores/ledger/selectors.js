// Read-only views of the Ledger's state for the page and the keybindings: labels, the drawer's pair, the selection and what an action targets.
import { sameID } from "../../lib/ledger/pairs.js";
import { formatCount, matchNoun } from "../../lib/ledger/counts.js";
import { DEFAULT_SORT, tableRows } from "./state.js";

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

/** Shown while a query is active and older traffic is still being indexed. */
export function indexWarning(state) {
  return isQueryActive(state.query) && !state.results.indexComplete
    ? "Search index still building"
    : "";
}
