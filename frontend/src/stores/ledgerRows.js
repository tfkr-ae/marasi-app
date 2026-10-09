// The rows the ledger is currently showing, and lookups into them by pair ID.
//
// Anything outside the ledger table that acts on a row (the request/response
// drawer, its next/previous navigation, the context menu, notes, metadata and
// highlights) must find its pair here by ID, never by a row position, because
// the order and contents of the shown rows depend on the active source.
//
// Today the only source is the live view (`proxyItems`). Query results will be
// added as a second source.
//
// Plain module: no Svelte component dependencies.
import { derived, get } from "svelte/store";
import { proxyItems } from "../stores";

/** The store holding the rows of the active source. */
function activeSource() {
  return proxyItems;
}

/** Rows currently shown in the ledger, in source order. */
export const shownRows = derived(activeSource(), ($items) =>
  Array.isArray($items) ? $items : [],
);

function sameID(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/** Position of the pair in the shown rows, or -1 when it isn't shown. */
export function findShownPairIndex(id) {
  return get(shownRows).findIndex((item) => sameID(item.ID, id));
}

/** The shown pair with this ID, or undefined. */
export function findShownPair(id) {
  return get(shownRows).find((item) => sameID(item.ID, id));
}

/**
 * The pair's request number as the ledger displays it ("Request N"), or
 * undefined when the pair isn't shown.
 */
export function shownPairNumber(id) {
  const index = findShownPairIndex(id);
  return index === -1 ? undefined : index + 1;
}

/** The shown pair at a 1-based request number, or undefined. */
export function shownPairAtNumber(number) {
  return get(shownRows)[number - 1];
}

/**
 * Merges `patch` into the Metadata of the shown pair with this ID and notifies
 * subscribers. Does nothing when the pair isn't shown.
 */
export function patchShownPairMetadata(id, patch) {
  activeSource().update((items) => {
    const item = (items || []).find((it) => sameID(it.ID, id));
    if (item) {
      if (!item.Metadata) item.Metadata = {};
      Object.assign(item.Metadata, patch);
    }
    return items;
  });
}
