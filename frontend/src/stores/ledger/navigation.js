// Moving through the results: arrow-key steps, ⌘] and ⌘[ jumps by pair number, the results' edges, and Go to request N.
import { sameID } from "../../lib/ledger/pairs.js";
import { rowRange, tableRows } from "./state.js";

/**
 * Navigation over the window `win` and the selection `sel`. A jump the
 * loaded rows don't hold reads a fresh window or opens the pair on its own.
 */
export function createNavigation(core, api, win, sel) {
  const { updateResults } = core;
  const { pageRequest, resultsFromPage } = win;
  const { selectIDs, selectPair, focusOutside } = sel;

  /**
   * Moves the focus `step` rows down (negative steps go up), stopping at the
   * window's ends, and selects only that row. With `extend` (⇧), selects the
   * range from the anchor to it instead. With nothing selected, a step down
   * selects the top row and a step up the bottom one.
   */
  function stepSelection(step, { extend = false } = {}) {
    const rows = tableRows(core.current);
    const { focus, anchor } = core.current.selection;
    const at = focus == null ? -1 : rows.findIndex((row) => sameID(row.ID, focus));
    // From a pair a jump opened outside the loaded rows, steps go by #: next
    // is the next pair down, previous the next one up, until one is loaded.
    if (at === -1 && focus != null && sameID(core.current.focusRow?.ID, focus)) return stepOutside(step);
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
    const number = core.current.focusRow.Number;
    let pair = null;
    try {
      pair = step > 0 ? await onePair(`number < ${number}`, "number desc") : await onePair(`number > ${number}`, "number");
    } catch (err) {
      console.error("Reading traffic failed:", err);
    }
    if (!pair) return;
    const shown = tableRows(core.current).find((row) => sameID(row.ID, pair.ID));
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
    const from = core.current.selection.focus;
    if (from == null) return { pair: null };
    const number = pairNumber(from);
    if (number === "?") return { pair: null };
    let pair = shownPairAtNumber(number + Math.sign(step)) ?? null;
    if (!pair) {
      try {
        const page = await api.queryTraffic({
          ...pageRequest(`number ${step > 0 ? ">" : "<"} ${number}`, core.current.sort, { Limit: 1 }),
          OrderBy: step > 0 ? "number" : "number desc",
          IgnoreExclusion: true,
        });
        pair = page.QueryError ? null : (page.Items?.[0] ?? null);
      } catch (err) {
        console.error("Reading traffic failed:", err);
      }
    }
    if (!pair || !sameID(core.current.selection.focus, from)) return { pair: null };
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
    const { field, desc } = core.current.sort;
    if (field === "number") return goToEdge(highest !== desc);
    const r = core.current.results;
    let pair = null;
    try {
      const page = await api.queryTraffic({
        ...pageRequest(core.current.query.ranQuery, core.current.sort, { AsOf: r.shownAsOf ?? r.asOf ?? "", Limit: 1 }),
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
    const r = core.current.results;
    if (end ? !r.hasAfter : !r.hasBefore) {
      const rows = tableRows(core.current);
      const pair = (end ? rows.at(-1) : rows[0]) ?? null;
      if (pair) selectPair(pair.ID);
      return { pair };
    }
    const gen = win.beginRead();
    let page;
    try {
      page = await api.queryTraffic(
        pageRequest(core.current.query.ranQuery, core.current.sort, {
          AsOf: r.shownAsOf ?? r.asOf ?? "",
          Direction: end ? "backward" : "forward",
        }),
      );
      if (page.QueryError) throw new Error(page.QueryError.Message);
    } catch (err) {
      console.error("Reading traffic failed:", err);
      if (win.isLatest(gen)) win.endRead();
      return { pair: null };
    }
    if (!win.isLatest(gen)) return { pair: null };
    win.endRead();
    const items = page.Items ?? [];
    win.viewport = { first: 0, last: 0, atTop: !end };
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
        reset: win.nextReset(),
      };
    });
    const pair = (end ? items.at(-1) : items[0]) ?? null;
    if (pair) selectPair(pair.ID);
    return { pair };
  }

  /** The loaded pair with this ID, or undefined. */
  function findShownPair(id) {
    return tableRows(core.current).find((item) => sameID(item.ID, id));
  }

  /**
   * The pair's number ("Request N"): Marasi's pair number, which follows
   * capture order and never changes, or "?" when the pair isn't loaded.
   */
  function pairNumber(id) {
    const outside = sameID(core.current.focusRow?.ID, id) ? core.current.focusRow : null;
    return (findShownPair(id) ?? outside)?.Number || "?";
  }

  /** The loaded pair whose pair number is `number`, or undefined. */
  function shownPairAtNumber(number) {
    return tableRows(core.current).find((item) => item.Number === number);
  }

  // The current query with `condition` too.
  function withinQuery(condition) {
    const text = core.current.query.ranQuery;
    return text ? `(${text}) AND ${condition}` : condition;
  }

  // The one pair of the current results that `condition` picks first under
  // `orderBy`, or null.
  async function onePair(condition, orderBy) {
    const page = await api.queryTraffic({
      ...pageRequest(withinQuery(condition), core.current.sort, { AsOf: core.current.results.asOf ?? "", Limit: 1 }),
      OrderBy: orderBy,
    });
    return page.QueryError ? null : (page.Items?.[0] ?? null);
  }

  // Pair `number` wherever it is: outside the query, the type exclusion and
  // the results' as_of. Null when the project has no such pair.
  async function anyPair(number) {
    const page = await api.queryTraffic({
      ...pageRequest(`number = ${number}`, core.current.sort, { Limit: 1 }),
      OrderBy: "number",
      IgnoreExclusion: true,
    });
    return page.QueryError ? null : (page.Items?.[0] ?? null);
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
    if (core.current.sort.field !== "number") {
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
    const { desc } = core.current.sort;
    const text = core.current.query.ranQuery;
    const within = (condition) => (text ? `(${text}) AND ${condition}` : condition);
    const asOf = core.current.results.asOf ?? "";
    // From N on (N first), and up to N (N last), read backward. These are
    // two walks joined at N, which Marasi's cursors don't promise to line
    // up in general (a pair can keep its pre-response place within one
    // walk); under a # sort no pair ever moves, so the joined window is
    // exact and each side pages on with its own walk's cursors.
    const from = within(`number ${desc ? "<=" : ">="} ${number}`);
    const upTo = within(`number ${desc ? ">=" : "<="} ${number}`);
    const gen = win.beginRead();
    let after, before, above;
    try {
      [after, before, above] = await Promise.all([
        api.queryTraffic(pageRequest(from, core.current.sort, { AsOf: asOf })),
        api.queryTraffic(pageRequest(upTo, core.current.sort, { AsOf: asOf, Direction: "backward" })),
        api.countTraffic(within(`number ${desc ? ">" : "<"} ${number}`), "", { AsOf: asOf }),
      ]);
    } catch (err) {
      console.error("Reading traffic failed:", err);
      if (win.isLatest(gen)) win.endRead();
      return { reason: "missing" };
    }
    if (!win.isLatest(gen)) return { reason: "missing" };
    win.endRead();
    const pair = after.Items?.[0];
    if (after.QueryError || before.QueryError || pair?.Number !== number) return { reason: "missing" };
    const items = [...(before.Items ?? []).slice(0, -1), ...(after.Items ?? [])];
    win.viewport = { first: 0, last: 0, atTop: false };
    updateResults((r) => ({
      ...resultsFromPage(after, "x"),
      chunks: [{ items, first: before.PrevCursor ?? null, last: after.NextCursor ?? null }],
      hasBefore: before.PrevCursor != null,
      start: above.Capped || above.QueryError ? null : above.Count - (items.length - (after.Items ?? []).length),
      asOf: r.asOf ?? after.AsOf ?? null,
      shownAsOf: r.shownAsOf ?? after.AsOf ?? null,
      count: r.count,
      hidden: r.hidden,
      reset: win.nextReset(),
    }));
    return { pair };
  }

  return {
    stepSelection,
    stepNumber,
    goToEdge,
    goToNumberEnd,
    goToNumber,
    findShownPair,
    pairNumber,
    shownPairAtNumber,
  };
}
