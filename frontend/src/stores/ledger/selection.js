// The selection: clicks, ⇧ and ⌘ ranges, sweeps, ⌘A over the whole query, and focusing a pair in the drawer.
import { sameID } from "../../lib/ledger/pairs.js";
import { emptySelection, rowRange, tableRows } from "./state.js";
import { isSelected } from "./selectors.js";

/** The selection; ⌘A counts its pairs through `api`. */
export function createSelection(core, api) {
  const { update, track } = core;

  function setSelection(selection) {
    update((state) => ({ ...state, selection }));
  }

  // Selects `ids` with this anchor and focus. The incoming response stays
  // only while the focus does.
  function selectIDs(ids, anchor, focus) {
    const previous = core.current.selection;
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
    const { ids, focus } = core.current.selection;
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
    const { ids, anchor } = core.current.selection;
    if (range && anchor != null) {
      const span = rowRange(tableRows(core.current), anchor, id);
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
   * ⌘A: selects the whole query, not just the loaded rows: its text, the
   * exclusion and the newest pair shown as its as_of, so new matches stay
   * out. The top row is focused. The selection's count arrives after.
   */
  function selectAll() {
    const rows = tableRows(core.current);
    const { shownAsOf: asOf, count } = core.current.results;
    if (rows.length === 0 || !asOf) return;
    const query = {
      text: core.current.query.ranQuery,
      exclusion: [...core.current.exclusion],
      asOf,
      count: count ?? null,
    };
    const focus = String(rows[0].ID);
    const previous = core.current.selection;
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
    const now = core.current.selection.query;
    if (counted.QueryError || now?.asOf !== query.asOf || now.text !== query.text) return;
    setSelection({
      ...core.current.selection,
      query: { ...now, count: { count: counted.Count, capped: counted.Capped } },
    });
  }

  /**
   * Selects the pairs with these IDs that the table lists, focusing the
   * topmost. With none listed, clears the selection.
   */
  function selectListed(ids) {
    const wanted = new Set([...ids].map(String));
    const rows = tableRows(core.current).filter((row) => wanted.has(String(row.ID)));
    if (rows.length === 0) return clearSelection();
    selectIDs(rows.map((row) => String(row.ID)), rows[0].ID, rows[0].ID);
  }

  /**
   * Shows a selected pair in the drawer, keeping the selection. Any other
   * pair is selected alone.
   */
  function focusPair(id) {
    if (!isSelected(core.current, id)) return selectPair(id);
    const { ids, anchor, query } = core.current.selection;
    selectIDs(ids, anchor, id);
    if (query) setSelection({ ...core.current.selection, query });
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
    selectIDs(rowRange(tableRows(core.current), sweepFrom, id), sweepFrom, id);
  }

  function endSweep() {
    sweepFrom = null;
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

  return {
    setSelection,
    selectIDs,
    selectPair,
    clickRow,
    clearSelection,
    selectAll,
    selectListed,
    focusPair,
    focusOutside,
    startSweep,
    sweepTo,
    endSweep,
    // A project switch ends a sweep under way.
    reset: () => {
      sweepFrom = null;
    },
  };
}
