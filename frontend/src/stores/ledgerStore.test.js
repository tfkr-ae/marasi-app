import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  countLabel,
  createLedgerStore,
  focusedPair,
  hiddenByTypeCount,
  selectedPairs,
  indexWarning,
  isLiveNewestFirst,
  isQueryActive,
  newMatchesKind,
  NEW_MATCHES_DELAY_MS,
  NEW_MATCHES_MAX_WAIT_MS,
  PAGE_SIZE,
  MAX_WINDOW_ROWS,
  tableRows,
} from "./createLedgerStore.js";

// Pair IDs sort by capture time, as Marasi's UUIDv7 ids do.
const idOf = (n) => `p${String(n).padStart(6, "0")}`;
const pair = (n, extra = {}) => ({
  ID: idOf(n),
  Number: n,
  Method: "GET",
  Host: "api.acme.test",
  Path: `/${n}`,
  StatusCode: 200,
  ContentType: "application/json",
  Length: "10",
  ...extra,
});
const pairs = (count, extra = () => ({})) =>
  Array.from({ length: count }, (_, i) => pair(i + 1, extra(i + 1)));

const SORT_KEYS = {
  number: (p) => p.Number,
  requested_at: (p) => p.ID,
  method: (p) => p.Method,
  host: (p) => p.Host,
  path: (p) => p.Path,
  status_code: (p) => (p.StatusCode > 0 ? p.StatusCode : undefined),
  content_type: (p) => p.ContentType || undefined,
  length: (p) => (p.Length === "" || p.Length == null ? undefined : Number(p.Length)),
};

function hides(exclusion, type) {
  const t = (type ?? "").split(";")[0].trim().toLowerCase();
  if (!t) return false;
  return exclusion.some((v) => v === t || (v.endsWith("/*") && t.startsWith(v.slice(0, -1))));
}

// An in-memory Marasi: ListTraffic's sort, opaque cursors bound to their
// sort, as_of snapshots and both directions, and CountTraffic. Queries are
// predicates by query text; "bad" is invalid. Calls are recorded.
// The project keeps its own exclusion once `exclusion` is set; until then it
// follows `defaultExclusion`. `counts` holds canned CountTraffic results by
// query, or an Error to throw.
function fakeApi({
  traffic = [],
  exclusion = undefined,
  defaultExclusion = [],
  queries = {},
  typeCounts = { Counts: [], Complete: { sitemap: true } },
  counts = {},
} = {}) {
  const calls = [];
  let ownExclusion = exclusion;
  const excluded = () => ownExclusion ?? defaultExclusion;
  const db = traffic.map((p) => ({ ...p }));
  const newest = () => db.reduce((max, p) => (p.ID > max ? p.ID : max), "");
  // Query text: "" for every pair, a key of `queries`, or either with a
  // pair-number condition, as the jump to a request reads them.
  const predicate = (text) => {
    if (text === "") return () => true;
    if (queries[text]) return queries[text];
    const m = /^(?:\((.*)\) AND )?number (<=|>=|<|>|=) (\d+)$/.exec(text);
    if (!m) return queries[text];
    const base = predicate(m[1] ?? "");
    const n = Number(m[3]);
    const test = { "<=": (x) => x <= n, ">=": (x) => x >= n, "<": (x) => x < n, ">": (x) => x > n, "=": (x) => x === n }[m[2]];
    return (p) => base(p) && test(p.Number);
  };

  function listed(req) {
    const [field, dir] = (req.OrderBy || "number desc").split(" ");
    const sign = dir === "desc" ? -1 : 1;
    const key = SORT_KEYS[field];
    const asOf = req.AsOf || newest();
    const match = predicate(req.Query);
    const rows = db.filter(
      (p) => p.ID <= asOf && match(p) && (req.IgnoreExclusion || !hides(excluded(), p.ContentType)),
    );
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const valued = rows.filter((p) => key(p) !== undefined);
    const unvalued = rows.filter((p) => key(p) === undefined);
    valued.sort((a, b) => sign * (cmp(key(a), key(b)) || cmp(a.ID, b.ID)));
    unvalued.sort((a, b) => sign * cmp(a.ID, b.ID));
    return { list: [...valued, ...unvalued], sortName: `${field}${dir === "desc" ? " desc" : ""}`, asOf };
  }

  const api = {
    calls,
    db,
    capture(p) {
      db.push({ ...p });
    },
    getExclusion: async () => [...excluded()],
    hasOwnExclusion: async () => ownExclusion !== undefined,
    setExclusion: async (types) => {
      calls.push(["setExclusion", types]);
      ownExclusion = [...types];
    },
    resetExclusion: async () => {
      calls.push(["resetExclusion"]);
      ownExclusion = undefined;
    },
    getDefaultExclusion: async () => [...defaultExclusion],
    setDefaultExclusion: async (types) => {
      calls.push(["setDefaultExclusion", types]);
      defaultExclusion = [...types];
    },
    countContentTypes: async () => {
      calls.push(["countContentTypes"]);
      return typeof typeCounts === "function" ? typeCounts() : typeCounts;
    },
    queryTraffic: async (req) => {
      calls.push(["queryTraffic", { ...req }]);
      if (req.Query === "bad") return { QueryError: { Message: "expected a value", Position: 3 } };
      // Marasi refuses a page of more than 500 rows.
      if (req.Limit > 500) throw new Error("GET /traffic: bad_request: HTTP 400");
      const { list, sortName, asOf } = listed(req);
      const at = (cursor) => {
        const [sort, id] = cursor.split("|");
        if (sort !== sortName) throw new Error("invalid cursor");
        return list.findIndex((p) => p.ID === id);
      };
      const cursorAt = (p) => `${sortName}|${p.ID}`;
      let rows;
      let hasMore;
      if (req.Direction === "backward") {
        const end = req.Cursor ? at(req.Cursor) : list.length;
        const begin = Math.max(0, end - req.Limit);
        rows = list.slice(begin, end);
        hasMore = begin > 0;
      } else {
        const start = req.Cursor ? at(req.Cursor) + 1 : 0;
        rows = list.slice(start, start + req.Limit);
        hasMore = start + req.Limit < list.length;
      }
      const first = rows.length ? cursorAt(rows[0]) : req.Cursor || null;
      const last = rows.length ? cursorAt(rows.at(-1)) : req.Cursor || null;
      const given = Boolean(req.Cursor);
      const backward = req.Direction === "backward";
      return {
        Items: rows.map((p) => ({ ...p })),
        NextCursor: backward ? (given ? last : null) : hasMore ? last : null,
        PrevCursor: backward ? (hasMore ? first : null) : given ? first : null,
        AsOf: asOf,
        IndexComplete: true,
      };
    },
    countTraffic: async (query, after, options = {}) => {
      const req = { Query: query, After: after, ...options };
      calls.push(["countTraffic", req]);
      const canned = counts[query];
      if (canned instanceof Error) throw canned;
      if (canned) return canned;
      if (req.Query === "bad") return { QueryError: { Message: "expected a value", Position: 3 } };
      const match = predicate(req.Query);
      const count = db.filter(
        (p) =>
          match(p) &&
          (req.IgnoreExclusion || !hides(excluded(), p.ContentType)) &&
          (!req.AsOf || p.ID <= req.AsOf) &&
          (!req.After || p.ID > req.After),
      ).length;
      return { Count: Math.min(count, 100000), Capped: count > 100000, IndexComplete: true };
    },
  };
  return api;
}

