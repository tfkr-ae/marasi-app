// The Armory's run traffic view: a run's pairs read a page at a time,
// sorted by a column, with the pairs a live run sends joining or waiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { armoryMenuFor, runArmoryAction } from "../lib/armory/rowMenu.js";
import {
  RUN_TRAFFIC_PAGE_SIZE,
  isColumnSortable,
  runCanStep,
  createRunTrafficView,
  openRunPair,
  runTrafficNewLabel,
  runRowMenuTarget,
  groupSelection,
  isPairSelected,
  runGroupMenuTarget,
  runSelectionLabel,
  runSelectionSpec,
  runTrafficGroups,
  runTrafficRows,
  sortedColumn,
} from "./createArmoryRunTraffic.js";

const RUN = "run-1";

// Pair ids sort in capture order, as Marasi's UUIDv7 ids do.
const id = (n) => `p${String(n).padStart(4, "0")}`;

function pair(n, { status = 200, length = 100, run = RUN } = {}) {
  return {
    ID: id(n),
    Number: n,
    Method: "GET",
    Host: "api.acme.test",
    Path: `/${n}`,
    StatusCode: status,
    Length: length,
    Metadata: { armory_run_id: run },
  };
}

// The fields a fake Marasi sorts by; a pending pair (no status) sorts last
// both ways, as Marasi's does.
const KEYS = {
  requested_at: (p) => p.Number,
  status_code: (p) => p.StatusCode || null,
  length: (p) => (p.StatusCode ? p.Length : null),
};

/**
 * A fake QueryArmoryRunTraffic over `pairs`: it sorts by the request's
 * OrderBy, pages with an index cursor and keeps to AsOf. `calls` records
 * every request.
 */
function fakeApi(pairs) {
  const calls = [];
  const api = {
    calls,
    pairs,
    queryRunTraffic: async (runId, req) => {
      calls.push({ runId, ...req });
      const [field, dir] = (req.OrderBy || "requested_at").split(" ");
      const key = KEYS[field];
      const asOf = req.AsOf || null;
      const matching = api.pairs
        .filter((p) => p.Metadata.armory_run_id === runId)
        .filter(narrowedBy(req.Query))
        .filter((p) => !asOf || p.ID <= asOf)
        .sort((a, b) => {
          const [ka, kb] = [key(a), key(b)];
          if (ka === null || kb === null) {
            if (ka === kb) return a.Number - b.Number;
            return ka === null ? 1 : -1;
          }
          const order = ka === kb ? a.Number - b.Number : ka - kb;
          return dir === "desc" && ka !== kb ? -order : order;
        });
      const start = req.Cursor ? Number(req.Cursor) : 0;
      const limit = req.Limit || 500;
      const items = matching.slice(start, start + limit).map((p) => ({ ...p }));
      const end = start + items.length;
      const newest = matching.reduce((max, p) => (p.ID > max ? p.ID : max), "");
      return {
        Items: items,
        NextCursor: end < matching.length ? String(end) : null,
        PrevCursor: start > 0 ? String(start) : null,
        AsOf: asOf ?? newest,
      };
    },
  };
  api.countRunTraffic = async (runId, field, asOf = "") => {
    api.calls.push({ runId, count: field, asOf });
    const bound = asOf || api.pairs.reduce((max, p) => (p.ID > max ? p.ID : max), "");
    const counts = new Map();
    for (const p of api.pairs.filter((p) => p.Metadata.armory_run_id === runId && p.ID <= bound)) {
      const value = KEYS[field](p) == null ? "" : String(KEYS[field](p));
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    // Most common first, as Marasi orders them; the store re-sorts.
    const Counts = [...counts].map(([Value, Count]) => ({ Value, Count })).sort((a, b) => b.Count - a.Count);
    return { Counts, AsOf: bound };
  };
  return api;
}

// The narrowings the store sends for a group: `field = n`, or
// `NOT field >= 0` for the pairs with no value.
function narrowedBy(query) {
  if (!query) return () => true;
  const pending = /^NOT (\w+) >= 0$/.exec(query);
  if (pending) return (p) => KEYS[pending[1]](p) == null;
  const equals = /^(\w+) = (\d+)$/.exec(query);
  if (equals) return (p) => KEYS[equals[1]](p) === Number(equals[2]);
  throw new Error(`the fake can't narrow by ${query}`);
}

const numbers = (view) => runTrafficRows(get(view)).map((row) => row.Number);

async function opened(pairs) {
  const api = fakeApi(pairs);
  const view = createRunTrafficView(api);
  await view.open(RUN);
  return { api, view };
}

test("opening a run reads its first page in # order, oldest first", async () => {
  const { api, view } = await opened([pair(1), pair(2), pair(3, { run: "other" }), pair(4)]);
  assert.deepEqual(numbers(view), [1, 2, 4]);
  assert.equal(api.calls[0].OrderBy, "requested_at");
  assert.equal(api.calls[0].Limit, RUN_TRAFFIC_PAGE_SIZE);
  assert.equal(get(view).list.hasMore, false);
  assert.equal(sortedColumn(get(view)), null);
});

const many = (n, opts) => Array.from({ length: n }, (_, i) => pair(i + 1, opts));

test("loading more reads the next page after the last row, under the first page's as_of", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 5));
  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE);
  assert.equal(get(view).list.hasMore, true);

  await view.loadMore();

  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE + 5);
  assert.equal(numbers(view).at(-1), RUN_TRAFFIC_PAGE_SIZE + 5);
  assert.equal(get(view).list.hasMore, false);
  assert.equal(api.calls[1].Cursor, String(RUN_TRAFFIC_PAGE_SIZE));
  assert.equal(api.calls[1].AsOf, id(RUN_TRAFFIC_PAGE_SIZE + 5));
});

test("loading more at the end of the run reads nothing", async () => {
  const { api, view } = await opened(many(3));
  await view.loadMore();
  assert.equal(api.calls.length, 1);
});

test("loading more twice at once reads the next page once", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE * 3));
  await Promise.all([view.loadMore(), view.loadMore()]);
  assert.equal(api.calls.length, 2);
  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE * 2);
});

