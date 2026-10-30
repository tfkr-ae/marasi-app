// The Armory's run traffic view: a run's pairs read a page at a time,
// sorted by a column, with the pairs a live run sends joining or waiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { armoryMenuFor, runArmoryAction } from "../lib/armory/rowMenu.js";
import {
  RUN_TRAFFIC_PAGE_SIZE,
  createRunTrafficView,
  openRunPair,
  runTrafficNewLabel,
  runRowMenuTarget,
  runSelectionLabel,
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
  return api;
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
      sent.push({ method: "sendToNewLaunchpad", selection, count, numbers: selection.ids.map(numberOf) });
      return { launchpadId: "L9" };
    },
    addToLaunchpad: async (selection, id) => (sent.push({ method: "addToLaunchpad", selection, id }), selection.ids.length),
    linkToFinding: async (selection, id) => (sent.push({ method: "linkToFinding", selection, id }), selection.ids.length),
    unlinkFromFinding: async (selection, id) => (sent.push({ method: "unlinkFromFinding", selection, id }), selection.ids.length),
    linkToTestCase: async (selection, id) => (sent.push({ method: "linkToTestCase", selection, id }), selection.ids.length),
    unlinkFromTestCase: async (selection, id) => (sent.push({ method: "unlinkFromTestCase", selection, id }), selection.ids.length),
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