const ids = (state) => tableRows(state).map((row) => row.ID);
const pageCalls = (api) => api.calls.filter((c) => c[0] === "queryTraffic").map((c) => c[1]);
const countCalls = (api) => api.calls.filter((c) => c[0] === "countTraffic").map((c) => c[1]);

// Scrolls the table so rows first..last are in view, then waits for the
// loads that triggers.
async function scrollTo(store, first, last = first + 30) {
  store.setViewport({ first, last, atTop: first === 0 });
  await store.settled();
}

test("the live view loads its first page newest first, then the count", async () => {
  const api = fakeApi({ traffic: pairs(3) });
  const store = createLedgerStore(api);
  const loading = store.populate();
  assert.equal(countLabel(get(store)), "…");
  await loading;

  const state = get(store);
  assert.deepEqual(ids(state), [idOf(3), idOf(2), idOf(1)]);
  assert.equal(countLabel(state), "3 in the live view");
  assert.equal(state.results.asOf, idOf(3));
  assert.deepEqual(pageCalls(api)[0], {
    Query: "",
    OrderBy: "number desc",
    Cursor: "",
    Direction: "forward",
    AsOf: "",
    Limit: PAGE_SIZE,
  });
  assert.equal(store.pairNumber(idOf(3)), 3, "a pair's number is Marasi's pair number");
  assert.equal(store.pairNumber("missing"), "?");
});

test("scrolling down loads later pages under the first page's as_of", async () => {
  const api = fakeApi({ traffic: pairs(PAGE_SIZE * 2 + 5) });
  const store = createLedgerStore(api);
  await store.populate();
  const asOf = get(store).results.asOf;
  api.capture(pair(9999));

  await scrollTo(store, PAGE_SIZE - 20);
  await scrollTo(store, PAGE_SIZE * 2 - 20);

  const state = get(store);
  assert.equal(tableRows(state).length, PAGE_SIZE * 2 + 5);
  assert.ok(!ids(state).includes(idOf(9999)), "the new pair stays out of the snapshot");
  assert.equal(state.results.hasAfter, false);
  const later = pageCalls(api).slice(1);
  assert.equal(later.length, 2);
  assert.ok(later.every((req) => req.AsOf === asOf && req.Direction === "forward" && req.Cursor));
});

test("far pages are dropped while scrolling, and load again backward on the way up", async () => {
  const total = PAGE_SIZE * 12;
  const api = fakeApi({ traffic: pairs(total) });
  const store = createLedgerStore(api);
  await store.populate();

  // Scroll down a page at a time; the window follows the viewport.
  for (let step = 0; step < 11; step++) {
    const rows = tableRows(get(store));
    await scrollTo(store, rows.length - 40);
    assert.ok(rows.length <= MAX_WINDOW_ROWS + PAGE_SIZE, "the window stays bounded");
  }
  let state = get(store);
  assert.equal(state.results.hasBefore, true, "the top pages were dropped");
  assert.ok(tableRows(state).length <= MAX_WINDOW_ROWS);
  const top = tableRows(state)[0].ID;
  const topNumber = store.pairNumber(top);
  assert.equal(topNumber, Number(top.slice(1)), "numbers are the pairs' own, wherever the window is");

  // Back up: the dropped pages come back, backward, without duplicates.
  const asOf = state.results.asOf;
  for (let step = 0; step < 12 && get(store).results.hasBefore; step++) {
    await scrollTo(store, 0);
  }
  state = get(store);
  assert.equal(state.results.hasBefore, false);
  assert.equal(tableRows(state)[0].ID, idOf(total));
  assert.equal(new Set(ids(state)).size, tableRows(state).length);
  const backward = pageCalls(api).filter((req) => req.Direction === "backward");
  assert.ok(backward.length > 0);
  assert.ok(backward.every((req) => req.AsOf === asOf && req.Cursor));
});

test("sorting by a column reloads from the top under its order_by, and the sort persists", async () => {
  const traffic = [
    pair(1, { Host: "b.test" }),
    pair(2, { Host: "c.test" }),
    pair(3, { Host: "a.test" }),
  ];
  const api = fakeApi({ traffic });
  const store = createLedgerStore(api);
  await store.populate();
  const reset = get(store).results.reset;

  await store.sortBy("host");
  assert.deepEqual(ids(get(store)), [idOf(3), idOf(1), idOf(2)]);
  assert.ok(get(store).results.reset > reset, "the table goes back to the top");
  assert.deepEqual(get(store).sort, { field: "host", desc: false });
  let last = pageCalls(api).at(-1);
  assert.equal(last.OrderBy, "host");
  assert.equal(last.Cursor, "", "a cursor only works with its sort");
  assert.equal(last.AsOf, "");

  await store.sortBy("host");
  assert.deepEqual(ids(get(store)), [idOf(2), idOf(1), idOf(3)]);
  assert.equal(pageCalls(api).at(-1).OrderBy, "host desc");

  // # and Time are one order, newest first by default.
  await store.sortBy("requested_at");
  assert.deepEqual(get(store).sort, { field: "requested_at", desc: true });

  await store.sortBy("status_code");
  store.clear();
  assert.deepEqual(get(store).sort, { field: "status_code", desc: false });
});

test("a pending pair sorts last both ways and moves once its response arrives", async () => {
  const traffic = [pair(1, { StatusCode: 500 }), pair(2, { StatusCode: -1, ContentType: "", Length: "" }), pair(3, { StatusCode: 200 })];
  const api = fakeApi({ traffic });
  const store = createLedgerStore(api);
  await store.populate();
  await store.sortBy("status_code");
  assert.deepEqual(ids(get(store)), [idOf(3), idOf(1), idOf(2)]);
  await store.sortBy("status_code");
  assert.deepEqual(ids(get(store)), [idOf(1), idOf(3), idOf(2)]);

  // The response fills the row in where it is.
  api.db[1].StatusCode = 404;
  store.onResponse({ ID: idOf(2), StatusCode: 404, Status: "404 Not Found" });
  store.flush();
  assert.deepEqual(ids(get(store)), [idOf(1), idOf(3), idOf(2)]);
  assert.equal(tableRows(get(store))[2].StatusCode, 404);

  // The next read sorts it by its status.
  await store.sortBy("status_code");
  assert.deepEqual(ids(get(store)), [idOf(3), idOf(2), idOf(1)]);
});