// Four pairs: lengths 30, 10, pending, 20; statuses 404, 200, pending, 500.
const mixed = () => [
  pair(1, { status: 404, length: 30 }),
  pair(2, { status: 200, length: 10 }),
  pair(3, { status: 0 }),
  pair(4, { status: 500, length: 20 }),
];

test("a column header sorts ascending, then descending, then back to # order", async () => {
  const { api, view } = await opened(mixed());

  await view.sortBy("size");
  assert.deepEqual(numbers(view), [2, 4, 1, 3]);
  assert.deepEqual(get(view).sort, { column: "size", desc: false });
  assert.equal(api.calls.at(-1).OrderBy, "length");

  await view.sortBy("size");
  assert.deepEqual(numbers(view), [1, 4, 2, 3]);
  assert.deepEqual(get(view).sort, { column: "size", desc: true });
  assert.equal(api.calls.at(-1).OrderBy, "length desc");

  await view.sortBy("size");
  assert.deepEqual(numbers(view), [1, 2, 3, 4]);
  assert.equal(sortedColumn(get(view)), null);
  assert.equal(api.calls.at(-1).OrderBy, "requested_at");
});

test("each column sorts by its own field, a pending pair last", async () => {
  const { view } = await opened(mixed());
  await view.sortBy("status");
  assert.deepEqual(numbers(view), [2, 1, 4, 3]);
  await view.sortBy("time");
  assert.equal(sortedColumn(get(view)), "time");
  assert.deepEqual(numbers(view), [1, 2, 3, 4]);
  await view.sortBy("time");
  assert.deepEqual(numbers(view), [4, 3, 2, 1]);
  await view.sortBy("number");
  assert.deepEqual(get(view).sort, { column: "number", desc: false });
});

test("a sort reads from the top under a new as_of", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 5));
  await view.loadMore();
  await view.sortBy("status");
  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE);
  assert.equal(api.calls.at(-1).Cursor ?? "", "");
  assert.equal(api.calls.at(-1).AsOf ?? "", "");
});

test("the sort stays for the next run opened", async () => {
  const api = fakeApi([...mixed(), pair(9, { run: "run-2", length: 5 }), pair(8, { run: "run-2", length: 50 })]);
  const view = createRunTrafficView(api);
  await view.open(RUN);
  await view.sortBy("size");
  await view.sortBy("size");
  await view.open("run-2");
  assert.deepEqual(get(view).sort, { column: "size", desc: true });
  assert.deepEqual(numbers(view), [8, 9]);
});

// A pair the run sends: its request event, then its response event.
function sends(api, view, n, { status = 200, length = 100, run = RUN, respond = true } = {}) {
  const sent = pair(n, { status, length, run });
  if (!api.pairs.some((p) => p.ID === sent.ID)) api.pairs.push(sent);
  const { StatusCode, Length, ...request } = sent;
  view.onRequest({ ...request, Raw: "GET / HTTP/1.1" });
  if (respond) view.onResponse({ ID: sent.ID, StatusCode, Length, Raw: "HTTP/1.1 200 OK" });
}

test("in # order a pair the run sends joins at the end, without its bodies", async () => {
  const { api, view } = await opened(many(2));
  sends(api, view, 3, { status: 403, length: 7 });
  sends(api, view, 4, { run: "other" });
  view.flush();
  assert.deepEqual(numbers(view), [1, 2, 3]);
  const joined = runTrafficRows(get(view)).at(-1);
  assert.equal(joined.StatusCode, 403);
  assert.equal("Raw" in joined, false);
  assert.equal(runTrafficNewLabel(get(view)), "");
});

test("a pair's response fills its row in place", async () => {
  const { api, view } = await opened([pair(1), pair(2, { status: 0 })]);
  await view.sortBy("status");
  view.onResponse({ ID: id(2), StatusCode: 101, Length: 4 });
  view.flush();
  assert.deepEqual(numbers(view), [1, 2]);
  assert.equal(runTrafficRows(get(view))[1].StatusCode, 101);
  assert.equal(api.calls.length, 2);
});

test("in # order a pair sent past unread pages joins when the last page is read", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 1));
  sends(api, view, 500);
  view.flush();
  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE);
  await view.loadMore();
  assert.deepEqual(numbers(view).slice(-2), [RUN_TRAFFIC_PAGE_SIZE + 1, 500]);
});

test("while sorted, pairs the run sends wait behind n new until shown", async () => {
  const { api, view } = await opened(mixed());
  await view.sortBy("size");
  sends(api, view, 5, { length: 1 });
  sends(api, view, 6, { length: 15 });
  view.flush();
  sends(api, view, 6, { length: 15 }); // the same pair's event again
  view.flush();

  assert.deepEqual(numbers(view), [2, 4, 1, 3]);
  assert.equal(runTrafficNewLabel(get(view)), "2 new");

  await view.showNew();

  assert.deepEqual(numbers(view), [5, 2, 6, 4, 1, 3]);
  assert.equal(runTrafficNewLabel(get(view)), "");
  assert.equal(api.calls.at(-1).AsOf ?? "", "");
});

test("showing new pairs keeps as many rows as were read", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE * 2, { length: 50 }));
  await view.sortBy("size");
  await view.loadMore();
  sends(api, view, 9999, { length: 1 });
  view.flush();
  await view.showNew();
  assert.equal(numbers(view).length, RUN_TRAFFIC_PAGE_SIZE * 2);
  assert.equal(numbers(view)[0], 9999);
});

test("pairs sent while a read is under way wait for it", async () => {
  const api = fakeApi(mixed());
  const view = createRunTrafficView(api);
  const opening = view.open(RUN);
  sends(api, view, 5);
  view.flush();
  await opening;
  view.flush();
  assert.deepEqual(numbers(view), [1, 2, 3, 4, 5]);
});

const openNumber = (view) => openRunPair(get(view))?.Number ?? null;

test("Previous and Next request step through the rows in their sorted order", async () => {
  const { view } = await opened(mixed());
  await view.sortBy("size");
  view.openPair(id(4));
  assert.equal(openNumber(view), 4);

  assert.equal((await view.step(1)).Number, 1);
  assert.equal(openNumber(view), 1);
  assert.equal((await view.step(-1)).Number, 4);
  assert.equal(openNumber(view), 4);
});

