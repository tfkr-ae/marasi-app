// The Ledger store: the rows the table shows, the query, the sort, the
// content-type exclusion and new matches. Every backend call goes through
// the injected `api` (ledgerApi.js maps the service to it), so this module
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
//
// The store is split by area under ledger/; this file holds the state's
// core (`set` and its invariants), the layout, and the public API:
// - ledger/state.js: the state's shape and pure helpers over rows.
// - ledger/selectors.js: read-only views (labels, the selection's target).
// - ledger/window.js: reading pages into the window, counts, new matches.
// - ledger/live.js: live traffic events and other clients' changes.
// - ledger/query.js: the query box and the sort.
// - ledger/exclusion.js: the content-type exclusion, populate and resync.
// - ledger/selection.js: clicks, ranges, sweeps and ⌘A.
// - ledger/navigation.js: steps, jumps by number and the results' edges.
// - ledger/bulk.js: notes, highlights and bulk actions on a selection.
import { writable } from "svelte/store";
import { searchRequests } from "../lib/requestPicker.js";
import { select } from "../lib/storeSelect.js";
import { sameID } from "../lib/ledger/pairs.js";
import {
  clampDrawerSplit,
  emptySelection,
  initialState,
  prunedSelection,
  tableRows,
  withQueryRows,
} from "./ledger/state.js";
import { isDrawerOpen } from "./ledger/selectors.js";
import { createWindow } from "./ledger/window.js";
import { createLive } from "./ledger/live.js";
import { createQuery } from "./ledger/query.js";
import { createExclusion } from "./ledger/exclusion.js";
import { createSelection } from "./ledger/selection.js";
import { createNavigation } from "./ledger/navigation.js";
import { createBulk } from "./ledger/bulk.js";

