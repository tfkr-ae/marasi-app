import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_FILTERS, canOpenPair, filterByLevel, openPair } from "./serviceLog.js";

const line = (Level, Message) => ({ Level, Message });
const lines = [
  line("DEBUG", "d"),
  line("INFO", "i"),
  line("WARN", "w"),
  line("ERROR", "e"),
  line("FATAL", "f"),
];
const messages = (rows) => rows.map((r) => r.Message).join("");

test("the level filter defaults to all levels", () => {
  assert.equal(LEVEL_FILTERS[0].id, "all");
  assert.equal(messages(filterByLevel(lines)), "diwef");
  assert.equal(messages(filterByLevel(lines, "all")), "diwef");
});

test("each level filter shows that level and the more severe ones", () => {
  assert.equal(messages(filterByLevel(lines, "info")), "iwef");
  assert.equal(messages(filterByLevel(lines, "warn")), "wef");
  assert.equal(messages(filterByLevel(lines, "error")), "ef");
});

test("the level filter offers All, Info, Warn and Error in that order", () => {
  assert.deepEqual(LEVEL_FILTERS.map((f) => f.id), ["all", "info", "warn", "error"]);
});

test("levels match whatever their case, and WARNING counts as WARN", () => {
  const rows = [line("warning", "a"), line("error", "b"), line("info", "c")];
  assert.equal(messages(filterByLevel(rows, "warn")), "ab");
});

test("a line with an unknown level shows only under All", () => {
  const rows = [line("TRACE", "t"), line(undefined, "u"), line("WARN", "w")];
  assert.equal(messages(filterByLevel(rows, "all")), "tuw");
  assert.equal(messages(filterByLevel(rows, "info")), "w");
});

// A fake app: the pair the service holds, the page goto lands on, and the
// Ledger's jump to a pair number.
function fakeApp(pairs = {}) {
  const seen = { pages: [], jumps: [], selected: [] };
  return {
    seen,
    deps: {
      pairNumber: async (id) => pairs[id] ?? null,
      goto: async (url) => seen.pages.push(url),
      ledger: {
        goToNumber: async (n) => (seen.jumps.push(n), { pair: { ID: `pair-${n}` } }),
        selectPair: (id) => seen.selected.push(id),
      },
    },
  };
}

test("a line that names a request opens that pair in the Ledger", async () => {
  const app = fakeApp({ "abc": 42 });
  assert.equal(canOpenPair({ RequestID: "abc" }), true);
  assert.equal(await openPair({ RequestID: "abc" }, app.deps), true);
  assert.deepEqual(app.seen.pages, ["/ledger"]);
  assert.deepEqual(app.seen.jumps, [42]);
  assert.deepEqual(app.seen.selected, ["pair-42"]);
});

test("a line without a request does nothing", async () => {
  const app = fakeApp();
  assert.equal(canOpenPair({ RequestID: null }), false);
  assert.equal(await openPair({ RequestID: null }, app.deps), false);
  assert.deepEqual(app.seen, { pages: [], jumps: [], selected: [] });
});

test("a line naming a pair the project no longer holds stays put", async () => {
  const app = fakeApp();
  assert.equal(await openPair({ RequestID: "gone" }, app.deps), false);
  assert.deepEqual(app.seen.pages, []);
});