test("stepping stops at the run's first and last pairs", async () => {
  const { view } = await opened(mixed());
  view.openPair(id(1));
  assert.equal(await view.step(-1), null);
  assert.equal(openNumber(view), 1);
  view.openPair(id(4));
  assert.equal(await view.step(1), null);
  assert.equal(openNumber(view), 4);
});

test("stepping past the last row read reads the next page", async () => {
  const { view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 1));
  view.openPair(id(RUN_TRAFFIC_PAGE_SIZE));
  assert.equal((await view.step(1)).Number, RUN_TRAFFIC_PAGE_SIZE + 1);
});

test("the open pair stays open through a sort and closes when another run opens", async () => {
  const api = fakeApi([...mixed(), pair(9, { run: "run-2" })]);
  const view = createRunTrafficView(api);
  await view.open(RUN);
  view.openPair(id(2));
  await view.sortBy("status");
  assert.equal(openNumber(view), 2);
  await view.open("run-2");
  assert.equal(get(view).openId, null);
});

test("opening the run already shown keeps its rows, place and open pair", async () => {
  const { api, view } = await opened(mixed());
  view.openPair(id(3));
  view.setScrollTop(120);
  await view.open(RUN);
  assert.equal(api.calls.length, 1);
  assert.equal(openNumber(view), 3);
  assert.equal(get(view).scrollTop, 120);
});

test("clearing forgets the run, its rows and the sort", async () => {
  const { api, view } = await opened(mixed());
  await view.sortBy("size");
  view.clear();
  assert.equal(get(view).runId, null);
  assert.deepEqual(numbers(view), []);
  assert.equal(sortedColumn(get(view)), null);
  sends(api, view, 5);
  view.flush();
  assert.deepEqual(numbers(view), []);
});

test("the open pair stays open when a sort's first page doesn't reach it, and takes its response", async () => {
  // Pair 999 is pending, so it sorts after every pair with a length.
  const rest = Array.from({ length: RUN_TRAFFIC_PAGE_SIZE }, (_, i) => pair(i + 1000, { length: 10 }));
  const { api, view } = await opened([pair(999, { status: 0 }), ...rest]);
  view.openPair(id(999));
  await view.sortBy("size");
  assert.equal(runTrafficRows(get(view)).some((row) => row.Number === 999), false);
  assert.equal(openNumber(view), 999);
  view.onResponse({ ID: id(999), StatusCode: 302, Length: 0 });
  view.flush();
  assert.equal(openRunPair(get(view)).StatusCode, 302);
  assert.equal(api.calls.length, 2);
});

test("a sort keeps the rows shown until the sorted ones are read", async () => {
  const api = fakeApi(mixed());
  const view = createRunTrafficView(api);
  await view.open(RUN);
  const sorting = view.sortBy("size");
  assert.deepEqual(numbers(view), [1, 2, 3, 4]);
  await sorting;
  assert.deepEqual(numbers(view), [2, 4, 1, 3]);
});

test("while sorted, pairs sent to an empty table show at once, since no row can move", async () => {
  const { api, view } = await opened([]);
  await view.sortBy("size");
  sends(api, view, 1, { length: 40 });
  sends(api, view, 2, { length: 20 });
  view.flush();
  await view.settled();
  assert.deepEqual(numbers(view), [2, 1]);
  assert.equal(runTrafficNewLabel(get(view)), "");
});

test("a pair sent to an empty sorted table that its read misses still counts as new", async () => {
  const { api, view } = await opened([]);
  await view.sortBy("size");
  sends(api, view, 1, { length: 40 });
  sends(api, view, 2, { length: 20 });
  // Pair 2's event came before Marasi could read it.
  api.pairs.splice(api.pairs.findIndex((p) => p.Number === 2), 1);
  view.flush();
  await view.settled();
  view.flush();
  assert.deepEqual(numbers(view), [1]);
  assert.equal(runTrafficNewLabel(get(view)), "1 new");
});

// The Selection, as in the Ledger: ⌘-click toggles a pair, ⇧-click extends
// from the anchor over the rows shown, a plain click opens the pair and
// empties it.

const selected = (view) => [...get(view).selection.ids];

test("⌘-click adds a pair to the Selection and a second ⌘-click drops it, leaving the drawer as it was", async () => {
  const { view } = await opened(many(4));
  view.clickPair(id(2), { toggle: true });
  view.clickPair(id(4), { toggle: true });
  assert.deepEqual(selected(view), [id(2), id(4)]);
  assert.equal(openRunPair(get(view)), null);

  view.clickPair(id(2), { toggle: true });
  assert.deepEqual(selected(view), [id(4)]);
});

test("a plain click opens the pair in the drawer and empties the Selection", async () => {
  const { view } = await opened(many(4));
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(3), { toggle: true });
  view.clickPair(id(2));
  assert.deepEqual(selected(view), []);
  assert.equal(openRunPair(get(view)).Number, 2);
});

test("⇧-click selects from the anchor to the pair over the rows in their sorted order", async () => {
  const lengths = [40, 10, 30, 20, 50];
  const { view } = await opened(lengths.map((length, i) => pair(i + 1, { length })));
  await view.sortBy("size");
  // By length: #2 (10), #4 (20), #3 (30), #1 (40), #5 (50).
  view.clickPair(id(4), { toggle: true });
  view.clickPair(id(1), { range: true });
  assert.deepEqual(selected(view), [id(4), id(3), id(1)]);

  // The anchor stays, so a second ⇧-click replaces the range.
  view.clickPair(id(2), { range: true });
  assert.deepEqual(selected(view), [id(2), id(4)]);
});

test("⇧-click extends from the pair a plain click opened", async () => {
  const { view } = await opened(many(5));
  view.clickPair(id(2));
  view.clickPair(id(4), { range: true });
  assert.deepEqual(selected(view), [id(2), id(3), id(4)]);
  assert.equal(openRunPair(get(view)).Number, 2);
});

test("⌘⇧-click adds the range to the Selection", async () => {
  const { view } = await opened(many(6));
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(4), { toggle: true });
  view.clickPair(id(6), { toggle: true, range: true });
  assert.deepEqual(selected(view), [id(1), id(4), id(5), id(6)]);
});

