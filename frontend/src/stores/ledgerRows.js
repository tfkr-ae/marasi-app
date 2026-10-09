// The rows the ledger is currently showing, and lookups into them by pair ID.
//
// Anything outside the ledger table that acts on a row (the request/response
// drawer, its next/previous navigation, the context menu, notes, metadata and
// highlights) must find its pair here by ID, never by a row position, because
// the order and contents of the shown rows depend on the active source.
//
// The active source is the query results while a query is active, and the
// live view (`proxyItems`) otherwise.
//
// A pair's request number ("Request N") is its position in the live view in
// both modes, so a number always names the same pair.
//
// Plain module: no Svelte component dependencies.
import { derived, get } from "svelte/store";
import { pagination, patchLiveViewMetadata, proxyItems } from "../stores";
import {
  isQueryActive,
  ledgerQuery,
  markTrafficChanged,
  patchQueryResultMetadata,
  queryActive,
  queryPageIndex,
  sameID,
} from "./ledgerQuery";

/** Rows currently shown in the ledger, in source order. */
export const shownRows = derived(
  [proxyItems, ledgerQuery],
  ([$items, $query]) => {
    if (isQueryActive($query)) return $query.items;
    return Array.isArray($items) ? $items : [];
  },
);

/**
 * The ledger table's pagination: the rows per page are shared, and the page
 * index belongs to the active mode, so each mode keeps its own page.
 */
export const ledgerPagination = derived(
  [pagination, queryActive, queryPageIndex],
  ([$pagination, $queryActive, $queryPageIndex]) => ({
    pageSize: $pagination.pageSize,
    pageIndex: $queryActive ? $queryPageIndex : $pagination.pageIndex,
  }),
);

/** Changes the ledger table's pagination (a value or TanStack updater). */
export function setLedgerPagination(updater) {
  const current = get(ledgerPagination);
  const next = updater instanceof Function ? updater(current) : updater;
  if (get(queryActive)) {
    queryPageIndex.set(next.pageIndex);
    pagination.update((old) => ({ ...old, pageSize: next.pageSize }));
  } else {
    pagination.set({ pageIndex: next.pageIndex, pageSize: next.pageSize });
  }
}

/** The shown pair with this ID, or undefined. */
export function findShownPair(id) {
  return get(shownRows).find((item) => sameID(item.ID, id));
}

// Live-view numbers by pair ID, extended as pairs are appended to the live
// view and rebuilt when it is replaced, so lookups stay cheap per table cell.
const numbering = { items: null, counted: 0, numbers: new Map() };

function liveViewNumber(id) {
  const items = get(proxyItems) || [];
  if (items !== numbering.items || items.length < numbering.counted) {
    numbering.items = items;
    numbering.counted = 0;
    numbering.numbers = new Map();
  }
  for (let i = numbering.counted; i < items.length; i++) {
    numbering.numbers.set(String(items[i].ID), i + 1);
  }
  numbering.counted = items.length;
  return numbering.numbers.get(String(id));
}

/**
 * The pair's request number as the ledger displays it ("Request N"): its
 * position in the live view, in both modes. A pair that hasn't reached the
 * live view yet, such as one captured moments ago, gets "?" rather than a
 * number that names a different pair.
 */
export function pairNumber(id) {
  return liveViewNumber(id) ?? "?";
}

/**
 * The shown pair whose request number is `number`, or undefined when no pair
 * has that number or the ledger isn't showing it.
 */
export function shownPairAtNumber(number) {
  const pair = (get(proxyItems) || [])[number - 1];
  return pair && findShownPair(pair.ID);
}

/**
 * Merges `patch` into the Metadata of the pair with this ID, in the live view
 * and in the loaded query results and new matches, and notifies subscribers.
 * A source that doesn't hold the pair is left alone. The edit can change what
 * the query matches, so it also marks traffic as changed.
 */
export function patchShownPairMetadata(id, patch) {
  patchLiveViewMetadata(id, patch);
  patchQueryResultMetadata(id, patch);
  markTrafficChanged();
}