export { DRAWER_SPLIT, DEFAULT_SORT, clampDrawerSplit, tableRows } from "./ledger/state.js";
export {
  allSelectedLabel,
  countLabel,
  drawerKeybindingState,
  focusedPair,
  hiddenByTypeCount,
  indexWarning,
  isAllSelected,
  isDrawerOpen,
  isLiveNewestFirst,
  isQueryActive,
  isSelected,
  newMatchesKind,
  newMatchesLabel,
  newMatchesNotSelected,
  rowMenuTarget,
  selectedPairs,
  selectionSize,
  selectionSpec,
  selectionTarget,
} from "./ledger/selectors.js";
export {
  EDGE_ROWS,
  MAX_WINDOW_ROWS,
  NEW_MATCHES_DELAY_MS,
  NEW_MATCHES_MAX_WAIT_MS,
  PAGE_SIZE,
  orderBy,
} from "./ledger/window.js";
export { EVENT_SETTLE_MS, FLUSH_INTERVAL_MS } from "./ledger/live.js";
export { QUERY_DELAY_MS } from "./ledger/query.js";

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

  function update(fn) {
    set(fn(current));
  }
  function updateResults(fn) {
    update((state) => ({ ...state, results: fn(state.results) }));
  }

  // Pages and counts in flight, so tests and callers can wait for them.
  const inflight = new Set();
  function track(promise) {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
    return promise;
  }

  /** Waits until no page or count is in flight. */
  async function settled() {
    while (inflight.size > 0) await Promise.allSettled([...inflight]);
  }

  // What every area shares: the state as it is now, and the ways to change it.
  const core = {
    get current() {
      return current;
    },
    update,
    updateResults,
    track,
  };

  const win = createWindow(core, api, { exclusionLoaded: () => exclusion.loaded() });
  const exclusion = createExclusion(core, api, win);
  const query = createQuery(core, api, win);
  const sel = createSelection(core, api, { knownCount: win.knownCount });
  const live = createLive(core, api, win, sel);
  const nav = createNavigation(core, api, win, sel);
  const bulk = createBulk(core, api, {
    refresh: win.refresh,
    patchPairs: live.patchPairs,
    patchMetadata: live.patchMetadata,
    selectIDs: sel.selectIDs,
    clearSelection: sel.clearSelection,
    pairNumber: nav.pairNumber,
  });

  function updateLayout(fn) {
    update((state) => ({ ...state, layout: fn(state.layout) }));
  }

  function setDock(dock) {
    updateLayout((layout) => ({ ...layout, dock: { ...layout.dock, ...dock } }));
  }

  return {
    subscribe,
    selectPair: sel.selectPair,
    clickRow: sel.clickRow,
    clearSelection: sel.clearSelection,
    stepSelection: nav.stepSelection,
    stepNumber: nav.stepNumber,
    goToEdge: nav.goToEdge,
    goToNumberEnd: nav.goToNumberEnd,
    selectAll: sel.selectAll,
    selectIDs: sel.selectListed,
    focusPair: sel.focusPair,
    startSweep: sel.startSweep,
    sweepTo: sel.sweepTo,
    endSweep: sel.endSweep,

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
      win.reset();
      exclusion.reset();
      live.reset();
      query.reset();
      sel.reset();
      // The app default exclusion isn't the project's, so it stays.
      set({
        ...initialState(current.query.runID, current.layout, current.sort),
        defaultExclusion: current.defaultExclusion,
      });
    },
    populate: exclusion.populate,
    resync: exclusion.resync,
    reload: win.reload,
    forgetCount: win.forgetCount,
    settled,

    // Another client's changes, from the stream (ledgerStore.js).
    onTrafficChanged: live.onTrafficChanged,
    onMetadataUpdated: live.onMetadataUpdated,
    onNoteUpdated: live.onNoteUpdated,
    onNoteDeleted: live.onNoteDeleted,
    onIndexComplete: live.onIndexComplete,

    /**
     * The table reports the rows in view (window indexes) and whether it is
     * scrolled to the top; pages load around them.
     */
    setViewport: ({ first, last, atTop }) => {
      win.viewport = { first, last, atTop };
      win.loadAround();
    },
    sortBy: query.sortBy,
    backToLive: query.backToLive,
    countNewMatches: win.countNewMatches,
    showNewMatches: win.showNewMatches,
    goToTop: win.goToTop,

    // Traffic events. They reach the table on the next flush, or at once
    // when the buffer is full.
    onRequest: live.onRequest,
    onResponse: live.onResponse,
    flush: live.flush,
    patchWebSocketMetadata: live.patchWebSocketMetadata,
    patchMetadata: live.patchMetadata,

    setQueryText: query.setQueryText,
    runQuery: query.runQuery,
    scheduleQuery: query.scheduleQuery,
    rerunQuery: query.rerunQuery,
    clearQuery: query.clearQuery,
    toggleQueryTerm: query.toggleQueryTerm,
    countQuery: query.countQuery,

    saveExclusion: exclusion.saveExclusion,
    resetExclusion: exclusion.resetExclusion,
    loadTypeCounts: exclusion.loadTypeCounts,
    loadDefaultExclusion: exclusion.loadDefaultExclusion,
    saveDefaultExclusion: exclusion.saveDefaultExclusion,

    findShownPair: nav.findShownPair,
    pairNumber: nav.pairNumber,
    goToNumber: nav.goToNumber,
    shownPairAtNumber: nav.shownPairAtNumber,

    /** The request pickers' options: the newest pairs matching `text`. */
    searchRequests: (text) => searchRequests(api.queryTraffic, text),
    getDetails: (id, parts) => api.getRawDetails(id, parts),
    getMetadata: (id) => api.getMetadata(id),
    getNote: (id) => api.getNote(id),
    saveNote: bulk.saveNote,
    setHighlight: bulk.setHighlight,

    refresh: win.refresh,

    // Bulk actions on a selection in Marasi's shape (selectionSpec); see
    // ledger/bulk.js.
    sendToNewLaunchpad: bulk.sendToNewLaunchpad,
    sendToLaunchpadsEach: bulk.sendToLaunchpadsEach,
    addToLaunchpad: bulk.addToLaunchpad,
    removeFromLaunchpad: bulk.removeFromLaunchpad,
    linkToFinding: bulk.linkToFinding,
    unlinkFromFinding: bulk.unlinkFromFinding,
    linkToTestCase: bulk.linkToTestCase,
    unlinkFromTestCase: bulk.unlinkFromTestCase,
    appendNote: bulk.appendNote,
    clearNotes: bulk.clearNotes,
    deleteFromProject: bulk.deleteFromProject,
    findingEvidence: bulk.findingEvidence,
    sendToArmory: bulk.sendToArmory,
  };
}