test("⇧-click with no anchor selects just that pair", async () => {
  const { view } = await opened(many(3));
  view.clickPair(id(2), { range: true });
  assert.deepEqual(selected(view), [id(2)]);
});

test("the top bar counts the Selection, and Clear empties it", async () => {
  const { view } = await opened(many(1200));
  assert.equal(runSelectionLabel(get(view)), "");
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(RUN_TRAFFIC_PAGE_SIZE), { range: true });
  assert.equal(runSelectionLabel(get(view)), "200 selected");
  view.clearSelection();
  assert.deepEqual(selected(view), []);
  assert.equal(runSelectionLabel(get(view)), "");
});

test("another run starts with no Selection", async () => {
  const { api, view } = await opened([...many(3), pair(4, { run: "run-2" })]);
  view.clickPair(id(2), { toggle: true });
  await view.open("run-2");
  assert.deepEqual(selected(view), []);
  assert.ok(api.calls.length >= 2);
});

// A fake Ledger store's bulk methods, recording what each is sent.
function fakeLedger() {
  const sent = [];
  return {
    sent,
    pairNumber: () => null,
    sendToNewLaunchpad: async (selection, count, { numberOf }) => {
      sent.push({ method: "sendToNewLaunchpad", selection, count, numbers: selection.ids?.map(numberOf) });
      return { launchpadId: "L9" };
    },
    addToLaunchpad: async (selection, id) => (sent.push({ method: "addToLaunchpad", selection, id }), selection.ids?.length ?? 0),
    linkToFinding: async (selection, id) => (sent.push({ method: "linkToFinding", selection, id }), selection.ids?.length ?? 0),
    unlinkFromFinding: async (selection, id) => (sent.push({ method: "unlinkFromFinding", selection, id }), selection.ids?.length ?? 0),
    linkToTestCase: async (selection, id) => (sent.push({ method: "linkToTestCase", selection, id }), selection.ids?.length ?? 0),
    unlinkFromTestCase: async (selection, id) => (sent.push({ method: "unlinkFromTestCase", selection, id }), selection.ids?.length ?? 0),
  };
}

test("right-clicking a selected pair targets the whole Selection, in the table's order", async () => {
  const { view } = await opened(many(5));
  view.clickPair(id(4), { toggle: true });
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(3), { toggle: true });
  const target = runRowMenuTarget(get(view), id(1));
  assert.deepEqual(target.pairs.map((p) => p.Number), [1, 3, 4]);
  assert.deepEqual(target.selection, { ids: [id(1), id(3), id(4)] });
  assert.equal(target.count, 3);
  assert.equal(armoryMenuFor(target).find((it) => it.id === "launchpad").sub[0].label, "New launchpad with 3 entries");
});

test("right-clicking an unselected pair targets that pair alone and keeps the Selection", async () => {
  const { view } = await opened(many(5));
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(2), { toggle: true });
  const target = runRowMenuTarget(get(view), id(5));
  assert.deepEqual(target.pairs.map((p) => p.Number), [5]);
  assert.deepEqual(target.selection, { ids: [id(5)] });
  assert.equal(target.count, 1);
  assert.deepEqual(selected(view), [id(1), id(2)]);
});

test("each action on a Selection sends every selected pair", async () => {
  const { view } = await opened(many(5));
  view.clickPair(id(2), { toggle: true });
  view.clickPair(id(4), { range: true });
  const target = runRowMenuTarget(get(view), id(3));
  const ledger = fakeLedger();
  const opened_ = [];
  const newRecord = (kind, options) => opened_.push({ kind, ...options });
  const all = { ids: [id(2), id(3), id(4)] };

  await runArmoryAction({ type: "new-launchpad" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "add-to-launchpad", id: "L1" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "link-finding", id: "F1" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "unlink-finding", id: "F1" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "link-test-case", id: "T1" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "unlink-test-case", id: "T1" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "new-finding" }, target, { ledger, newRecord });
  await runArmoryAction({ type: "new-test-case" }, target, { ledger, newRecord });

  assert.deepEqual(ledger.sent[0], { method: "sendToNewLaunchpad", selection: all, count: 3, numbers: [2, 3, 4] });
  assert.deepEqual(
    ledger.sent.slice(1).map(({ method, selection }) => [method, selection]),
    ["addToLaunchpad", "linkToFinding", "unlinkFromFinding", "linkToTestCase", "unlinkFromTestCase"].map((m) => [m, all]),
  );
  assert.deepEqual(opened_, [
    { kind: "finding", requestIds: all.ids },
    { kind: "testCase", requestIds: all.ids },
  ]);
});

test("the Selection keeps its pairs through a sort whose first page doesn't reach them", async () => {
  // Length grows with #, so sorting by Length descending puts #1 and #2 last.
  const { view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 50).map((p) => ({ ...p, Length: p.Number })));
  view.clickPair(id(1), { toggle: true });
  view.clickPair(id(2), { toggle: true });
  await view.sortBy("size");
  await view.sortBy("size");
  assert.equal(numbers(view)[0], RUN_TRAFFIC_PAGE_SIZE + 50);
  assert.equal(runSelectionLabel(get(view)), "2 selected");
  const target = runRowMenuTarget(get(view), id(1));
  assert.deepEqual(target.selection, { ids: [id(1), id(2)] });
  assert.deepEqual(target.pairs.map((p) => p.Number).sort(), [1, 2]);
});

// Grouping: one section per status code or length, each a narrowing of the
// run read a page at a time.

// 404 x5 at 1245 B, 403 x2 at 1245 B, a 500 at 88 B, a 200 at 1251 B, and a
// pair with no response yet.
function fuzzRun() {
  return [
    pair(1, { status: 404, length: 1245 }),
    pair(2, { status: 404, length: 1245 }),
    pair(3, { status: 403, length: 1245 }),
    pair(4, { status: 500, length: 88 }),
    pair(5, { status: 404, length: 1245 }),
    pair(6, { status: 0 }),
    pair(7, { status: 404, length: 1245 }),
    pair(8, { status: 200, length: 1251 }),
    pair(9, { status: 403, length: 1245 }),
    pair(10, { status: 404, length: 1245 }),
  ];
}

