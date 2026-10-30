// The Armory's run traffic view: the selected run's pairs, read from Marasi
// a page at a time in the order the researcher sorted them, the pair open
// in the drawer, and the Selection the row menu acts on. Backend calls go through the injected `api`
// ({ queryRunTraffic(runId, TrafficPageRequest) }); armoryStore.js binds it
// to QueryArmoryRunTraffic.
//
// The rows are a list: a narrowing of the run's query ("" for the whole
// run) read page by page with Marasi's cursor under one AsOf, so sorted
// rows never move. Later views (a group per value) hold more lists of the
// same shape.
import { writable } from "svelte/store";
import { sameID } from "../lib/ledger/pairs.js";
import { stepRequest } from "../lib/armory/traffic.js";
import { pairTarget } from "../lib/armory/rowMenu.js";

/** How many pairs one read asks for. */
export const RUN_TRAFFIC_PAGE_SIZE = 200;

/** The most pairs one read may ask for, as QueryTraffic bounds it. */
const MAX_PAGE_SIZE = 1000;

function emptyList(narrowing = "") {
  return {
    narrowing,
    rows: [],
    // The cursor at the last row read; null before the first read.
    next: null,
    hasMore: false,
    asOf: null,
    loading: false,
    loaded: false,
    failed: false,
    // Pairs sent since the read that join the end once the last page is
    // read (# order only).
    tail: [],
    // IDs of pairs sent since the read that wait to be shown (sorted only).
    newIds: [],
  };
}

// The Selection lists pairs by ID, as Marasi's { ids } selection. A whole
// group or the run would be a query with its as_of instead.
function emptySelection() {
  return {
    // The selected pairs' IDs, as strings. Replaced, never mutated, so a
    // subscriber can tell a change by identity.
    ids: new Set(),
    // The selected pairs' last copies by ID, for the ones a sort's read
    // from the top hasn't reached again.
    rows: new Map(),
    // Where ⇧-click ranges start: the last pair clicked without ⇧.
    anchor: null,
  };
}

function initialState(sort = { column: null, desc: false }) {
  return {
    runId: null,
    // column is null for # order, else "number", "time", "status" or "size".
    sort,
    list: emptyList(),
    // The pair open in the drawer, by ID, so it follows its row's updates;
    // openRow is its last copy, for when the rows no longer hold it (a sort
    // read from the top).
    openId: null,
    openRow: null,
    selection: emptySelection(),
    // Where the table was scrolled, so a page visit comes back to it.
    scrollTop: 0,
  };
}

const ORDER_FIELDS = {
  number: "requested_at",
  time: "requested_at",
  status: "status_code",
  size: "length",
};

/** Marasi's order_by for `sort`. */
export function orderBy(sort) {
  if (!sort.column) return "requested_at";
  return ORDER_FIELDS[sort.column] + (sort.desc ? " desc" : "");
}

/** The column the table is sorted by, or null in # order. */
export function sortedColumn(state) {
  return state.sort.column;
}

/** The rows the table shows, in its order. */
export function runTrafficRows(state) {
  return state.list.rows;
}

// The IDs of the rows shown from `a` to `b`, both included, in the table's
// order; just [b] when `a` is not shown.
function rowRange(rows, a, b) {
  const i = rows.findIndex((row) => sameID(row.ID, a));
  const j = rows.findIndex((row) => sameID(row.ID, b));
  if (i < 0 || j < 0) return [String(b)];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((row) => String(row.ID));
}

/** True when the pair with this ID is in the Selection. */
export function isPairSelected(state, id) {
  return id != null && state.selection.ids.has(String(id));
}

/** "n selected" while a Selection exists, else "". */
export function runSelectionLabel(state) {
  const n = state.selection.ids.size;
  return n ? `${n.toLocaleString()} selected` : "";
}

/**
 * The selected pairs: the rows shown in the table's order, then the ones a
 * sort's read hasn't reached again.
 */
function selectedPairs(state) {
  const { ids, rows } = state.selection;
  if (ids.size === 0) return [];
  const shown = runTrafficRows(state).filter((row) => ids.has(String(row.ID)));
  const seen = new Set(shown.map((row) => String(row.ID)));
  return [...shown, ...[...ids].filter((key) => !seen.has(key)).map((key) => rows.get(key)).filter(Boolean)];
}

/**
 * What the row menu acts on when this row is right-clicked, in the shape
 * of lib/armory/rowMenu.js's pairTarget: the Selection when the row is in
 * it, else the row alone. The Selection stays as it was.
 */
export function runRowMenuTarget(state, id) {
  if (isPairSelected(state, id)) {
    const pairs = selectedPairs(state);
    return { pairs, selection: { ids: pairs.map((pair) => String(pair.ID)) }, count: pairs.length };
  }
  const pair = runTrafficRows(state).find((row) => sameID(row.ID, id));
  return pair ? pairTarget(pair) : { pairs: [], selection: null, count: 0 };
}

/** "n new" while sent pairs wait to be shown; "" when none do. */
export function runTrafficNewLabel(state) {
  const n = state.list.newIds.length;
  return n ? `${n.toLocaleString()} new` : "";
}