test("in the newest-first live view at the top, new pairs appear at the top", async () => {
  const api = fakeApi({ traffic: pairs(2) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 0);
  assert.equal(newMatchesKind(get(store)), "top");

  api.capture(pair(3));
  store.onRequest(pair(3, { StatusCode: 0, ContentType: "" }));
  store.flush();
  let state = get(store);
  assert.deepEqual(ids(state), [idOf(3), idOf(2), idOf(1)]);
  assert.equal(countLabel(state), "3 in the live view");

  // An excluded type leaves the live view once its response says so.
  await store.saveExclusion(["image/*"]);
  await scrollTo(store, 0);
  api.capture(pair(4, { ContentType: "image/png" }));
  store.onRequest(pair(4, { StatusCode: 0, ContentType: "" }));
  store.flush();
  assert.equal(ids(get(store))[0], idOf(4));
  store.onResponse({ ID: idOf(4), StatusCode: 200, ContentType: "image/png" });
  store.flush();
  state = get(store);
  assert.deepEqual(ids(state), [idOf(3), idOf(2), idOf(1)]);
});

test("a request event that arrives twice joins the top once", async () => {
  const api = fakeApi({ traffic: pairs(2) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 0);
  api.capture(pair(3));
  store.onRequest(pair(3, { StatusCode: 0, ContentType: "" }));
  store.onRequest(pair(3, { StatusCode: 0, ContentType: "" }));
  store.flush();
  assert.deepEqual(ids(get(store)), [idOf(3), idOf(2), idOf(1)]);
  assert.equal(countLabel(get(store)), "3 in the live view");
});

test("scrolled down in the live view, rows don't move and an N new count waits", async () => {
  const api = fakeApi({ traffic: pairs(50) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 10);

  api.capture(pair(51));
  api.capture(pair(52));
  store.onRequest(pair(51));
  store.onRequest(pair(52));
  store.flush();
  assert.equal(ids(get(store))[0], idOf(50), "rows don't move");
  await store.countNewMatches();
  let state = get(store);
  assert.equal(state.results.newCount, 2);
  assert.deepEqual(countCalls(api).at(-1), { Query: "", After: idOf(50) });

  // Back at the top, the new pairs load in.
  await scrollTo(store, 0);
  state = get(store);
  assert.deepEqual(ids(state).slice(0, 3), [idOf(52), idOf(51), idOf(50)]);
  assert.equal(state.results.newCount, 0);
});

test("query results count new matches after their as_of and show them in place", async () => {
  const total = PAGE_SIZE * 16;
  const even = (p) => Number(p.ID.slice(1)) % 2 === 0;
  const api = fakeApi({ traffic: pairs(total), queries: { even } });
  const store = createLedgerStore(api);
  await store.runQuery("even");
  assert.equal(newMatchesKind(get(store)), "pill");
  const asOf = get(store).results.asOf;

  // Scroll down until the top pages are dropped, then stop partway into
  // the window's second page.
  for (let step = 0; step < 7; step++) {
    await scrollTo(store, tableRows(get(store)).length - 40);
  }
  assert.equal(get(store).results.hasBefore, true);
  const before = ids(get(store));
  const topIndex = get(store).results.chunks[0].items.length + 30;
  await scrollTo(store, topIndex);
  const topRow = before[topIndex];

  for (let n = total + 1; n <= total + 4; n++) {
    api.capture(pair(n));
    store.onRequest(pair(n));
  }
  store.flush();
  await store.countNewMatches();
  assert.equal(get(store).results.newCount, 2);
  assert.deepEqual(countCalls(api).at(-1), { Query: "even", After: asOf });
  assert.equal(get(store).results.asOf, asOf, "the rows stay until Show");

  const reset = get(store).results.reset;
  await store.showNewMatches();
  let state = get(store);
  assert.equal(state.results.reset, reset, "a refresh in place doesn't send the table to the top");
  const after = ids(state);
  const at = after.indexOf(topRow);
  assert.ok(at >= 0 && at < 30, "the top visible row is read again, near the window's top");
  assert.deepEqual(after.slice(0, at + 1), before.slice(topIndex - at, topIndex + 1), "anchored at its page's cursor");
  assert.notEqual(state.results.asOf, asOf);
  assert.equal(state.results.newCount, 0);
  assert.equal(state.results.hasBefore, true);
  const refresh = pageCalls(api).at(-1);
  assert.equal(refresh.Direction, "forward");
  assert.ok(refresh.Cursor, "read from a cursor, not the top");
  assert.equal(refresh.AsOf, "", "the refresh reads under a new as_of");

  // Scrolling up loads the rows above, new matches included, newest first.
  for (let step = 0; step < 20 && get(store).results.hasBefore; step++) {
    await scrollTo(store, 0);
  }
  state = get(store);
  assert.equal(state.results.hasBefore, false);
  assert.deepEqual(ids(state).slice(0, 3), [idOf(total + 4), idOf(total + 2), idOf(total)]);
});

test("Show at the top of a sorted live view reads from the top", async () => {
  const api = fakeApi({ traffic: pairs(3, (n) => ({ Host: `h${n}.test` })) });
  const store = createLedgerStore(api);
  await store.populate();
  await store.sortBy("host");
  await scrollTo(store, 0);
  assert.equal(newMatchesKind(get(store)), "pill");
  api.capture(pair(4, { Host: "h0.test" }));
  store.onRequest(pair(4, { Host: "h0.test" }));
  store.flush();
  assert.equal(ids(get(store))[0], idOf(1), "other sorts never move rows");
  await store.countNewMatches();
  await store.showNewMatches();
  assert.equal(ids(get(store))[0], idOf(4));
  assert.equal(pageCalls(api).at(-1).Cursor, "");
});

test("an invalid query records the error and keeps the earlier results", async () => {
  const api = fakeApi({ traffic: pairs(3), queries: { one: (p) => p.ID === idOf(1) } });
  const store = createLedgerStore(api);
  await store.runQuery("one");
  await store.runQuery("bad");

  const state = get(store);
  assert.deepEqual(state.query.error, { query: "bad", message: "expected a value", position: 3 });
  assert.equal(state.query.ranQuery, "one");
  assert.deepEqual(ids(state), [idOf(1)]);
  assert.equal(countLabel(state), "1 matching");

  await store.runQuery("one");
  assert.equal(get(store).query.error, null);
});

test("querying is true while Marasi reads a query's first page, and clears with its result or error", async () => {
  const api = fakeApi({ traffic: pairs(3), queries: { one: (p) => p.ID === idOf(1) } });
  const store = createLedgerStore(api);
  await store.populate();
  assert.equal(get(store).querying, false);

  const running = store.runQuery("one");
  assert.equal(get(store).querying, true, "the read is in flight");
  await running;
  assert.equal(get(store).querying, false);

  const failing = store.runQuery("bad");
  assert.equal(get(store).querying, true);
  await failing;
  assert.equal(get(store).querying, false, "an invalid query clears it too");

  const sorting = store.sortBy("host");
  assert.equal(get(store).querying, true, "a sort reads from the top too");
  await sorting;
  assert.equal(get(store).querying, false);
});

test("clearing the query returns to the live view from the top", async () => {
  const api = fakeApi({ traffic: pairs(3), queries: { one: (p) => p.ID === idOf(1) } });
  const store = createLedgerStore(api);
  store.setQueryText("one");
  await store.runQuery();
  assert.ok(isQueryActive(get(store).query));
  await store.clearQuery();
  const state = get(store);
  assert.equal(state.queryText, "");
  assert.equal(isQueryActive(state.query), false);
  assert.deepEqual(ids(state), [idOf(3), idOf(2), idOf(1)]);
});

test("a pair keeps its number under any query or sort, gaps included", async () => {
  const traffic = [pair(1), pair(2), pair(4), pair(7)];
  const api = fakeApi({ traffic, queries: { even: (p) => p.Number % 2 === 0 } });
  const store = createLedgerStore(api);
  await store.runQuery("even");
  await store.sortBy("host");
  assert.deepEqual(tableRows(get(store)).map((row) => row.Number).sort(), [2, 4]);
  assert.equal(store.pairNumber(idOf(4)), 4);
  assert.equal(store.shownPairAtNumber(4)?.ID, idOf(4));
  assert.equal(store.shownPairAtNumber(3), undefined, "a deleted number finds nothing");
});

test("a refresh in place deep in a page reads at most Marasi's largest page, and keeps the rows in view", async () => {
  const api = fakeApi({ traffic: pairs(1000) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 380);
  await store.refresh();
  // The refresh left one long page; read again from deep inside it.
  await scrollTo(store, 350);
  const topRow = ids(get(store))[350];
  const reset = get(store).results.reset;
  await store.refresh();
  const state = get(store);
  assert.equal(state.results.reset, reset, "no fallback to the top");
  assert.ok(ids(state).includes(topRow), "the top row in view is read again");
  assert.ok(pageCalls(api).every((call) => call.Limit <= 500));
});

test("jumping to a request that isn't loaded reads the rows around it, under the same query and sort", async () => {
  const api = fakeApi({ traffic: pairs(1000) });
  const store = createLedgerStore(api);
  await store.populate();
  assert.equal(store.shownPairAtNumber(300), undefined, "only the newest page is loaded");

  const { pair } = await store.goToNumber(300);
  assert.equal(pair.ID, idOf(300));
  const state = get(store);
  assert.equal(state.queryText, "", "the query is left alone");
  assert.equal(isQueryActive(state.query), false);
  const numbers = tableRows(state).map((row) => row.Number);
  assert.ok(numbers.includes(301) && numbers.includes(300) && numbers.includes(299), "rows on both sides");
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a), "newest first");
  assert.equal(new Set(numbers).size, numbers.length, "no duplicate of 300");
  assert.equal(state.results.start, 1000 - numbers[0], "the readout knows where the window is");
  assert.equal(state.results.hasBefore, true);
  assert.equal(state.results.hasAfter, true);

  // Scrolling on keeps reading the same results by cursor.
  await scrollTo(store, tableRows(get(store)).length - 20);
  const more = tableRows(get(store)).map((row) => row.Number);
  assert.ok(more.at(-1) < numbers.at(-1), "older rows load below");
  assert.equal(pageCalls(api).at(-1).Query, "");
});

test("a jump under a query keeps the query's rows only", async () => {
  const api = fakeApi({ traffic: pairs(1000), queries: { even: (p) => p.Number % 2 === 0 } });
  const store = createLedgerStore(api);
  store.setQueryText("even");
  await store.runQuery();
  const { pair } = await store.goToNumber(400);
  assert.equal(pair.Number, 400);
  assert.ok(tableRows(get(store)).every((row) => row.Number % 2 === 0));
  assert.equal(get(store).queryText, "even");
});

test("a jump to a request the results don't hold opens it anyway, leaving them as they were", async () => {
  const api = fakeApi({ traffic: pairs(1000), queries: { even: (p) => p.Number % 2 === 0 } });
  const store = createLedgerStore(api);
  store.setQueryText("even");
  await store.runQuery();
  const before = tableRows(get(store));
  const { pair } = await store.goToNumber(301);
  assert.equal(pair.Number, 301);
  assert.equal(get(store).focusRow?.Number, 301, "it opens in the drawer");
  assert.equal(store.pairNumber(pair.ID), 301);
  assert.equal(tableRows(get(store)), before, "the table stays as it was");
});

test("a jump opens a request the type filter hides, and only a number with no request is missing", async () => {
  const api = fakeApi({
    traffic: pairs(10, (n) => (n === 4 ? { ContentType: "image/png" } : {})),
    exclusion: ["image/*"],
  });
  const store = createLedgerStore(api);
  await store.populate();
  const { pair } = await store.goToNumber(4);
  assert.equal(pair?.Number, 4);
  assert.equal(get(store).focusRow?.Number, 4);
  assert.deepEqual(await store.goToNumber(4000), { reason: "missing" });
});

test("under another sort a jump opens a request that isn't loaded, without touching the table", async () => {
  const api = fakeApi({ traffic: pairs(1000) });
  const store = createLedgerStore(api);
  await store.populate();
  await store.sortBy("host");
  const rows = tableRows(get(store));
  assert.equal((await store.goToNumber(rows[5].Number)).pair.ID, rows[5].ID, "a loaded one opens in place");

  // Host ties sort by id, oldest first: 1 to 200 are loaded.
  assert.equal(store.shownPairAtNumber(201), undefined);
  const { pair } = await store.goToNumber(201);
  assert.equal(pair.Number, 201);
  const state = get(store);
  assert.equal(focusedPair(state)?.Number, 201, "the drawer shows it");
  assert.equal(store.pairNumber(pair.ID), 201, "titles name it");
  assert.deepEqual(selectedPairs(state).map((p) => p.Number), [201], "its actions act on it");
  assert.equal(tableRows(state), rows, "the table is as it was");
  assert.equal(state.queryText, "");
  assert.deepEqual(state.sort, { field: "host", desc: false });
});

test("next and previous go on from a request that isn't loaded, by #, back into the table", async () => {
  const api = fakeApi({ traffic: pairs(1000) });
  const store = createLedgerStore(api);
  await store.populate();
  await store.sortBy("host");
  await store.goToNumber(205);
  await store.stepSelection(-1);
  assert.equal(focusedPair(get(store))?.Number, 206, "previous is the next # up");
  await store.stepSelection(1);
  await store.stepSelection(1);
  assert.equal(focusedPair(get(store))?.Number, 204, "next is the next # down");
  for (let i = 0; i < 4; i++) await store.stepSelection(1);
  const state = get(store);
  assert.equal(focusedPair(state)?.Number, 200, "200 is loaded");
  assert.ok(tableRows(state).some((row) => row.ID === focusedPair(state).ID), "back among the loaded rows");
  await store.stepSelection(-1);
  assert.equal(focusedPair(get(store))?.Number, 199, "and steps by the table's order from there");
});

test("⌘⇧] and ⌘⇧[ step by # through the project, past the query and the type filter", async () => {
  const api = fakeApi({
    traffic: pairs(50, (n) => (n === 12 ? { ContentType: "image/png" } : {})),
    exclusion: ["image/png"],
    queries: { odd: (p) => p.Number % 2 === 1 },
  });
  const store = createLedgerStore(api);
  await store.populate();
  store.setQueryText("odd");
  await store.runQuery();
  const rows = tableRows(get(store));
  store.selectPair(idOf(11));
  assert.equal((await store.stepNumber(1)).pair.Number, 12);
  let state = get(store);
  assert.equal(focusedPair(state)?.Number, 12, "the next # opens, though the query and the filter leave it out");
  assert.equal(tableRows(state), rows, "the table is as it was");
  await store.stepNumber(1);
  state = get(store);
  assert.equal(focusedPair(state)?.Number, 13);
  assert.ok(tableRows(state).some((row) => row.ID === idOf(13)), "a loaded one is selected in the table");
  await store.stepNumber(-1);
  await store.stepNumber(-1);
  assert.equal(focusedPair(get(store))?.Number, 11, "previous goes down by #");
  store.selectPair(idOf(49));
  await store.stepNumber(1);
  assert.equal(focusedPair(get(store))?.Number, 50);
  assert.deepEqual(await store.stepNumber(1), { pair: null }, "nothing past the newest pair");
  assert.equal(focusedPair(get(store))?.Number, 50, "the focus stays");
});

test("⌘[ and ⌘] open the results' first and last pairs, reading their page when it isn't loaded", async () => {
  const api = fakeApi({ traffic: pairs(1000) });
  const store = createLedgerStore(api);
  await store.populate();
  store.selectPair(idOf(990));
  assert.equal((await store.goToEdge(true)).pair.Number, 1);
  let state = get(store);
  assert.equal(focusedPair(state)?.Number, 1, "the last pair of the newest-first results");
  assert.equal(tableRows(state).at(-1).Number, 1, "the table ends with it");
  assert.equal(state.results.hasAfter, false);
  assert.equal(state.results.start, 1000 - tableRows(state).length, "its rows' place in the results is known");
  await scrollTo(store, 0, 30);
  assert.ok(tableRows(get(store))[0].Number > tableRows(state)[0].Number, "pages above it load as the table scrolls up");
  assert.equal((await store.goToEdge(false)).pair.Number, 1000);
  state = get(store);
  assert.equal(tableRows(state)[0].Number, 1000, "back at the top");
  assert.equal(state.results.start, 0);
  const reads = pageCalls(api).length;
  assert.equal((await store.goToEdge(false)).pair.Number, 1000);
  assert.equal(pageCalls(api).length, reads, "an edge the window holds needs no read");
});

test("⌘] opens the results' highest-numbered pair and ⌘[ the lowest, under any sort", async () => {
  const api = fakeApi({ traffic: pairs(1000), queries: { even: (p) => p.Number % 2 === 0 } });
  const store = createLedgerStore(api);
  await store.populate();
  store.setQueryText("even");
  await store.runQuery();
  store.selectPair(idOf(990));
  assert.equal((await store.goToNumberEnd(false)).pair.Number, 2, "newest first: the bottom row, read when needed");
  assert.equal(tableRows(get(store)).at(-1).Number, 2);
  assert.equal((await store.goToNumberEnd(true)).pair.Number, 1000, "and the top row");
  assert.equal(tableRows(get(store))[0].Number, 1000);
  await store.sortBy("number");
  assert.equal((await store.goToNumberEnd(true)).pair.Number, 1000, "oldest first: the bottom row");
  assert.equal(tableRows(get(store)).at(-1).Number, 1000);
  await store.sortBy("host");
  const rows = tableRows(get(store));
  assert.equal((await store.goToNumberEnd(false)).pair.Number, 2, "another sort: read alone");
  assert.equal(focusedPair(get(store))?.Number, 2);
  assert.equal(tableRows(get(store)), rows, "the table stays as it is");
});

test("back to the live view clears the query and the sort and reads newest first from the top", async () => {
  const api = fakeApi({ traffic: pairs(3), queries: { one: (p) => p.ID !== idOf(2) } });
  const store = createLedgerStore(api);
  store.setQueryText("one");
  await store.runQuery();
  await store.sortBy("host");
  assert.equal(isLiveNewestFirst(get(store)), false);

  await store.backToLive();
  const state = get(store);
  assert.equal(state.queryText, "");
  assert.equal(isQueryActive(state.query), false);
  assert.deepEqual(state.sort, { field: "number", desc: true });
  assert.equal(isLiveNewestFirst(state), true);
  assert.deepEqual(ids(state), [idOf(3), idOf(2), idOf(1)]);
});

test("back to the live view from the live view itself reads nothing", async () => {
  const api = fakeApi({ traffic: pairs(2) });
  const store = createLedgerStore(api);
  await store.populate();
  const before = pageCalls(api).length;
  await store.backToLive();
  assert.equal(pageCalls(api).length, before);
});

test("the count shows 100,000+ when Marasi caps it, and the exclusion's hidden pairs", async () => {
  const api = fakeApi({
    traffic: [pair(1), pair(2, { ContentType: "image/png" }), pair(3)],
    exclusion: ["image/png"],
  });
  api.countTraffic = async (query, after, options = {}) =>
    options.IgnoreExclusion ? { Count: 3, Capped: false } : { Count: 2, Capped: false };
  const store = createLedgerStore(api);
  await store.populate();
  assert.equal(hiddenByTypeCount(get(store)), 1);

  api.countTraffic = async () => ({ Count: 100000, Capped: true });
  await store.reload();
  assert.equal(countLabel(get(store)), "100,000+ in the live view");
  assert.equal(hiddenByTypeCount(get(store)), null);
});

test("saving the exclusion stores it and reloads the rows", async () => {
  const api = fakeApi({ traffic: [pair(1), pair(2, { ContentType: "image/png" })] });
  const store = createLedgerStore(api);
  await store.populate();
  await store.saveExclusion(["image/png"]);
  assert.deepEqual(get(store).exclusion, ["image/png"]);
  assert.deepEqual(ids(get(store)), [idOf(1)]);
});

test("populate tells whether the project keeps its own exclusion", async () => {
  const following = createLedgerStore(fakeApi({ defaultExclusion: ["image/*"] }));
  await following.populate();
  assert.deepEqual(get(following).exclusion, ["image/*"]);
  assert.equal(get(following).ownExclusion, false);

  const own = createLedgerStore(fakeApi({ exclusion: [], defaultExclusion: ["image/*"] }));
  await own.populate();
  assert.deepEqual(get(own).exclusion, []);
  assert.equal(get(own).ownExclusion, true);
});

test("saving the exclusion normalises it and gives the project its own list", async () => {
  const api = fakeApi({ defaultExclusion: ["image/*"] });
  const store = createLedgerStore(api);
  await store.populate();
  await store.saveExclusion(["image/*", "Text/CSS; charset=utf-8"]);
  assert.deepEqual(get(store).exclusion, ["image/*", "text/css"]);
  assert.equal(get(store).ownExclusion, true);
  assert.deepEqual(api.calls.find((c) => c[0] === "setExclusion"), ["setExclusion", ["image/*", "text/css"]]);
});

test("resetting the exclusion follows the app default again and reruns the query", async () => {
  const api = fakeApi({
    traffic: [pair(1), pair(2, { ContentType: "image/png" }), pair(3, { ContentType: "text/css" })],
    exclusion: ["text/css"],
    defaultExclusion: ["image/*"],
    queries: { "host = x": () => true },
  });
  const store = createLedgerStore(api);
  await store.populate();
  await store.runQuery("host = x");
  api.calls.length = 0;

  await store.resetExclusion();

  assert.deepEqual(get(store).exclusion, ["image/*"]);
  assert.equal(get(store).ownExclusion, false);
  assert.deepEqual(api.calls[0], ["resetExclusion"]);
  assert.equal(pageCalls(api).at(-1).Query, "host = x");
  assert.deepEqual(ids(get(store)), [idOf(3), idOf(1)]);
});

test("the live view hides a type through its major/* and keeps pairs with no response", async () => {
  const store = createLedgerStore(
    fakeApi({
      traffic: [
        pair(1, { ContentType: "image/png" }),
        pair(2, { ContentType: "text/html" }),
        pair(3, { ContentType: "" }),
        pair(4, { ContentType: "Image/GIF" }),
      ],
      exclusion: ["image/*"],
    }),
  );
  await store.populate();
  await store.settled();
  const state = get(store);
  assert.deepEqual(ids(state), [idOf(3), idOf(2)]);
  assert.equal(hiddenByTypeCount(state), 2);
});

test("a new pair whose response arrives under a hidden major type leaves the live view", async () => {
  const store = createLedgerStore(fakeApi({ traffic: [pair(1)], exclusion: ["image/*"] }));
  await store.populate();
  await store.settled();
  store.onRequest(pair(2, { StatusCode: 0, ContentType: "", Length: "" }));
  store.flush();
  assert.deepEqual(ids(get(store)), [idOf(2), idOf(1)]);
  store.onResponse({ ID: idOf(2), StatusCode: 200, ContentType: "Image/PNG; q=1", Length: "5" });
  store.flush();
  assert.deepEqual(ids(get(store)), [idOf(1)]);
});

test("the live count drops a pair its response hides, as Marasi counts it", async () => {
  const api = fakeApi({ traffic: [pair(1)], exclusion: ["image/*"] });
  const store = createLedgerStore(api);
  await store.populate();
  await store.settled();
  api.capture(pair(2, { StatusCode: 0, ContentType: "", Length: "" }));
  store.onRequest(pair(2, { StatusCode: 0, ContentType: "", Length: "" }));
  store.flush();
  assert.equal(countLabel(get(store)), "2 in the live view");
  assert.equal(hiddenByTypeCount(get(store)), 0);

  api.db.find((p) => p.ID === idOf(2)).ContentType = "image/png";
  store.onResponse({ ID: idOf(2), StatusCode: 200, ContentType: "image/png", Length: "5" });
  store.flush();
  const marasi = await api.countTraffic("", "");
  assert.equal(countLabel(get(store)), `${marasi.Count} in the live view`);
  assert.equal(hiddenByTypeCount(get(store)), 1);
});

test("hiding a type updates the table and the hidden count", async () => {
  const store = createLedgerStore(
    fakeApi({
      traffic: [pair(1, { ContentType: "text/css" }), pair(2, { ContentType: "text/html" })],
      exclusion: [],
    }),
  );
  await store.populate();
  await store.saveExclusion(["text/css"]);
  await store.settled();
  assert.deepEqual(ids(get(store)), [idOf(2)]);
  assert.equal(hiddenByTypeCount(get(store)), 1);
});

test("the Types menu's counts load on request", async () => {
  const counts = { Counts: [{ ContentType: "text/html", Count: 3 }], Complete: { sitemap: false } };
  const api = fakeApi({ typeCounts: counts });
  const store = createLedgerStore(api);
  assert.deepEqual(get(store).typeCounts, { counts: [], complete: true, loaded: false });

  await store.loadTypeCounts();

  assert.deepEqual(get(store).typeCounts, {
    counts: [{ ContentType: "text/html", Count: 3 }],
    complete: false,
    loaded: true,
  });
});

test("counts that arrive after a project switch are dropped", async () => {
  let resolve;
  const api = fakeApi({ typeCounts: () => new Promise((r) => (resolve = r)) });
  const store = createLedgerStore(api);
  const loading = store.loadTypeCounts();
  store.clear();
  resolve({ Counts: [{ ContentType: "text/html", Count: 3 }], Complete: {} });
  await loading;
  assert.equal(get(store).typeCounts.loaded, false);
});

test("editing the app default updates a project that follows it", async () => {
  const api = fakeApi({
    traffic: [pair(1), pair(2, { ContentType: "font/woff2" })],
    defaultExclusion: ["image/*"],
    queries: { "host = x": () => true },
  });
  const store = createLedgerStore(api);
  await store.populate();
  await store.runQuery("host = x");
  assert.deepEqual(ids(get(store)), [idOf(2), idOf(1)]);
  api.calls.length = 0;

  await store.saveDefaultExclusion(["image/*", "Font/*"]);

  assert.deepEqual(get(store).defaultExclusion, ["image/*", "font/*"]);
  assert.deepEqual(get(store).exclusion, ["image/*", "font/*"]);
  assert.deepEqual(api.calls[0], ["setDefaultExclusion", ["image/*", "font/*"]]);
  assert.equal(pageCalls(api).at(-1).Query, "host = x");
  assert.deepEqual(ids(get(store)), [idOf(1)]);
});

test("editing the app default leaves a project's own list alone", async () => {
  const api = fakeApi({ exclusion: ["text/css"], defaultExclusion: ["image/*"] });
  const store = createLedgerStore(api);
  await store.populate();
  api.calls.length = 0;

  await store.saveDefaultExclusion(["font/*"]);

  assert.deepEqual(get(store).exclusion, ["text/css"]);
  assert.deepEqual(api.calls, [["setDefaultExclusion", ["font/*"]]]);
});

test("loadDefaultExclusion reads the app default", async () => {
  const store = createLedgerStore(fakeApi({ defaultExclusion: ["image/*"] }));
  assert.deepEqual(await store.loadDefaultExclusion(), ["image/*"]);
  assert.deepEqual(get(store).defaultExclusion, ["image/*"]);
  store.clear();
  assert.deepEqual(get(store).defaultExclusion, ["image/*"], "a project switch keeps the app default");
});

test("the focused pair stays in the drawer when its page is dropped", async () => {
  const api = fakeApi({ traffic: pairs(PAGE_SIZE * 10) });
  const store = createLedgerStore(api);
  await store.populate();
  const id = tableRows(get(store))[5].ID;
  store.selectPair(id);
  for (let step = 0; step < 9; step++) {
    await scrollTo(store, tableRows(get(store)).length - 40);
  }
  const state = get(store);
  assert.ok(!ids(state).includes(id), "its page was dropped");
  assert.equal(focusedPair(state)?.ID, id);
});

test("selected pairs stay selected when their page is dropped, and a fresh read drops them", async () => {
  const api = fakeApi({ traffic: pairs(PAGE_SIZE * 10), queries: { odd: (p) => Number(p.ID.slice(1)) % 2 === 1 } });
  const store = createLedgerStore(api);
  await store.populate();
  const [a, b] = [tableRows(get(store))[3].ID, tableRows(get(store))[5].ID];
  store.clickRow(a);
  store.clickRow(b, { toggle: true });
  for (let step = 0; step < 9; step++) {
    await scrollTo(store, tableRows(get(store)).length - 40);
  }
  assert.ok(!ids(get(store)).includes(a), "their page was dropped");
  assert.deepEqual([...get(store).selection.ids].sort(), [a, b].sort());
  assert.equal(focusedPair(get(store))?.ID, b);

  await store.runQuery("odd");
  const kept = [a, b].filter((id) => Number(id.slice(1)) % 2 === 1);
  assert.deepEqual([...get(store).selection.ids], kept);
});

test("a metadata patch reaches the loaded rows", async () => {
  const store = createLedgerStore(fakeApi({ traffic: pairs(2) }));
  await store.populate();
  store.patchMetadata(idOf(1), { has_note: 1 });
  assert.equal(store.findShownPair(idOf(1)).Metadata.has_note, 1);
});

test("the index warning follows the page's completeness", async () => {
  const api = fakeApi({ traffic: pairs(1), queries: { all: () => true } });
  const query = api.queryTraffic;
  api.queryTraffic = async (req) => ({ ...(await query(req)), IndexComplete: false });
  const store = createLedgerStore(api);
  await store.runQuery("all");
  assert.equal(indexWarning(get(store)), "Search index still building");
});

test("clearing for another project drops a page still loading", async () => {
  let release;
  const api = fakeApi();
  api.queryTraffic = () => new Promise((resolve) => (release = resolve));
  const store = createLedgerStore(api);
  const loading = store.populate();
  store.clear();
  release({ Items: [pair(1)], NextCursor: null, PrevCursor: null, AsOf: idOf(1), IndexComplete: true });
  await loading;
  assert.deepEqual(ids(get(store)), []);
});

test("toggling a query term adds it to the query box and runs the query", async () => {
  const api = fakeApi({
    traffic: pairs(2),
    queries: { "host = x note:*": (p) => p.ID === idOf(1) },
  });
  const store = createLedgerStore(api);
  store.setQueryText("host = x");
  await store.toggleQueryTerm("note:*");
  const state = get(store);
  assert.equal(state.queryText, "host = x note:*");
  assert.equal(state.query.ranQuery, "host = x note:*");
  assert.deepEqual(ids(state), [idOf(1)]);
});

test("toggling the query's only term off returns to the live view", async () => {
  const store = createLedgerStore(fakeApi({ traffic: pairs(2), queries: { "finding:*": () => false } }));
  await store.populate();
  await store.toggleQueryTerm("finding:*");
  await store.toggleQueryTerm("finding:*");
  const state = get(store);
  assert.equal(state.queryText, "");
  assert.ok(!isQueryActive(state.query));
});

test("counting queries reads each count, capped, and marks a failed one null", async () => {
  const api = fakeApi({
    counts: {
      "note:*": { Count: 3, Capped: false, IndexComplete: true },
      "finding:*": { Count: 100000, Capped: true, IndexComplete: true },
      "test_case:*": { Count: 0, Capped: false, IndexComplete: true, QueryError: { Message: "bad", Position: 1 } },
      "launchpad:*": new Error("no project"),
    },
  });
  const store = createLedgerStore(api);
  const counts = await store.countQueries(["note:*", "finding:*", "test_case:*", "launchpad:*"]);
  assert.deepEqual(counts, {
    "note:*": { count: 3, capped: false },
    "finding:*": { count: 100000, capped: true },
    "test_case:*": null,
    "launchpad:*": null,
  });
  assert.ok(countCalls(api).some((req) => req.Query === "note:*" && req.After === ""));
});

test("live pairs at the top leave the results' as_of alone, so later pages agree", async () => {
  const api = fakeApi({ traffic: pairs(PAGE_SIZE * 2) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 0);
  const asOf = get(store).results.asOf;

  const arrived = PAGE_SIZE * 2 + 1;
  api.capture(pair(arrived));
  store.onRequest(pair(arrived));
  store.flush();
  assert.equal(ids(get(store))[0], idOf(arrived));
  assert.equal(get(store).results.asOf, asOf, "every page of these results passes the same as_of");

  await scrollTo(store, PAGE_SIZE - 20);
  const forward = pageCalls(api).filter((req) => req.Cursor);
  assert.ok(forward.length > 0);
  assert.ok(forward.every((req) => req.AsOf === asOf));
  const state = get(store);
  assert.equal(tableRows(state).length, PAGE_SIZE * 2 + 1);
  assert.equal(new Set(ids(state)).size, tableRows(state).length, "no row twice");

  // Scrolled down, only pairs after the shown one are new matches.
  api.capture(pair(arrived + 1));
  store.onRequest(pair(arrived + 1));
  store.flush();
  await store.countNewMatches();
  assert.equal(get(store).results.newCount, 1);
  assert.deepEqual(countCalls(api).at(-1), { Query: "", After: idOf(arrived) });
});

test("⌘A after live pairs joined the top covers them", async () => {
  const api = fakeApi({ traffic: pairs(3) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 0);
  api.capture(pair(4));
  store.onRequest(pair(4));
  store.flush();
  store.selectAll();
  assert.equal(get(store).selection.query.asOf, idOf(4));
  assert.ok(get(store).selection.ids.has(idOf(4)));
});

test("the live view stays within the window as pairs pour in at the top", async () => {
  const api = fakeApi({ traffic: pairs(PAGE_SIZE) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 0);
  const focus = idOf(PAGE_SIZE);
  store.selectPair(focus);

  let n = PAGE_SIZE;
  for (let burst = 0; burst < 10; burst++) {
    for (let k = 0; k < PAGE_SIZE; k++) {
      n += 1;
      api.capture(pair(n));
      store.onRequest(pair(n, { Raw: "GET / HTTP/1.1\r\n\r\nbody", Prettified: "body" }));
    }
    store.flush();
    await store.settled();
  }
  store.flush();
  await store.settled();

  let state = get(store);
  assert.ok(tableRows(state).length <= MAX_WINDOW_ROWS, "the window stays bounded");
  assert.equal(ids(state)[0], idOf(n), "the newest pair is at the top");
  assert.ok(
    tableRows(state).every((row) => row.Raw === undefined && row.Prettified === undefined),
    "no bodies held",
  );
  assert.equal(state.results.hasAfter, true);
  assert.equal(focusedPair(state)?.ID, focus, "the drawer keeps its pair");

  // The dropped rows page back in by cursor.
  for (let step = 0; step < 30 && get(store).results.hasAfter; step++) {
    await scrollTo(store, tableRows(get(store)).length - 40);
  }
  state = get(store);
  assert.equal(state.results.hasAfter, false);
  assert.equal(ids(state).at(-1), idOf(1));
});

test("new-match counts wait for traffic to pause, but no longer than the max wait", async (t) => {
  const api = fakeApi({ traffic: pairs(50) });
  const store = createLedgerStore(api);
  await store.populate();
  await scrollTo(store, 10);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const counted = () => countCalls(api).filter((req) => req.After).length;

  let n = 50;
  const arrive = () => {
    n += 1;
    api.capture(pair(n));
    store.onRequest(pair(n));
    store.flush();
  };
  // Each new pair restarts the wait.
  arrive();
  t.mock.timers.tick(NEW_MATCHES_DELAY_MS - 100);
  arrive();
  t.mock.timers.tick(NEW_MATCHES_DELAY_MS - 100);
  await store.settled();
  assert.equal(counted(), 0, "still waiting for traffic to pause");
  t.mock.timers.tick(100);
  await store.settled();
  assert.equal(counted(), 1);

  // Steady traffic is still counted once the max wait runs out.
  for (let elapsed = 0; elapsed < NEW_MATCHES_MAX_WAIT_MS; elapsed += NEW_MATCHES_DELAY_MS / 2) {
    arrive();
    t.mock.timers.tick(NEW_MATCHES_DELAY_MS / 2);
  }
  await store.settled();
  assert.equal(counted(), 2);
});

test("the store says once the project's exclusion has loaded", async () => {
  const api = fakeApi({ traffic: pairs(1), exclusion: ["image/*"] });
  let release;
  const read = api.getExclusion;
  api.getExclusion = () => new Promise((resolve) => (release = () => resolve(read())));
  const store = createLedgerStore(api);
  const loading = store.populate();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(get(store).exclusionLoaded, false);
  release();
  await loading;
  assert.equal(get(store).exclusionLoaded, true);
  assert.deepEqual(get(store).exclusion, ["image/*"]);
  store.clear();
  assert.equal(get(store).exclusionLoaded, false);
});

test("query results count the pairs the exclusion hides too", async () => {
  const api = fakeApi({
    traffic: [pair(1), pair(2, { ContentType: "image/png" }), pair(3), pair(4, { ContentType: "image/png" })],
    exclusion: ["image/png"],
    queries: { early: (p) => p.ID <= idOf(2) },
  });
  const store = createLedgerStore(api);
  await store.populate();
  await store.runQuery("early");
  assert.equal(hiddenByTypeCount(get(store)), 1);
  const asOf = get(store).results.asOf;
  assert.ok(countCalls(api).some((req) => req.Query === "early" && req.IgnoreExclusion && req.AsOf === asOf));
});

test("a metadata patch reaches a pair a jump opened outside the loaded rows", async () => {
  const store = createLedgerStore(fakeApi({ traffic: pairs(1000) }));
  await store.populate();
  await store.sortBy("host");
  const { pair: outside } = await store.goToNumber(201);
  store.patchMetadata(outside.ID, { has_note: 1 });
  assert.equal(focusedPair(get(store)).Metadata.has_note, 1);
});

test("saving a note writes it through the api and marks whether the pair has one", async () => {
  const api = fakeApi({ traffic: pairs(2) });
  const saved = [];
  api.updateNote = async (id, text) => saved.push([id, text]);
  const store = createLedgerStore(api);
  await store.populate();

  await store.saveNote(idOf(1), "token leaks here");
  assert.deepEqual(saved, [[idOf(1), "token leaks here"]]);
  assert.equal(store.findShownPair(idOf(1)).Metadata.has_note, 1);

  await store.saveNote(idOf(1), "");
  assert.equal(store.findShownPair(idOf(1)).Metadata.has_note, 0, "an empty note is no note");
});

test("a failed note save leaves the pair's note mark as it was and rejects", async () => {
  const api = fakeApi({ traffic: pairs(1) });
  api.updateNote = async () => {
    throw new Error("disk full");
  };
  const store = createLedgerStore(api);
  await store.populate();
  await assert.rejects(store.saveNote(idOf(1), "x"), /disk full/);
  assert.equal(store.findShownPair(idOf(1)).Metadata?.has_note, undefined);
});