const groups = (view) => runTrafficGroups(get(view)).map((g) => `${g.value}=${g.count}`);

test("grouped by status, the run's groups are listed rarest first, ties by value, pending last among them", async () => {
  const { api, view } = await opened(fuzzRun());

  await view.groupBy("status");

  assert.deepEqual(groups(view), ["200=1", "500=1", "=1", "403=2", "404=5"]);
  assert.equal(api.calls.find((c) => c.count)?.count, "status_code");
  const byValue = Object.fromEntries(runTrafficGroups(get(view)).map((g) => [g.value, g]));
  assert.equal(byValue["403"].narrowing, "status_code = 403");
  assert.equal(byValue[""].narrowing, "NOT status_code >= 0");
  assert.equal(byValue["403"].query, `metadata.armory_run_id = "${RUN}" AND (status_code = 403)`);
  assert.equal(byValue["404"].share, 50);
});

const groupOf = (view, value) => runTrafficGroups(get(view)).find((g) => g.value === value);

test("a group holding more than 40 % of the run starts folded, and the open groups read their rows", async () => {
  const { api, view } = await opened(fuzzRun());
  await view.groupBy("status");

  assert.equal(groupOf(view, "404").folded, true);
  assert.equal(groupOf(view, "403").folded, false);
  // The table shows the open groups' rows, group by group.
  assert.deepEqual(numbers(view), [8, 4, 6, 3, 9]);
  assert.ok(!api.calls.some((c) => c.Query === "status_code = 404"));
});

test("clicking a group header folds it, and unfolding a group reads its rows", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");

  await view.toggleGroup("403");
  assert.deepEqual(numbers(view), [8, 4, 6]);
  await view.toggleGroup("404");
  assert.deepEqual(numbers(view), [8, 4, 6, 1, 2, 5, 7, 10]);
});

test("Collapse all folds every group and Expand all opens them all", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");

  await view.collapseAll();
  assert.deepEqual(numbers(view), []);
  assert.ok(runTrafficGroups(get(view)).every((g) => g.folded));

  await view.expandAll();
  assert.deepEqual(numbers(view), [8, 4, 6, 3, 9, 1, 2, 5, 7, 10]);
});

test("folds reset when the grouping changes", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.toggleGroup("200");

  await view.groupBy("length");

  // 1245 B holds 7 of 10 pairs.
  assert.deepEqual(groups(view), ["88=1", "1251=1", "=1", "1245=7"]);
  assert.deepEqual(
    runTrafficGroups(get(view)).map((g) => g.folded),
    [false, false, false, true],
  );
  assert.equal(groupOf(view, "1245").narrowing, "length = 1245");
});

test("None goes back to the one list in # order", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.groupBy(null);
  assert.equal(runTrafficGroups(get(view)), null);
  assert.deepEqual(numbers(view), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("a group reads more of its rows a page at a time", async () => {
  const big = many(RUN_TRAFFIC_PAGE_SIZE + 3, { status: 403 });
  const { api, view } = await opened([...big, pair(9000, { status: 500 })]);
  await view.groupBy("status");
  // 403 holds nearly all the run, so it starts folded.
  await view.toggleGroup("403");
  assert.equal(groupOf(view, "403").list.rows.length, RUN_TRAFFIC_PAGE_SIZE);

  await view.loadMore("403");

  assert.equal(groupOf(view, "403").list.rows.length, RUN_TRAFFIC_PAGE_SIZE + 3);
  assert.equal(api.calls.at(-1).Query, "status_code = 403");
  assert.equal(api.calls.at(-1).Cursor, String(RUN_TRAFFIC_PAGE_SIZE));
});

test("grouped by status, Status doesn't sort and Length sorts within each group", async () => {
  const run = [
    pair(1, { status: 404, length: 30 }),
    pair(2, { status: 404, length: 10 }),
    pair(3, { status: 200, length: 5 }),
    pair(4, { status: 404, length: 20 }),
    pair(5, { status: 200, length: 1 }),
    pair(6, { status: 500, length: 1 }),
  ];
  const { view } = await opened(run);
  await view.groupBy("status");
  await view.expandAll();

  await view.sortBy("status");
  assert.equal(sortedColumn(get(view)), null);
  assert.equal(isColumnSortable(get(view), "status"), false);

  await view.sortBy("size");
  assert.deepEqual(groups(view), ["500=1", "200=2", "404=3"]);
  assert.deepEqual(numbers(view), [6, 5, 3, 2, 4, 1]);
  await view.sortBy("size");
  assert.deepEqual(numbers(view), [6, 3, 5, 1, 4, 2]);
});

test("grouped by length, a Length sort orders the groups by length, pending last", async () => {
  const run = [
    pair(1, { length: 30 }),
    pair(2, { length: 10 }),
    pair(3, { length: 30 }),
    pair(4, { status: 0 }),
    pair(5, { length: 20 }),
  ];
  const { api, view } = await opened(run);
  await view.groupBy("length");
  assert.equal(isColumnSortable(get(view), "size"), true);

  await view.sortBy("size");
  assert.deepEqual(groups(view), ["10=1", "20=1", "30=2", "=1"]);
  // Within a length group the rows stay in # order.
  assert.equal(api.calls.at(-1).OrderBy, "requested_at");

  await view.sortBy("size");
  assert.deepEqual(groups(view), ["30=2", "20=1", "10=1", "=1"]);
  await view.sortBy("size");
  assert.deepEqual(groups(view), ["10=1", "20=1", "=1", "30=2"]);
});

test("grouping by the sorted column's field puts the sort back to # order, and other sorts stay", async () => {
  const { view } = await opened(fuzzRun());
  await view.sortBy("status");
  await view.groupBy("status");
  assert.equal(sortedColumn(get(view)), null);

  await view.sortBy("size");
  await view.groupBy("length");
  assert.equal(sortedColumn(get(view)), null);

  await view.sortBy("time");
  await view.groupBy("status");
  assert.equal(sortedColumn(get(view)), "time");
});

test("the grouping stays for the next run opened, with that run's folds", async () => {
  const api = fakeApi([...fuzzRun(), pair(20, { run: "run-2", status: 403 }), pair(21, { run: "run-2", status: 200 })]);
  const view = createRunTrafficView(api);
  await view.open(RUN);
  await view.groupBy("status");
  await view.open("run-2");
  assert.equal(get(view).groupBy, "status");
  assert.deepEqual(groups(view), ["200=1", "403=1"]);
  assert.ok(runTrafficGroups(get(view)).every((g) => g.folded));
});

test("a live run's counts follow its pairs while the open groups' rows stay put", async () => {
  const { api, view } = await opened(fuzzRun());
  await view.groupBy("status");
  const before = numbers(view);

  sends(api, view, 11, { status: 403 });
  sends(api, view, 12, { status: 418 });
  view.flush();
  await view.settled();

  assert.deepEqual(numbers(view), before);
  assert.equal(groupOf(view, "403").count, 3);
  // A group the run adds joins the end until the view reads again.
  assert.deepEqual(groups(view), ["200=1", "500=1", "=1", "403=3", "404=5", "418=1"]);
  assert.equal(groupOf(view, "404").share, (5 / 12) * 100);
  assert.equal(runTrafficNewLabel(get(view)), "2 new");

  await view.showNew();

  assert.deepEqual(groups(view), ["200=1", "418=1", "500=1", "=1", "403=3", "404=5"]);
  assert.deepEqual(numbers(view), [8, 12, 4, 6, 3, 9, 11]);
  assert.equal(runTrafficNewLabel(get(view)), "");
});

test("a pending pair's response counts it in its status group and fills its row in place", async () => {
  const { api, view } = await opened(fuzzRun());
  await view.groupBy("status");
  const pending = api.pairs.find((p) => p.Number === 6);
  pending.StatusCode = 500;
  pending.Length = 12;
  view.onResponse({ ID: pending.ID, StatusCode: 500, Length: 12 });
  view.flush();
  await view.settled();

  assert.equal(groupOf(view, "500").count, 2);
  // The emptied pending group stays while it shows its row.
  assert.equal(groupOf(view, "").count, 0);
  assert.equal(runTrafficRows(get(view)).find((row) => row.Number === 6).StatusCode, 500);
});

test("a grouped view with no rows yet reads the first pairs a run sends in place", async () => {
  const { api, view } = await opened([]);
  await view.groupBy("status");
  assert.deepEqual(runTrafficGroups(get(view)), []);

  sends(api, view, 1, { status: 404 });
  view.flush();
  await view.settled();

  assert.deepEqual(groups(view), ["404=1"]);
  assert.deepEqual(numbers(view), [1]);
});

test("⇧-click selects over the rows shown in the open groups, skipping folded ones", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  // Shown: 200 [8], 500 [4], pending [6], 403 [3, 9]; 404 folded.
  view.clickPair(id(8));
  view.clickPair(id(3), { range: true });
  assert.deepEqual([...get(view).selection.ids], [id(8), id(4), id(6), id(3)]);
});

test("a pair in a group opens in the drawer, and right-clicking it targets it", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  view.openPair(id(9));
  assert.equal(openNumber(view), 9);
  assert.equal(runRowMenuTarget(get(view), id(3)).pairs[0].Number, 3);
});