/**
 * True when a pair the run sends belongs at the end of the rows: # order,
 * or # or Time ascending.
 */
function joinsAtEnd(sort) {
  return orderBy(sort) === "requested_at";
}

function withoutBodies(pair) {
  if (!("Raw" in pair) && !("Prettified" in pair)) return pair;
  const { Raw, Prettified, ...row } = pair;
  return row;
}

/** The pair open in the drawer, or null. */
export function openRunPair(state) {
  if (state.openId == null) return null;
  return runTrafficRows(state).find((row) => sameID(row.ID, state.openId)) ?? state.openRow;
}

export function createRunTrafficView(api) {
  const { subscribe, set, update } = writable(initialState());
  let current = initialState();
  subscribe((state) => (current = state));
  // Bumped by every change that makes a read under way stale.
  let generation = 0;
  // Request and response events wait here until the next flush, so a burst
  // updates the rows once.
  let requestBuffer = [];
  let responseBuffer = new Map();
  // The read a flush started, for settled().
  let reading = Promise.resolve();

  function updateList(fn) {
    update((state) => ({ ...state, list: fn(state.list) }));
  }

  // Reads the rows from the top under a new as_of. `limit` reads as many as
  // were shown; `keepRows` shows the old ones until the read is back.
  async function readFirst({ limit = RUN_TRAFFIC_PAGE_SIZE, keepRows = false } = {}) {
    const gen = ++generation;
    const { runId, sort, list } = current;
    updateList((l) => (keepRows ? { ...l, loading: true } : { ...emptyList(l.narrowing), loading: true }));
    let page;
    try {
      page = await api.queryRunTraffic(String(runId), {
        Query: list.narrowing,
        OrderBy: orderBy(sort),
        Limit: Math.min(limit, MAX_PAGE_SIZE),
      });
    } catch (err) {
      if (gen === generation) updateList((l) => ({ ...l, loading: false, failed: true }));
      throw err;
    }
    if (gen !== generation) return;
    updateList((l) => ({
      ...emptyList(l.narrowing),
      rows: page.Items ?? [],
      next: page.NextCursor ?? null,
      hasMore: page.NextCursor != null,
      asOf: page.AsOf || null,
      loaded: true,
    }));
  }

  async function loadMore() {
    const { runId, sort, list } = current;
    if (!list.hasMore || list.loading) return;
    const gen = generation;
    updateList((l) => ({ ...l, loading: true }));
    let page;
    try {
      page = await api.queryRunTraffic(String(runId), {
        Query: list.narrowing,
        OrderBy: orderBy(sort),
        Cursor: list.next,
        AsOf: list.asOf ?? "",
        Limit: RUN_TRAFFIC_PAGE_SIZE,
      });
    } catch (err) {
      if (gen === generation) updateList((l) => ({ ...l, loading: false }));
      throw err;
    }
    if (gen !== generation) return;
    updateList((l) => {
      const hasMore = page.NextCursor != null;
      const read = [...(page.Items ?? []), ...(hasMore ? [] : l.tail)];
      return {
        ...l,
        rows: appendNew(l.rows, read),
        next: page.NextCursor ?? l.next,
        hasMore,
        tail: hasMore ? l.tail : [],
        loading: false,
      };
    });
  }

  // `rows` followed by the pairs of `more` it lacks.
  function appendNew(rows, more) {
    const loaded = new Set(rows.map((row) => String(row.ID)));
    const fresh = [];
    for (const row of more) {
      if (loaded.has(String(row.ID))) continue;
      loaded.add(String(row.ID));
      fresh.push(row);
    }
    return fresh.length ? [...rows, ...fresh] : rows;
  }

  /**
   * Moves buffered events into the rows. A response fills its row in place.
   * In # order a pair the run sends joins the end (or waits for the last
   * page); sorted, it waits behind "n new". While a read is under way the
   * events wait for it.
   */
  function flush() {
    if (requestBuffer.length === 0 && responseBuffer.size === 0) return;
    const { runId, sort, list } = current;
    if (runId == null) {
      requestBuffer = [];
      responseBuffer = new Map();
      return;
    }
    if (list.loading) return;
    const requests = requestBuffer;
    const responses = responseBuffer;
    requestBuffer = [];
    responseBuffer = new Map();
    const answered = (pair) => {
      const res = responses.get(String(pair.ID));
      return res ? withoutBodies({ ...pair, ...res }) : pair;
    };
    const sent = requests
      .filter((req) => String(req?.Metadata?.armory_run_id) === String(runId))
      .map((req) => answered(withoutBodies(req)));
    // Sorted with no rows yet, nothing can move under the cursor, so the
    // pairs are read in their place instead of waiting. The events go back
    // in the buffer: the next flush counts any pair the read missed.
    if (sent.length && !joinsAtEnd(sort) && list.rows.length === 0 && !list.hasMore) {
      requestBuffer = [...requests, ...requestBuffer];
      responseBuffer = new Map([...responses, ...responseBuffer]);
      reading = readFirst().catch((err) => console.error("Reading run traffic failed:", err));
      return;
    }

    updateList((l) => {
      let rows = l.rows.map((row) => (responses.has(String(row.ID)) ? answered(row) : row));
      let tail = l.tail.map(answered);
      let newIds = l.newIds;
      if (sent.length) {
        if (!joinsAtEnd(sort)) {
          const waiting = new Set(newIds);
          for (const pair of sent) waiting.add(String(pair.ID));
          for (const row of rows) waiting.delete(String(row.ID));
          newIds = [...waiting];
        } else if (l.hasMore) {
          tail = appendNew(tail, sent);
        } else {
          rows = appendNew(rows, sent);
        }
      }
      return { ...l, rows, tail, newIds };
    });
    const open = current.openRow;
    if (open && responses.has(String(open.ID))) {
      update((state) => ({ ...state, openRow: answered(state.openRow) }));
    }
  }

  function select(ids, anchor) {
    update((state) => {
      const keys = new Set(ids);
      const rows = new Map();
      for (const row of runTrafficRows(state)) if (keys.has(String(row.ID))) rows.set(String(row.ID), row);
      for (const key of keys) if (!rows.has(key)) rows.set(key, state.selection.rows.get(key));
      return { ...state, selection: { ids: keys, rows, anchor } };
    });
  }

  /**
   * Opens the pair with this ID, one of the rows, in the drawer, and
   * empties the Selection: a plain click means "look at this one". The
   * pair becomes the anchor.
   */
  function openPair(id) {
    update((state) => {
      const row = runTrafficRows(state).find((item) => sameID(item.ID, id)) ?? null;
      const anchor = row ? String(row.ID) : null;
      return { ...state, openId: row ? row.ID : null, openRow: row, selection: { ...emptySelection(), anchor } };
    });
  }

  return {
    subscribe,
    /** Reads the page after the last row, if there is one. */
    loadMore,

    /**
     * Sorts by a column ("number", "time", "status" or "size"): ascending,
     * then descending, then back to # order. A cursor only works with its
     * sort, so the rows read again from the top.
     */
    sortBy(column) {
      const { sort } = current;
      let next;
      if (sort.column !== column) next = { column, desc: false };
      else if (!sort.desc) next = { column, desc: true };
      else next = { column: null, desc: false };
      update((state) => ({ ...state, sort: next }));
      if (current.runId == null) return Promise.resolve();
      return readFirst({ keepRows: true });
    },

    /** Shows `runId`'s traffic; the run already shown keeps its rows. */
    open(runId) {
      if (runId != null && String(runId) === String(current.runId)) return Promise.resolve();
      generation++;
      set({ ...initialState(current.sort), runId });
      if (runId == null) return Promise.resolve();
      return readFirst();
    },

    /** Shows the pairs waiting behind "n new": the rows read again, as many as before. */
    showNew() {
      if (current.runId == null) return Promise.resolve();
      return readFirst({ limit: Math.max(current.list.rows.length, RUN_TRAFFIC_PAGE_SIZE), keepRows: true });
    },

    /**
     * A click on a row. Plain opens the pair in the drawer and empties the
     * Selection. `toggle` (⌘/Ctrl) adds the pair to the Selection or drops
     * it. `range` (⇧) selects the rows shown from the anchor to it,
     * replacing the Selection, or adding to it with `toggle` too. Only
     * ranges keep the anchor where it was; the drawer stays as it was.
     */
    clickPair(id, { toggle = false, range = false } = {}) {
      if (id == null) return;
      const key = String(id);
      const { ids, anchor } = current.selection;
      if (range) {
        const span = anchor == null ? [key] : rowRange(runTrafficRows(current), anchor, key);
        return select(toggle ? [...ids, ...span] : span, anchor ?? key);
      }
      if (!toggle) return openPair(id);
      const next = new Set(ids);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      select(next, key);
    },

    clearSelection() {
      select([], current.selection.anchor);
    },

    openPair,
    closePair() {
      update((state) => ({ ...state, openId: null, openRow: null }));
    },

    /**
     * Opens the pair `delta` rows from the open one, reading the next page
     * when it steps past the last row read. Returns the pair, or null at
     * either end of the run (the open pair stays).
     */
    async step(delta) {
      let rows = runTrafficRows(current);
      let index = stepRequest(rows, current.openId, delta);
      if (index === -1 && delta > 0 && current.list.hasMore && openRunPair(current)) {
        await loadMore();
        rows = runTrafficRows(current);
        index = stepRequest(rows, current.openId, delta);
      }
      if (index === -1) return null;
      const row = rows[index];
      update((state) => ({ ...state, openId: row.ID, openRow: row }));
      return row;
    },

    setScrollTop(scrollTop) {
      update((state) => ({ ...state, scrollTop }));
    },

    /** Forgets everything, for a project switch. */
    clear() {
      generation++;
      requestBuffer = [];
      responseBuffer = new Map();
      set(initialState());
    },

    onRequest(req) {
      requestBuffer.push(req);
    },
    onResponse(res) {
      responseBuffer.set(String(res.ID), res);
    },
    flush,
    /** Resolves once a read a flush started is back. */
    settled: () => reading,
  };
}
