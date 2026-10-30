// The Armory's run traffic view: the selected run's pairs, read from Marasi
// a page at a time in the order the researcher sorted them, optionally
// grouped by status or length, the pair open in the drawer, and the
// Selection the row menu acts on. Backend calls go through the injected
// `api` ({ queryRunTraffic(runId, TrafficPageRequest), countRunTraffic(runId,
// field) }); createArmoryStore.js binds them to QueryArmoryRunTraffic and
// CountArmoryRunTraffic.
//
// The rows are a list: a narrowing of the run's query ("" for the whole
// run) read page by page with Marasi's cursor under one AsOf, so sorted
// rows never move. Grouped, Marasi counts the run by the field, and each
// open group is a list of its own, narrowed to the group's value.
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

// The Selection lists pairs by ID, as Marasi's { ids } selection, or is a
// query: whole groups or the run, up to an as_of.
function emptySelection() {
  return {
    // A query Selection: { groupBy, groups, asOf, count }, the values of
    // the groups selected under groupBy (null for the whole run), the
    // count's as_of and how many pairs it holds. `ids` is empty then.
    query: null,
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

// The run's traffic grouped by one field: Marasi's counts, and a list per
// group read when the group is open.
function emptyGrouping() {
  return {
    // [{ value, count }] as last counted, in Marasi's order; null before
    // the first count. Counts follow a live run; the rows don't.
    counts: null,
    // The group values in the order the sections were read in. Groups a
    // live run adds after it join the end until the view reads again.
    order: [],
    // The pair the counts stop at, the as_of of a group's query.
    asOf: null,
    // The folded groups' values. Reset when the grouping changes.
    folded: new Set(),
    // value -> list, for each group opened since the last read.
    lists: new Map(),
    // IDs of pairs sent since the read, which wait to be shown.
    newIds: [],
    loading: false,
    failed: false,
  };
}

function initialState(sort = { column: null, desc: false }, groupBy = null) {
  return {
    runId: null,
    // column is null for # order, else "number", "time", "status" or "size".
    sort,
    // null for one list, else "status" or "length".
    groupBy,
    grouping: emptyGrouping(),
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

// The field each grouping counts and narrows by, and the column it makes
// a constant within a group.
const GROUP_FIELDS = { status: "status_code", length: "length" };
const GROUP_COLUMNS = { status: "status", length: "size" };

/** A group above this share of the run starts folded. */
export const FOLD_SHARE = 0.4;

/** The narrowing of the run that holds one group: pairs with no value are "". */
export function groupNarrowing(groupBy, value) {
  const field = GROUP_FIELDS[groupBy];
  return value === "" ? `NOT ${field} >= 0` : `${field} = ${value}`;
}

/**
 * The traffic query for a narrowing of the run, as QueryArmoryRunTraffic
 * builds it, for a Selection in Marasi's query shape.
 */
export function runQuery(runId, narrowing = "") {
  const run = `metadata.armory_run_id = ${JSON.stringify(String(runId))}`;
  return narrowing ? `${run} AND (${narrowing})` : run;
}

// Values by number, the pairs with no value last.
function byValue(a, b) {
  if (a === "" || b === "") return (a === "") - (b === "");
  return Number(a) - Number(b);
}

/**
 * The order the groups are read in: rarest first, ties by value. Grouped
 * by length and sorted by Length, the sort orders the groups instead,
 * since every pair in one has the same length.
 */
function groupOrder(counts, groupBy, sort) {
  const sorted = [...counts];
  if (groupBy === "length" && sort.column === "size") {
    const sign = sort.desc ? -1 : 1;
    return sorted
      .sort((a, b) => (a.value === "" || b.value === "" ? byValue(a.value, b.value) : sign * byValue(a.value, b.value)))
      .map((c) => c.value);
  }
  return sorted.sort((a, b) => a.count - b.count || byValue(a.value, b.value)).map((c) => c.value);
}

/**
 * The run's groups in the table's order, null when not grouped: each with
 * its value ("" for pairs with no response), count, share of the run in
 * percent, whether it is folded, its narrowing of the run and its whole
 * query, and its list of rows read.
 */
export function runTrafficGroups(state) {
  const { groupBy, grouping, runId } = state;
  if (!groupBy || !grouping.counts) return null;
  const counts = new Map(grouping.counts.map((c) => [c.value, c.count]));
  const total = runTrafficTotal(state);
  const later = grouping.counts.filter((c) => !grouping.order.includes(c.value));
  const values = [...grouping.order, ...groupOrder(later, groupBy, state.sort)];
  return values
    .map((value) => {
      const count = counts.get(value) ?? 0;
      const narrowing = groupNarrowing(groupBy, value);
      return {
        value,
        count,
        share: total ? (count / total) * 100 : 0,
        folded: grouping.folded.has(value),
        narrowing,
        query: runQuery(runId, narrowing),
        list: grouping.lists.get(value) ?? emptyList(narrowing),
      };
    })
    .filter((group) => group.count > 0 || group.list.rows.length > 0);
}

/** How many pairs the run holds as last counted; null when not grouped. */
export function runTrafficTotal(state) {
  if (!state.groupBy || !state.grouping.counts) return null;
  return state.grouping.counts.reduce((sum, c) => sum + c.count, 0);
}

/** The column the table is sorted by, or null in # order. */
export function sortedColumn(state) {
  return state.sort.column;
}

/**
 * The rows the table shows, in its order: grouped, the rows read in each
 * open group, group by group.
 */
export function runTrafficRows(state) {
  const groups = runTrafficGroups(state);
  if (!groups) return state.groupBy ? [] : state.list.rows;
  return groups.flatMap((group) => (group.folded ? [] : group.list.rows));
}

// Every row read, folded groups' too, to find a pair by ID.
function readRows(state) {
  if (!state.groupBy) return state.list.rows;
  return [...state.grouping.lists.values()].flatMap((list) => list.rows);
}

function findRow(state, id) {
  return readRows(state).find((row) => sameID(row.ID, id)) ?? null;
}

// The IDs of the rows shown from `a` to `b`, both included, in the table's
// order; just [b] when `a` is not shown.
function rowRange(rows, a, b) {
  const i = rows.findIndex((row) => sameID(row.ID, a));
  const j = rows.findIndex((row) => sameID(row.ID, b));
  if (i < 0 || j < 0) return [String(b)];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((row) => String(row.ID));
}

// A row's value under a grouping: "" while it has no response.
function rowValue(groupBy, row) {
  if (!row.StatusCode) return "";
  return String(groupBy === "status" ? row.StatusCode : row.Length);
}

// Whether a query Selection holds this row.
function queryHolds(query, row) {
  if (String(row.ID) > query.asOf) return false;
  return query.groups == null || query.groups.includes(rowValue(query.groupBy, row));
}

/** True when this row is in the Selection. */
export function isRowSelected(state, row) {
  const { ids, query } = state.selection;
  return query ? queryHolds(query, row) : ids.has(String(row.ID));
}

/** True when the pair with this ID is in the Selection. */
export function isPairSelected(state, id) {
  if (id == null) return false;
  if (!state.selection.query) return state.selection.ids.has(String(id));
  const row = findRow(state, id);
  return row != null && isRowSelected(state, row);
}

/** "n selected" while a Selection exists, else "". */
export function runSelectionLabel(state) {
  const { ids, query } = state.selection;
  const n = query ? query.count : ids.size;
  return n ? `${n.toLocaleString()} selected` : "";
}

/**
 * The Selection as Marasi takes it (the Ledger's selectionSpec): { ids },
 * or for whole groups or the run { query, exclusion, as_of }. The run's
 * traffic reads whatever the content type, so nothing is excluded. null
 * when nothing is selected.
 */
export function runSelectionSpec(state) {
  const { ids, query } = state.selection;
  if (query) {
    const narrowing = query.groups?.map((value) => groupNarrowing(query.groupBy, value)).join(" OR ") ?? "";
    return { query: runQuery(state.runId, narrowing), exclusion: [], as_of: query.asOf };
  }
  return ids.size ? { ids: [...ids] } : null;
}

/**
 * How much of a group the Selection holds: "all", "some" or "". A group
 * selected as a whole, or the run, is "all" though not all its rows are
 * read.
 */
export function groupSelection(state, group) {
  const { query } = state.selection;
  if (query && (query.groups == null || query.groupBy === state.groupBy)) {
    return query.groups == null || query.groups.includes(group.value) ? "all" : "";
  }
  const n = group.list.rows.filter((row) => isRowSelected(state, row)).length;
  if (n === 0) return "";
  return !query && n === group.count && !group.list.hasMore ? "all" : "some";
}

/**
 * What the row menu acts on when a group header is right-clicked: the
 * group's query under the count's as_of, with its rows read. The Selection
 * stays as it was.
 */
export function runGroupMenuTarget(state, value) {
  const group = runTrafficGroups(state)?.find((g) => g.value === value);
  if (!group) return { pairs: [], selection: null, count: 0 };
  const asOf = state.grouping.asOf;
  return {
    pairs: group.list.rows.filter((row) => String(row.ID) <= asOf),
    selection: { query: group.query, exclusion: [], as_of: asOf },
    count: group.count,
  };
}

/**
 * The selected pairs: the rows shown in the table's order, then the ones a
 * sort's read hasn't reached again. A query Selection's are its rows read.
 */
function selectedPairs(state) {
  const { ids, rows, query } = state.selection;
  if (query) return readRows(state).filter((row) => queryHolds(query, row));
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
    if (state.selection.query) return { pairs, selection: runSelectionSpec(state), count: state.selection.query.count };
    return { pairs, selection: { ids: pairs.map((pair) => String(pair.ID)) }, count: pairs.length };
  }
  const pair = findRow(state, id);
  return pair ? pairTarget(pair) : { pairs: [], selection: null, count: 0 };
}

/** "n new" while sent pairs wait to be shown; "" when none do. */
export function runTrafficNewLabel(state) {
  const n = (state.groupBy ? state.grouping.newIds : state.list.newIds).length;
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
  return findRow(state, state.openId) ?? state.openRow;
}

/**
 * The list Previous and Next request step through: the whole run's (null),
 * or grouped, the open pair's group's value; undefined when no group holds
 * the open pair.
 */
function stepKey(state) {
  if (!state.groupBy) return null;
  for (const [value, list] of state.grouping.lists) {
    if (list.rows.some((row) => sameID(row.ID, state.openId))) return value;
  }
  return undefined;
}

/**
 * Whether Previous (delta -1) or Next (1) request has a pair to open: one
 * read in the open pair's list, or for Next, an unread page of it.
 */
export function runCanStep(state, delta) {
  const key = stepKey(state);
  if (key === undefined || state.openId == null) return false;
  const list = key == null ? state.list : state.grouping.lists.get(key);
  if (stepRequest(list.rows, state.openId, delta) !== -1) return true;
  return delta > 0 && list.hasMore;
}

/**
 * The order a list's rows are read in. Grouped by length, a Length sort
 * orders the groups, so their rows stay in # order.
 */
function listOrderBy(state) {
  if (state.groupBy === "length" && state.sort.column === "size") return "requested_at";
  return orderBy(state.sort);
}

/** Whether a column header sorts: grouped by status, Status doesn't. */
export function isColumnSortable(state, column) {
  return !(state.groupBy === "status" && column === "status");
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
  // A count of a live run's groups under way, and whether another is due
  // once it is back.
  let counting = null;
  let recountDue = false;

  // A list is the whole run's (key null) or one group's (its value).
  function listOf(state, key) {
    if (key == null) return state.list;
    return state.grouping.lists.get(key) ?? emptyList(groupNarrowing(state.groupBy, key));
  }

  function updateList(key, fn) {
    update((state) => {
      if (key == null) return { ...state, list: fn(state.list) };
      const lists = new Map(state.grouping.lists);
      lists.set(key, fn(listOf(state, key)));
      return { ...state, grouping: { ...state.grouping, lists } };
    });
  }

  function updateGrouping(fn) {
    update((state) => ({ ...state, grouping: fn(state.grouping) }));
  }

  // Reads a list's rows from the top under a new as_of, or `asOf` when
  // given. `limit` reads as many as were shown; `keepRows` shows the old
  // ones until the read is back. A read started under an older generation
  // is dropped.
  async function readFirst(key = null, { limit = RUN_TRAFFIC_PAGE_SIZE, keepRows = false, gen = ++generation, asOf = "" } = {}) {
    const { runId } = current;
    const list = listOf(current, key);
    updateList(key, (l) => (keepRows ? { ...l, loading: true } : { ...emptyList(l.narrowing), loading: true }));
    let page;
    try {
      page = await api.queryRunTraffic(String(runId), {
        Query: list.narrowing,
        OrderBy: listOrderBy(current),
        AsOf: asOf,
        Limit: Math.min(limit, MAX_PAGE_SIZE),
      });
    } catch (err) {
      if (gen === generation) updateList(key, (l) => ({ ...l, loading: false, failed: true }));
      throw err;
    }
    if (gen !== generation) return;
    updateList(key, (l) => ({
      ...emptyList(l.narrowing),
      rows: page.Items ?? [],
      next: page.NextCursor ?? null,
      hasMore: page.NextCursor != null,
      asOf: page.AsOf || null,
      loaded: true,
    }));
  }

  async function loadMore(key = null) {
    const { runId } = current;
    const list = listOf(current, key);
    if (!list.hasMore || list.loading) return;
    const gen = generation;
    updateList(key, (l) => ({ ...l, loading: true }));
    let page;
    try {
      page = await api.queryRunTraffic(String(runId), {
        Query: list.narrowing,
        OrderBy: listOrderBy(current),
        Cursor: list.next,
        AsOf: list.asOf ?? "",
        Limit: RUN_TRAFFIC_PAGE_SIZE,
      });
    } catch (err) {
      if (gen === generation) updateList(key, (l) => ({ ...l, loading: false }));
      throw err;
    }
    if (gen !== generation) return;
    updateList(key, (l) => {
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

  // The run's counts by `field` up to `asOf` ("" for the newest pair), as
  // { counts: [{ value, count }], asOf }.
  async function countGroups(field = GROUP_FIELDS[current.groupBy], asOf = "") {
    const result = await api.countRunTraffic(String(current.runId), field, asOf);
    return {
      counts: (result?.Counts ?? []).map((c) => ({ value: c.Value, count: c.Count })),
      asOf: result?.AsOf || null,
    };
  }

  /**
   * Counts the groups and reads each open one's rows from the top. With
   * `resetFolds` the groups over FOLD_SHARE of the run start folded;
   * `keepRows` shows the old rows until the new ones are back, and reads
   * as many as each group showed.
   */
  async function readGroups({ resetFolds = false, keepRows = false } = {}) {
    const gen = ++generation;
    updateGrouping((g) => ({ ...g, loading: true, failed: false }));
    let counts, asOf;
    try {
      ({ counts, asOf } = await countGroups());
    } catch (err) {
      if (gen === generation) updateGrouping((g) => ({ ...g, loading: false, failed: true }));
      throw err;
    }
    if (gen !== generation) return;
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    const shown = current.grouping.lists;
    update((state) => {
      const folded = resetFolds
        ? new Set(counts.filter((c) => c.count / total > FOLD_SHARE).map((c) => c.value))
        : state.grouping.folded;
      const lists = new Map();
      if (keepRows) for (const c of counts) if (shown.has(c.value)) lists.set(c.value, shown.get(c.value));
      return {
        ...state,
        grouping: {
          ...emptyGrouping(),
          counts,
          asOf,
          order: groupOrder(counts, state.groupBy, state.sort),
          folded,
          lists,
        },
      };
    });
    const open = counts.filter((c) => !current.grouping.folded.has(c.value));
    await Promise.all(
      open.map((c) =>
        // Under the counts' as_of, so a group's rows add up to its count.
        readFirst(c.value, {
          gen,
          keepRows,
          asOf: asOf ?? "",
          limit: Math.max(shown.get(c.value)?.rows.length ?? 0, RUN_TRAFFIC_PAGE_SIZE),
        }),
      ),
    );
  }

  // Counts a live run's groups again; the rows stay as they are.
  function recount() {
    if (counting) {
      recountDue = true;
      return counting;
    }
    const gen = generation;
    counting = countGroups()
      .then(({ counts, asOf }) => {
        if (gen === generation) updateGrouping((g) => ({ ...g, counts, asOf }));
      })
      .catch((err) => console.error("Counting run traffic failed:", err))
      .finally(() => {
        counting = null;
        if (recountDue) {
          recountDue = false;
          reading = recount();
        }
      });
    return counting;
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

  // Whether a read is under way that buffered events should wait for.
  function readUnderWay(state) {
    if (!state.groupBy) return state.list.loading;
    return state.grouping.loading || [...state.grouping.lists.values()].some((l) => l.loading);
  }

  /**
   * Moves buffered events into the rows. A response fills its row in place.
   * In # order a pair the run sends joins the end (or waits for the last
   * page); sorted or grouped, it waits behind "n new", while grouped the
   * counts follow it. While a read is under way the events wait for it.
   */
  function flush() {
    if (requestBuffer.length === 0 && responseBuffer.size === 0) return;
    const { runId, sort, list, groupBy } = current;
    if (runId == null) {
      requestBuffer = [];
      responseBuffer = new Map();
      return;
    }
    if (readUnderWay(current)) return;
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
    const fill = (l) => {
      const rows = l.rows.map((row) => (responses.has(String(row.ID)) ? answered(row) : row));
      return { ...l, rows, tail: l.tail.map(answered) };
    };

    if (groupBy) {
      // A response moves its pair out of the pending group, so the run's
      // own responses count again too.
      const runIds = new Set([...readRows(current).map((row) => String(row.ID)), ...current.grouping.newIds]);
      const answeredHere = [...responses.keys()].some((key) => runIds.has(key));
      // With no rows shown yet, nothing can move under the cursor, so the
      // groups are read in their place. The events go back in the buffer:
      // the next flush counts any pair the read missed.
      if (sent.length && runTrafficRows(current).length === 0) {
        requestBuffer = [...requests, ...requestBuffer];
        responseBuffer = new Map([...responses, ...responseBuffer]);
        reading = readGroups({ keepRows: true }).catch((err) => console.error("Reading run traffic failed:", err));
        return;
      }
      update((state) => {
        const lists = new Map([...state.grouping.lists].map(([key, l]) => [key, fill(l)]));
        const waiting = new Set(state.grouping.newIds);
        for (const pair of sent) waiting.add(String(pair.ID));
        for (const row of readRows(state)) waiting.delete(String(row.ID));
        return {
          ...state,
          grouping: { ...state.grouping, lists, newIds: [...waiting] },
        };
      });
      if (sent.length || answeredHere) reading = recount();
    } else {
      // Sorted with no rows yet, nothing can move under the cursor, so the
      // pairs are read in their place instead of waiting. The events go back
      // in the buffer: the next flush counts any pair the read missed.
      if (sent.length && !joinsAtEnd(sort) && list.rows.length === 0 && !list.hasMore) {
        requestBuffer = [...requests, ...requestBuffer];
        responseBuffer = new Map([...responses, ...responseBuffer]);
        reading = readFirst().catch((err) => console.error("Reading run traffic failed:", err));
        return;
      }
      updateList(null, (l) => {
        let { rows, tail } = fill(l);
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
    }
    const open = current.openRow;
    if (open && responses.has(String(open.ID))) {
      update((state) => ({ ...state, openRow: answered(state.openRow) }));
    }
  }

  // Reads the view from the top: the groups, or the one list.
  function readView(options) {
    return current.groupBy ? readGroups(options) : readFirst(null, options);
  }

  function select(ids, anchor) {
    update((state) => {
      const keys = new Set(ids);
      const rows = new Map();
      for (const row of readRows(state)) if (keys.has(String(row.ID))) rows.set(String(row.ID), row);
      for (const key of keys) if (!rows.has(key)) rows.set(key, state.selection.rows.get(key));
      return { ...state, selection: { ids: keys, rows, anchor, query: null } };
    });
  }

  /**
   * Opens the pair with this ID, one of the rows, in the drawer, and
   * empties the Selection: a plain click means "look at this one". The
   * pair becomes the anchor.
   */
  function openPair(id) {
    update((state) => {
      const row = findRow(state, id);
      const anchor = row ? String(row.ID) : null;
      return {
        ...state,
        openId: row ? row.ID : null,
        openRow: row,
        selection: { ...emptySelection(), anchor },
      };
    });
  }

  // Unfolds or folds the groups with these values; an unfolded group's
  // rows are read if they weren't.
  function fold(values, folded) {
    update((state) => {
      const next = new Set(state.grouping.folded);
      for (const value of values) folded ? next.add(value) : next.delete(value);
      return { ...state, grouping: { ...state.grouping, folded: next } };
    });
    if (folded || current.runId == null) return Promise.resolve();
    const unread = values.filter((value) => {
      const list = current.grouping.lists.get(value);
      return !list || (!list.loaded && !list.loading);
    });
    const asOf = current.grouping.asOf ?? "";
    return Promise.all(unread.map((value) => readFirst(value, { gen: generation, asOf }))).then(() => {});
  }

  return {
    subscribe,
    /**
     * Reads the page after the last row of the list, or of the group with
     * this value, if there is one.
     */
    loadMore(group) {
      return loadMore(group === undefined || !current.groupBy ? null : group);
    },

    /**
     * Sorts by a column ("number", "time", "status" or "size"): ascending,
     * then descending, then back to # order. A cursor only works with its
     * sort, so the rows read again from the top. A column that doesn't sort
     * under the grouping does nothing.
     */
    sortBy(column) {
      if (!isColumnSortable(current, column)) return Promise.resolve();
      const { sort } = current;
      let next;
      if (sort.column !== column) next = { column, desc: false };
      else if (!sort.desc) next = { column, desc: true };
      else next = { column: null, desc: false };
      update((state) => ({ ...state, sort: next }));
      if (current.runId == null) return Promise.resolve();
      return readView({ keepRows: true });
    },

    /**
     * Groups the traffic by "status" or "length", or not at all (null).
     * Groups over FOLD_SHARE of the run start folded, and a sort on the
     * grouped column goes back to # order.
     */
    groupBy(groupBy) {
      groupBy = groupBy || null;
      if (groupBy === current.groupBy) return Promise.resolve();
      generation++;
      update((state) => ({
        ...state,
        groupBy,
        sort: groupBy && state.sort.column === GROUP_COLUMNS[groupBy] ? { column: null, desc: false } : state.sort,
        grouping: emptyGrouping(),
        list: emptyList(),
      }));
      if (current.runId == null) return Promise.resolve();
      return groupBy ? readGroups({ resetFolds: true }) : readFirst();
    },

    /** Folds the group with this value, or unfolds it and reads its rows. */
    toggleGroup(value) {
      return fold([value], !current.grouping.folded.has(value));
    },
    expandAll() {
      return fold(runTrafficGroups(current)?.map((g) => g.value) ?? [], false);
    },
    collapseAll() {
      return fold(runTrafficGroups(current)?.map((g) => g.value) ?? [], true);
    },

    /** Shows `runId`'s traffic; the run already shown keeps its rows. */
    open(runId) {
      if (runId != null && String(runId) === String(current.runId)) return Promise.resolve();
      generation++;
      set({ ...initialState(current.sort, current.groupBy), runId });
      if (runId == null) return Promise.resolve();
      return current.groupBy ? readGroups({ resetFolds: true }) : readFirst();
    },

    /**
     * Shows the pairs waiting behind "n new": the rows read again, as many
     * as before; grouped, the groups counted and ordered again too.
     */
    showNew() {
      if (current.runId == null) return Promise.resolve();
      if (current.groupBy) return readGroups({ keepRows: true });
      return readFirst(null, {
        limit: Math.max(current.list.rows.length, RUN_TRAFFIC_PAGE_SIZE),
        keepRows: true,
      });
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
      const { anchor, query } = current.selection;
      // ⌘ or ⇧ on a query Selection goes on from the rows it holds read,
      // as the Ledger's ⌘A does.
      const ids = query ? new Set(selectedPairs(current).map((row) => String(row.ID))) : current.selection.ids;
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

    /**
     * ⌘A: selects every pair in the run, folded groups and rows not read
     * too, as the run's query. Grouped, it stops at the counts' as_of;
     * else at the list's, counted first.
     */
    async selectAll() {
      const { runId, groupBy, grouping, list } = current;
      if (runId == null) return;
      let asOf = grouping.asOf;
      let count = runTrafficTotal(current);
      if (!groupBy) {
        const gen = generation;
        let counted;
        try {
          counted = await countGroups("status_code", list.asOf ?? "");
        } catch (err) {
          console.error("Counting run traffic failed:", err);
          return;
        }
        if (gen !== generation) return;
        asOf = counted.asOf;
        count = counted.counts.reduce((sum, c) => sum + c.count, 0);
      }
      if (!count || !asOf) return;
      update((state) => ({
        ...state,
        selection: { ...emptySelection(), anchor: state.selection.anchor, query: { groupBy, groups: null, asOf, count } },
      }));
    },

    /**
     * ⌘-click on a group header: adds the whole group to the Selection,
     * read or not, or drops it when the Selection holds it. The groups are
     * a query under one as_of: the latest count's for a new Selection, and
     * the Selection's own as it grows or shrinks, counted again under it,
     * so pairs sent since join no group in it. A Selection of listed pairs
     * gives way to the group.
     */
    async toggleGroupSelection(value) {
      const { groupBy, grouping } = current;
      if (!groupBy || !grouping.counts) return;
      const query = current.selection.query;
      const asOf = query?.asOf ?? grouping.asOf;
      let counted = grouping.counts;
      if (asOf !== grouping.asOf) {
        ({ counts: counted } = await countGroups(GROUP_FIELDS[groupBy], asOf));
        // The Selection or grouping changed while counting.
        if (current.selection.query !== query || current.groupBy !== groupBy) return;
      }
      const values = counted.map((c) => c.value);
      let groups;
      if (query && query.groups == null) groups = values.filter((v) => v !== value);
      else if (query && query.groupBy === groupBy && query.groups.includes(value)) {
        groups = query.groups.filter((v) => v !== value);
      } else if (query && query.groupBy === groupBy) groups = [...query.groups, value];
      else groups = [value];
      if (groups.length === 0) return select([], current.selection.anchor);
      const counts = new Map(counted.map((c) => [c.value, c.count]));
      const count = groups.reduce((sum, v) => sum + (counts.get(v) ?? 0), 0);
      update((state) => ({
        ...state,
        selection: {
          ...emptySelection(),
          anchor: state.selection.anchor,
          query: { groupBy, groups, asOf, count },
        },
      }));
    },

    openPair,
    closePair() {
      update((state) => ({ ...state, openId: null, openRow: null }));
    },

    /**
     * Opens the pair `delta` rows from the open one, reading the next page
     * when it steps past the last row read. Grouped, it steps through the
     * open pair's group. Returns the pair, or null at either end of the run
     * or group (the open pair stays).
     */
    async step(delta) {
      const key = stepKey(current);
      if (key === undefined) return null;
      let rows = listOf(current, key).rows;
      let index = stepRequest(rows, current.openId, delta);
      if (index === -1 && delta > 0 && listOf(current, key).hasMore && openRunPair(current)) {
        await loadMore(key);
        rows = listOf(current, key).rows;
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
    /** Resolves once a read or count a flush started is back. */
    settled: () => reading,
  };
}