// A whole group or the run: a Selection in Marasi's query shape.

// The pairs a fake Marasi applies `selection` to: its ids, or the pairs
// its query matches up to its as_of.
function pairsIn(api, selection) {
  if (selection.ids) return selection.ids;
  const match = /^metadata\.armory_run_id = "([^"]+)"(?: AND \((.+)\))?$/.exec(selection.query);
  if (!match) throw new Error(`the fake can't read ${selection.query}`);
  const [, run, narrowing] = match;
  const any = narrowing ? narrowing.split(" OR ").map(narrowedBy) : [() => true];
  return api.pairs
    .filter((p) => p.Metadata.armory_run_id === run && p.ID <= selection.as_of)
    .filter((p) => any.some((matches) => matches(p)))
    .map((p) => p.ID);
}

// A run of PAGE + 5 404s, folded as most of the run, and two 403s.
function bigRun() {
  return [...many(RUN_TRAFFIC_PAGE_SIZE + 5, { status: 404 }), pair(RUN_TRAFFIC_PAGE_SIZE + 6, { status: 403 }), pair(RUN_TRAFFIC_PAGE_SIZE + 7, { status: 403 })];
}

test("⌘-click on a group header selects every pair in the group, read or not, as its query under the count's as_of", async () => {
  const { api, view } = await opened(bigRun());
  await view.groupBy("status");
  assert.equal(groupOf(view, "404").folded, true);

  view.toggleGroupSelection("404");

  assert.equal(runSelectionLabel(get(view)), `${RUN_TRAFFIC_PAGE_SIZE + 5} selected`);
  await view.toggleGroup("404");
  const target = runRowMenuTarget(get(view), id(1));
  assert.deepEqual(target.selection, {
    query: 'metadata.armory_run_id = "run-1" AND (status_code = 404)',
    exclusion: [],
    as_of: id(RUN_TRAFFIC_PAGE_SIZE + 7),
  });
  assert.equal(target.count, RUN_TRAFFIC_PAGE_SIZE + 5);

  // A 404 the run sends later is not in the Selection.
  sends(api, view, RUN_TRAFFIC_PAGE_SIZE + 8, { status: 404 });
  view.flush();
  await view.settled();
  const ledger = fakeLedger();
  await runArmoryAction({ type: "new-launchpad" }, runRowMenuTarget(get(view), id(1)), { ledger });
  const [{ selection, count }] = ledger.sent;
  assert.equal(count, RUN_TRAFFIC_PAGE_SIZE + 5);
  assert.deepEqual(pairsIn(api, selection), many(RUN_TRAFFIC_PAGE_SIZE + 5).map((p) => p.ID));
});

test("adding a group to a whole-group Selection keeps its as_of, so pairs sent since stay out of every group", async () => {
  const { api, view } = await opened(bigRun());
  await view.groupBy("status");
  view.toggleGroupSelection("403");
  const asOf = id(RUN_TRAFFIC_PAGE_SIZE + 7);

  // A 403 and a 404 arrive, and the counts move on past the Selection's as_of.
  sends(api, view, RUN_TRAFFIC_PAGE_SIZE + 8, { status: 403 });
  sends(api, view, RUN_TRAFFIC_PAGE_SIZE + 9, { status: 404 });
  view.flush();
  await view.settled();

  await view.toggleGroupSelection("404");

  const target = runRowMenuTarget(get(view), id(RUN_TRAFFIC_PAGE_SIZE + 6));
  assert.equal(target.selection.as_of, asOf);
  assert.equal(target.count, RUN_TRAFFIC_PAGE_SIZE + 7);
  assert.equal(runSelectionLabel(get(view)), `${RUN_TRAFFIC_PAGE_SIZE + 7} selected`);
  assert.deepEqual(
    pairsIn(api, target.selection).sort(),
    [...many(RUN_TRAFFIC_PAGE_SIZE + 5), ...bigRun().slice(-2)].map((p) => p.ID).sort(),
  );

  // Dropping a group keeps the as_of too.
  await view.toggleGroupSelection("403");
  await view.toggleGroup("404");
  assert.equal(runRowMenuTarget(get(view), id(1)).selection.as_of, asOf);
  assert.equal(runSelectionLabel(get(view)), `${RUN_TRAFFIC_PAGE_SIZE + 5} selected`);
});

const headerStates = (view) =>
  runTrafficGroups(get(view)).map((g) => `${g.value}:${groupSelection(get(view), g) || "-"}`);

test("⌘-clicking more group headers selects them all, and ⌘-clicking a selected one drops it", async () => {
  const { api, view } = await opened(fuzzRun());
  await view.groupBy("status");

  view.toggleGroupSelection("403");
  view.toggleGroupSelection("500");

  assert.equal(runSelectionLabel(get(view)), "3 selected");
  assert.deepEqual(headerStates(view), ["200:-", "500:all", ":-", "403:all", "404:-"]);
  assert.deepEqual(
    pairsIn(api, runSelectionSpec(get(view))).sort(),
    [id(3), id(4), id(9)],
  );
  assert.equal(isPairSelected(get(view), id(9)), true);
  assert.equal(isPairSelected(get(view), id(8)), false);

  view.toggleGroupSelection("403");

  assert.equal(runSelectionLabel(get(view)), "1 selected");
  assert.deepEqual(headerStates(view), ["200:-", "500:all", ":-", "403:-", "404:-"]);
  view.toggleGroupSelection("500");
  assert.equal(runSelectionSpec(get(view)), null);
});

test("a group header says some selected when the Selection holds some of its pairs, and all when it holds every one", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  view.clickPair(id(3), { toggle: true });
  assert.deepEqual(headerStates(view), ["200:-", "500:-", ":-", "403:some", "404:-"]);
  view.clickPair(id(9), { toggle: true });
  assert.deepEqual(headerStates(view), ["200:-", "500:-", ":-", "403:all", "404:-"]);
});

test("⌘-clicking a group header while pairs are picked one by one selects the group instead", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  view.clickPair(id(8), { toggle: true });
  view.toggleGroupSelection("403");
  assert.deepEqual([...pairsIn({ pairs: fuzzRun() }, runSelectionSpec(get(view)))], [id(3), id(9)]);
});

test("⌘-clicking a pair while a group is selected goes on from the group's rows read", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  view.toggleGroupSelection("403");
  view.clickPair(id(8), { toggle: true });
  assert.deepEqual(runSelectionSpec(get(view)), { ids: [id(3), id(9), id(8)] });
  view.clickPair(id(3), { toggle: true });
  assert.deepEqual(runSelectionSpec(get(view)), { ids: [id(9), id(8)] });
});

test("a plain click on a pair empties a group Selection", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  view.toggleGroupSelection("403");
  view.clickPair(id(8));
  assert.equal(runSelectionSpec(get(view)), null);
  assert.equal(runSelectionLabel(get(view)), "");
  assert.equal(openNumber(view), 8);
});

test("⌘A selects every pair in the run, folded groups too, as the run's query under the count's as_of", async () => {
  const { api, view } = await opened(bigRun());
  await view.groupBy("status");

  await view.selectAll();

  const total = RUN_TRAFFIC_PAGE_SIZE + 7;
  assert.equal(runSelectionLabel(get(view)), `${total} selected`);
  assert.deepEqual(runSelectionSpec(get(view)), {
    query: 'metadata.armory_run_id = "run-1"',
    exclusion: [],
    as_of: id(total),
  });
  assert.deepEqual(headerStates(view), ["403:all", "404:all"]);
  sends(api, view, total + 1, { status: 403 });
  view.flush();
  await view.settled();
  assert.equal(pairsIn(api, runRowMenuTarget(get(view), id(total)).selection).length, total);
});

test("⌘A on the plain list selects the whole run under the list's as_of, rows not read too", async () => {
  const { api, view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 5));

  await view.selectAll();

  assert.equal(runSelectionLabel(get(view)), `${RUN_TRAFFIC_PAGE_SIZE + 5} selected`);
  const target = runRowMenuTarget(get(view), id(1));
  assert.equal(target.count, RUN_TRAFFIC_PAGE_SIZE + 5);
  assert.deepEqual(target.selection, {
    query: 'metadata.armory_run_id = "run-1"',
    exclusion: [],
    as_of: id(RUN_TRAFFIC_PAGE_SIZE + 5),
  });
  // A pair sent after the read joins the rows but not the Selection.
  sends(api, view, RUN_TRAFFIC_PAGE_SIZE + 6);
  await view.loadMore();
  view.flush();
  assert.equal(isPairSelected(get(view), id(RUN_TRAFFIC_PAGE_SIZE + 6)), false);
  assert.equal(pairsIn(api, target.selection).length, RUN_TRAFFIC_PAGE_SIZE + 5);
});

test("⌘-clicking a group header after ⌘A drops that group from the run", async () => {
  const { api, view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.selectAll();
  view.toggleGroupSelection("404");
  assert.equal(runSelectionLabel(get(view)), "5 selected");
  assert.deepEqual(headerStates(view), ["200:all", "500:all", ":all", "403:all", "404:-"]);
  assert.deepEqual(pairsIn(api, runSelectionSpec(get(view))).sort(), [id(3), id(4), id(6), id(8), id(9)]);
});

test("⌘A on a run with no pairs selects nothing", async () => {
  const { view } = await opened([]);
  await view.selectAll();
  assert.equal(runSelectionSpec(get(view)), null);
});

const menuItem = (menu, path) => path.reduce((items, id) => items.find((it) => it?.id === id)?.sub ?? items.find((it) => it?.id === id), menu);

test("right-clicking a group header targets the whole group and leaves the Selection as it was", async () => {
  const { api, view } = await opened(bigRun());
  await view.groupBy("status");
  view.clickPair(id(RUN_TRAFFIC_PAGE_SIZE + 6), { toggle: true });

  const target = runGroupMenuTarget(get(view), "404");

  assert.deepEqual(selected(view), [id(RUN_TRAFFIC_PAGE_SIZE + 6)]);
  assert.equal(target.count, RUN_TRAFFIC_PAGE_SIZE + 5);
  assert.deepEqual(target.selection, {
    query: 'metadata.armory_run_id = "run-1" AND (status_code = 404)',
    exclusion: [],
    as_of: id(RUN_TRAFFIC_PAGE_SIZE + 7),
  });
  const menu = armoryMenuFor(target);
  assert.equal(menuItem(menu, ["launchpad", "lp-new"]).label, `New launchpad with ${RUN_TRAFFIC_PAGE_SIZE + 5} entries`);
  // The folded group's pairs aren't read, so they can't be listed one by one.
  assert.equal(menuItem(menu, ["testcase", "t-new"]).disabled, true);
  assert.equal(menuItem(menu, ["finding", "f-new"]).disabled, true);
  const ledger = fakeLedger();
  await runArmoryAction({ type: "link-test-case", id: "T1" }, target, { ledger });
  assert.equal(pairsIn(api, ledger.sent[0].selection).length, RUN_TRAFFIC_PAGE_SIZE + 5);
});

test("a new test case from a group header with every pair read attaches every pair in the group", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");

  const target = runGroupMenuTarget(get(view), "403");

  assert.equal(menuItem(armoryMenuFor(target), ["testcase", "t-new"]).disabled, false);
  const opened_ = [];
  await runArmoryAction({ type: "new-test-case" }, target, { ledger: fakeLedger(), newRecord: (kind, o) => opened_.push({ kind, ...o }) });
  assert.deepEqual(opened_, [{ kind: "testCase", requestIds: [id(3), id(9)] }]);
});

test("a group's rows stop at its count's as_of, so a whole group holds what it shows", async () => {
  const api = fakeApi(fuzzRun());
  const count = api.countRunTraffic;
  // A 403 the run sends between the count and the groups' reads.
  api.countRunTraffic = async (...args) => {
    const counted = await count(...args);
    if (!api.pairs.some((p) => p.Number === 11)) api.pairs.push(pair(11, { status: 403 }));
    return counted;
  };
  const view = createRunTrafficView(api);
  await view.open(RUN);
  await view.groupBy("status");

  assert.equal(groupOf(view, "403").count, 2);
  assert.deepEqual(groupOf(view, "403").list.rows.map((row) => row.Number), [3, 9]);
});

// Grouped, Previous and Next request step through the open pair's group.

test("grouped, stepping stays in the open pair's group and stops at its ends", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.expandAll();
  // Shown: 200 [8], 500 [4], pending [6], 403 [3, 9], 404 [1, 2, 5, 7, 10].
  view.openPair(id(3));

  assert.equal((await view.step(1)).Number, 9);
  assert.equal(await view.step(1), null);
  assert.equal(openNumber(view), 9);
  assert.equal((await view.step(-1)).Number, 3);
  assert.equal(await view.step(-1), null);
  assert.equal(openNumber(view), 3);
});

test("grouped, stepping follows the group's sort order", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.sortBy("time");
  await view.sortBy("time");
  await view.toggleGroup("404");
  view.openPair(id(10));

  const order = [10];
  while (await view.step(1)) order.push(openNumber(view));
  assert.deepEqual(order, [10, 7, 5, 2, 1]);
});

test("grouped, stepping past a group's last row read reads its next page", async () => {
  const big = many(RUN_TRAFFIC_PAGE_SIZE + 3, { status: 403 });
  const { api, view } = await opened([...big, pair(9000, { status: 500 })]);
  await view.groupBy("status");
  await view.toggleGroup("403");
  view.openPair(id(RUN_TRAFFIC_PAGE_SIZE));
  assert.equal(runCanStep(get(view), 1), true);

  assert.equal((await view.step(1)).Number, RUN_TRAFFIC_PAGE_SIZE + 1);
  assert.equal(api.calls.at(-1).Query, "status_code = 403");
  assert.equal(api.calls.at(-1).Cursor, String(RUN_TRAFFIC_PAGE_SIZE));
});

test("Previous and Next request are unavailable at the ends of the open pair's group", async () => {
  const { view } = await opened(fuzzRun());
  await view.groupBy("status");
  await view.expandAll();
  const can = () => [runCanStep(get(view), -1), runCanStep(get(view), 1)];

  view.openPair(id(3));
  assert.deepEqual(can(), [false, true]);
  view.openPair(id(9));
  assert.deepEqual(can(), [true, false]);
  // A group of one pair has nowhere to step.
  view.openPair(id(4));
  assert.deepEqual(can(), [false, false]);
});

test("ungrouped, Previous and Next request are unavailable only at the run's ends", async () => {
  const { view } = await opened(many(RUN_TRAFFIC_PAGE_SIZE + 1));
  const can = () => [runCanStep(get(view), -1), runCanStep(get(view), 1)];
  assert.deepEqual(can(), [false, false]);

  view.openPair(id(1));
  assert.deepEqual(can(), [false, true]);
  // The last row read, with a page still unread.
  view.openPair(id(RUN_TRAFFIC_PAGE_SIZE));
  assert.deepEqual(can(), [true, true]);
  await view.step(1);
  assert.deepEqual(can(), [true, false]);
});
