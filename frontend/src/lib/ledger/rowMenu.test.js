import { test } from "node:test";
import assert from "node:assert/strict";
import {
  curlCommand,
  filterMenu,
  markdownTable,
  menuAction,
  menuFor,
  narrowQuery,
  pairURL,
  selectionSummary,
  similarIDs,
} from "./rowMenu.js";
import { effectivePalette } from "./highlights.js";

const pair = (id, extra = {}) => ({
  ID: id,
  Scheme: "https",
  Host: "api.acme.test",
  Method: "GET",
  Path: `/v1/users/${id}`,
  StatusCode: 200,
  ContentType: "application/json",
  Metadata: {},
  ...extra,
});

const numbers = { a: 1, b: 2, c: 3, d: 4 };
const context = (extra = {}) => ({
  numberOf: (p) => numbers[p.ID],
  launchpads: [{ ID: "L1", Name: "Login" }],
  findings: [
    { ID: "F1", Title: "IDOR", Severity: "High", Requests: ["a", "b"] },
    { ID: "F2", Title: "XSS", Severity: "Low", Requests: ["a"] },
    { ID: "F3", Title: "CSRF", Severity: "Medium", Requests: [] },
  ],
  testCases: [{ ID: "T1", Title: "Auth", Requests: [] }],
  ...extra,
});

const item = (items, id) => {
  for (const it of items) {
    if (it?.id === id) return it;
    // ("sep".sub is String.prototype.sub.)
    const found = Array.isArray(it?.sub) && item(it.sub, id);
    if (found) return found;
  }
  return undefined;
};
const ids = (items) => items.filter((it) => it?.id).map((it) => it.id);

test("one pair: Launchpad, Armory, Browser view, Finding, Test case, Note, Highlight, Copy, Narrow, Select, Metadata, Delete", () => {
  const menu = menuFor([pair("a")], context());
  assert.deepEqual(ids(menu), [
    "launchpad",
    "armory",
    "browser-view",
    "finding",
    "testcase",
    "note",
    "highlight",
    "copy",
    "narrow",
    "select",
    "metadata",
    "delete",
  ]);
  assert.equal(item(menu, "open"), undefined, "a right-click already opens the row in the drawer");
  assert.equal(item(menu, "note").label, "Add note…");
  assert.equal(item(menu, "metadata").disabled, false);
  assert.equal(item(menu, "lp-each"), undefined, "one each needs several pairs");
});

test("a WebSocket upgrade row offers its stream", () => {
  const ws = pair("a", { StatusCode: 101, Metadata: { protocol: "websocket" } });
  assert.deepEqual(ids(menuFor([ws], context())).slice(0, 2), ["websocket", "launchpad"]);
  assert.equal(item(menuFor([ws, pair("b")], context()), "websocket"), undefined);
});

test("several pairs: counts in the labels, bulk notes, metadata disabled", () => {
  const menu = menuFor([pair("a"), pair("b")], context());
  assert.equal(item(menu, "open"), undefined);
  assert.equal(item(menu, "lp-new").label, "New launchpad with 2 entries");
  assert.equal(item(menu, "lp-each").label, "2 launchpads, one each");
  assert.equal(item(menu, "armory").label, "Send 2 to Armory");
  assert.deepEqual(ids(item(menu, "note").sub), ["n-append", "n-clear"]);
  assert.equal(item(menu, "metadata").disabled, true);
  assert.equal(item(menu, "c-url").label, "2 URLs");
});

test("one launchpad each is disabled past 25 pairs", () => {
  const many = Array.from({ length: 26 }, (_, i) => pair(`p${i}`));
  assert.equal(item(menuFor(many, context()), "lp-each").disabled, true);
  assert.equal(item(menuFor(many.slice(0, 25), context()), "lp-each").disabled, false);
});

test("findings show checked when every pair is linked, mixed when some are, and unlink the linked ones", () => {
  const menu = menuFor([pair("a"), pair("b")], context());
  assert.equal(item(menu, "f-F1").checked, true);
  assert.equal(item(menu, "f-F2").checked, "mixed");
  assert.equal(item(menu, "f-F3").checked, false);
  assert.deepEqual(item(menu, "f-F1").action, { type: "link-finding", id: "F1", title: "IDOR" });
  assert.deepEqual(ids(item(menu, "f-unlink").sub), ["fu-F1", "fu-F2"]);
  assert.equal(item(menu, "finding").badge, 2);
  assert.equal(item(menu, "testcase").badge, null);
});

test("Launchpad, Finding and Test case put new, add and remove in their own submenus", () => {
  const one = menuFor([pair("a")], context());
  assert.deepEqual(ids(item(one, "launchpad").sub), ["lp-new", "lp-add", "lp-remove"]);
  assert.deepEqual(ids(item(one, "lp-add").sub), ["lp-L1"]);
  assert.deepEqual(ids(item(one, "lp-remove").sub), ["lpu-L1"]);
  assert.equal(item(one, "lp-add").label, "Add to launchpad");
  assert.equal(item(one, "lp-remove").label, "Remove from launchpad");
  const two = menuFor([pair("a"), pair("b")], context());
  assert.deepEqual(ids(item(two, "launchpad").sub), ["lp-new", "lp-each", "lp-add", "lp-remove"]);
  assert.deepEqual(ids(item(two, "finding").sub), ["f-new", "f-link", "f-unlink"]);
  assert.equal(item(two, "f-link").label, "Link to finding");
  assert.equal(item(two, "f-unlink").label, "Unlink from finding");
  assert.deepEqual(ids(item(two, "testcase").sub), ["t-new", "t-link"], "nothing linked, nothing to unlink");
  for (const sub of [item(one, "launchpad").sub, item(two, "finding").sub]) {
    assert.ok(!sub.some((it) => it?.heading), "no headings: each group is a submenu");
  }
});

test("with no launchpads, findings or test cases, their add submenus are disabled and say so", () => {
  const menu = menuFor([pair("a")], context({ launchpads: [], findings: [], testCases: [] }));
  assert.equal(item(menu, "lp-add").disabled, true);
  assert.equal(item(menu, "lp-add").hint, "No launchpads yet");
  assert.equal(item(menu, "lp-remove"), undefined);
  assert.equal(item(menu, "f-link").hint, "No findings yet");
  assert.equal(item(menu, "t-link").hint, "No test cases yet");
});

test("copying raw responses is disabled until a pair has one", () => {
  const pending = pair("a", { StatusCode: 0 });
  assert.equal(item(menuFor([pending], context()), "c-res").disabled, true);
  assert.equal(item(menuFor([pending, pair("b")], context()), "c-res").disabled, false);
});

test("narrowing offers the host, other hosts, the path's folder, the status and hiding the type", () => {
  const menu = menuFor([pair("a", { Path: "/v1/users/7?x=1" })], context());
  const narrow = item(menu, "narrow").sub.filter((it) => it.action);
  assert.deepEqual(
    narrow.map((it) => it.action),
    [
      { type: "narrow", term: 'host = "api.acme.test"' },
      { type: "narrow", term: 'host != "api.acme.test"' },
      { type: "narrow", term: 'path = "/v1/users/*"' },
      { type: "narrow", term: "status_code = 200" },
    ],
  );
  assert.deepEqual(ids(item(menu, "narrow").sub).at(-1), "q-hide", "hiding a type is its own submenu");
  assert.deepEqual(item(menu, "x-application/json").action, { type: "hide-type", contentType: "application/json" });
  const two = menuFor([pair("a"), pair("b", { Host: "cdn.acme.test", StatusCode: 404 })], context());
  assert.deepEqual(item(two, "q-host").action, {
    type: "narrow",
    term: '(host = "api.acme.test" OR host = "cdn.acme.test")',
  });
  assert.equal(item(two, "q-status"), undefined, "statuses differ");
});

test("the header sums up hosts, methods and status classes", () => {
  const summary = selectionSummary([
    pair("a"),
    pair("b", { Method: "POST", StatusCode: 500 }),
    pair("c", { Host: "cdn.acme.test", StatusCode: 0 }),
  ]);
  assert.deepEqual(summary, {
    count: 3,
    hosts: ["api.acme.test", "cdn.acme.test"],
    methods: [
      ["GET", 2],
      ["POST", 1],
    ],
    classes: [
      ["2xx", 1],
      ["5xx", 1],
    ],
  });
});

test("type-to-filter searches every action, submenus included, and shows where each lives", () => {
  const found = filterMenu(menuFor([pair("a")], context()), "curl");
  assert.deepEqual(
    found.map((it) => [it.trail, it.label]),
    [[["Copy"], "As a cURL command"]],
  );
  const idor = filterMenu(menuFor([pair("a")], context()), "idor").find((it) => it.id === "f-F1");
  assert.deepEqual(idor.trail, ["Finding", "Link to finding"], "a nested action shows its whole path");
  assert.ok(filterMenu(menuFor([pair("a")], context()), "launchpad").length >= 2);
});

test("the highlight swatches: 8 labelled from the palette, then None, marking the pairs' own", () => {
  const palette = effectivePalette([], { 3: "IDOR candidate" });
  const menu = menuFor([pair("a", { Highlight: 3 }), pair("b", { Highlight: 3 })], context({ palette }));
  const swatches = item(menu, "highlight").swatches;
  assert.deepEqual(
    swatches.map((s) => [s.label, s.color, s.checked]),
    [
      ["Red", "#ef4444", false],
      ["Orange", "#f97316", false],
      ["IDOR candidate", "#eab308", true],
      ["Green", "#22c55e", false],
      ["Cyan", "#06b6d4", false],
      ["Blue", "#3b82f6", false],
      ["Purple", "#a855f7", false],
      ["Pink", "#ec4899", false],
      ["None", null, false],
    ],
  );
  assert.deepEqual(swatches[2].action, { type: "highlight", number: 3 });
  assert.deepEqual(swatches[8].action, { type: "highlight", number: null });
});

test("a swatch some of the pairs have is mixed; None is checked when none have one", () => {
  const palette = effectivePalette([]);
  const mixed = item(menuFor([pair("a", { Highlight: 5 }), pair("b")], context({ palette })), "highlight");
  assert.equal(mixed.swatches[4].checked, "mixed");
  assert.equal(mixed.swatches[8].checked, "mixed");
  const plain = item(menuFor([pair("a")], context({ palette })), "highlight");
  assert.equal(plain.swatches[8].checked, true);
});

test("type-to-filter finds a swatch by its label", () => {
  const palette = effectivePalette([], { 3: "IDOR candidate" });
  const found = filterMenu(menuFor([pair("a")], context({ palette })), "idor cand");
  assert.deepEqual(
    found.map((it) => [it.trail, it.label, it.color]),
    [[["Highlight"], "IDOR candidate", "#eab308"]],
  );
});

test("narrowing appends a term; a query with OR is grouped first", () => {
  assert.equal(narrowQuery("", 'host = "x"'), 'host = "x"');
  assert.equal(narrowQuery("method = \"GET\" ", 'host = "x"'), 'method = "GET" AND host = "x"');
  assert.equal(
    narrowQuery('status_code = 500 OR status_code = 502', 'host = "x"'),
    '(status_code = 500 OR status_code = 502) AND host = "x"',
  );
});

test("Select finds the loaded rows like the selection", () => {
  const rows = [
    pair("a"),
    pair("b", { Host: "cdn.acme.test", StatusCode: 404 }),
    pair("c", { Path: "/v1/users/a" }),
    pair("d", { Highlight: 3 }),
  ];
  const chosen = [rows[0]];
  assert.deepEqual(similarIDs("host", rows, chosen), ["a", "c", "d"]);
  assert.deepEqual(similarIDs("endpoint", rows, chosen), ["a", "c"]);
  assert.deepEqual(similarIDs("status", rows, [rows[1]]), ["b"]);
  assert.deepEqual(similarIDs("highlight", rows, [rows[3]]), ["d"]);
  assert.deepEqual(similarIDs("invert", rows, chosen), ["b", "c", "d"]);
});

test("copy formats: URL, Markdown table and cURL", () => {
  assert.equal(pairURL(pair("a")), "https://api.acme.test/v1/users/a");
  assert.equal(
    markdownTable([pair("a"), pair("b", { StatusCode: 0 })], (p) => numbers[p.ID]),
    [
      "| # | Method | URL | Status |",
      "|---|---|---|---|",
      "| 1 | GET | https://api.acme.test/v1/users/a | 200 |",
      "| 2 | GET | https://api.acme.test/v1/users/b | — |",
    ].join("\n"),
  );
  const raw = "POST /login HTTP/1.1\r\nHost: api.acme.test\r\nContent-Type: application/json\r\n\r\n{\"u\":\"it's\"}";
  assert.equal(
    curlCommand(pair("a", { Method: "POST", Path: "/login" }), raw),
    [
      "curl -X POST 'https://api.acme.test/login'",
      "  -H 'Content-Type: application/json'",
      "  --data-raw '{\"u\":\"it'\\''s\"}'",
    ].join(" \\\n"),
  );
});

test("cURL for an HTTP/2 request asks for HTTP/2 and leaves out the pseudo-header fields", () => {
  const raw = "GET /me HTTP/2\r\n:scheme: https\r\n:authority: api.acme.test\r\naccept: */*\r\n\r\n";
  assert.equal(
    curlCommand(pair("a", { Method: "GET", Path: "/me" }), raw),
    ["curl --http2 -X GET 'https://api.acme.test/me'", "  -H 'accept: */*'"].join(" \\\n"),
  );
});

test("Note: one pair adds or edits it; several append a note or clear them", () => {
  const menu = menuFor([pair("a"), pair("b")], context());
  assert.equal(item(menu, "note").label, "Note");
  assert.equal(item(menu, "n-append").label, "Append a note…");
  assert.deepEqual(item(menu, "n-append").action, { type: "append-note" });
  assert.equal(item(menu, "n-clear").label, "Clear notes…");
  assert.deepEqual(item(menu, "n-clear").action, { type: "clear-notes" });
  assert.equal(item(menu, "n-clear").danger, true);
  assert.equal(item(menuFor([pair("a", { Metadata: { has_note: 1 } })], context()), "note").label, "Edit note…");
});

test("Remove from launchpad lists the launchpads", () => {
  const menu = menuFor([pair("a")], context({ launchpads: [{ ID: "L1", Name: "Login" }, { ID: "L2", Name: "" }] }));
  assert.deepEqual(ids(item(menu, "lp-remove").sub), ["lpu-L1", "lpu-L2"]);
  assert.deepEqual(item(menu, "lpu-L1").action, { type: "remove-from-launchpad", id: "L1", name: "Login" });
  assert.equal(item(menu, "lpu-L2").label, "Untitled launchpad");
});

test("labels say whether they act on one request or the whole selection", () => {
  const one = menuFor([pair("a")], context());
  assert.equal(item(one, "c-url").label, "URL");
  assert.equal(item(one, "c-curl").label, "As a cURL command");
  assert.equal(item(one, "c-md").label, "As a Markdown table");
  assert.equal(item(one, "c-numbers").label, "Request number");
  const three = menuFor([pair("a"), pair("b"), pair("c")], context());
  assert.equal(item(three, "c-url").label, "3 URLs");
  assert.equal(item(three, "c-curl").label, "3 requests as cURL commands");
  assert.equal(item(three, "c-md").label, "3 requests as a Markdown table");
  assert.equal(item(three, "c-numbers").label, "3 request numbers");
  assert.equal(item(three, "f-new").label, "New finding with 3 requests");
});

test("Delete from project comes last and names the count", () => {
  const one = menuFor([pair("a")], context());
  assert.equal(ids(one).at(-1), "delete");
  assert.equal(item(one, "delete").label, "Delete from project…");
  assert.deepEqual(item(one, "delete").action, { type: "delete" });
  assert.equal(item(one, "delete").danger, true);
  assert.equal(item(menuFor([pair("a"), pair("b")], context()), "delete").label, "Delete 2 from project…");
});

// The launchpad store's pending launches: each launch's ID is its pair's.
const launching = (...launches) => ({
  pendingLaunches: launches.map(([id, launchpadId]) => ({ ID: id, LaunchpadID: launchpadId, Status: "pending" })),
});

test("Delete is greyed with the count when the selection holds pairs still launching", () => {
  const menu = menuFor([pair("a"), pair("b"), pair("c")], context(launching(["a", "L1"], ["c", "L2"], ["z", "L1"])));
  assert.equal(item(menu, "delete").disabled, true);
  assert.equal(item(menu, "delete").hint, "2 launching");
  assert.ok(!item(menuFor([pair("b")], context(launching(["a", "L1"]))), "delete").disabled);
});

test("a ⌘A selection's Delete stays enabled: Marasi says which pairs are launching", () => {
  const menu = menuFor([pair("a"), pair("b")], context({ all: true, count: 1200, ...launching(["a", "L1"]) }));
  assert.ok(!item(menu, "delete").disabled);
  assert.ok(!item(menu, "lpu-L1").disabled);
});

test("Remove from a launchpad is greyed for the pairs launched from it, not from others", () => {
  const launchpads = [
    { ID: "L1", Name: "Login" },
    { ID: "L2", Name: "Signup" },
  ];
  const menu = menuFor([pair("a"), pair("b")], context({ launchpads, ...launching(["a", "L1"], ["b", "L1"]) }));
  assert.equal(item(menu, "lpu-L1").disabled, true);
  assert.equal(item(menu, "lpu-L1").hint, "2 launching");
  assert.ok(!item(menu, "lpu-L2").disabled, "a pair launched from Login can leave Signup");
});

test("a ⌘A selection names its count, and actions that need each pair wait for them all", () => {
  const menu = menuFor([pair("a"), pair("b")], context({ all: true, count: 1200 }));
  assert.equal(item(menu, "lp-new").label, "New launchpad with 1,200 entries");
  assert.equal(item(menu, "delete").label, "Delete 1,200 from project…");
  assert.equal(item(menu, "lp-each").disabled, true);
  assert.equal(item(menu, "armory").disabled, true);
  assert.equal(item(menu, "copy").disabled, true);
  assert.equal(item(menu, "f-new").disabled, true);
  assert.equal(item(menu, "t-new").disabled, true);
  assert.equal(item(menu, "lp-L1").disabled, undefined, "bulk links still run");
  assert.equal(item(menu, "f-F3").checked, undefined, "link states are unknown");
  assert.deepEqual(ids(item(menu, "f-unlink").sub), ["fu-F1", "fu-F2", "fu-F3"], "any finding can be unlinked");
  assert.ok(item(menu, "highlight").swatches.every((swatch) => swatch.checked === undefined));

  const counting = menuFor([pair("a"), pair("b")], context({ all: true, count: null }));
  assert.equal(item(counting, "lp-new").label, "New launchpad with all entries");

  const loaded = menuFor([pair("a"), pair("b")], context({ all: true, count: 2 }));
  assert.equal(item(loaded, "armory").disabled, false, "every pair is loaded");
  assert.equal(item(loaded, "f-F1").checked, true);
});

test("a shortcut finds its menu action, disabled with the reason when the menu disables it or its submenu", () => {
  const all = menuFor([pair("a"), pair("b")], context({ all: true, count: 1200 }));
  for (const id of [
    "ledger.drawer-open.send-to-armory",
    "ledger.drawer-open.create-finding",
    "ledger.drawer-open.create-test-case",
    "ledger.drawer-open.copy-url",
    "ledger.drawer-open.copy-raw-request",
  ]) {
    assert.deepEqual(menuAction(all, id).disabled, true, id);
    assert.equal(menuAction(all, id).hint, "Not for all matching", id);
  }
  assert.deepEqual(menuAction(all, "ledger.drawer-open.send-to-launchpad"), {
    action: { type: "new-launchpad" },
    disabled: false,
    hint: undefined,
  });

  const two = menuFor([pair("a"), pair("b")], context());
  assert.deepEqual(menuAction(two, "ledger.drawer-open.copy-url"), {
    action: { type: "copy", what: "urls" },
    disabled: false,
    hint: undefined,
  });
  const pending = menuFor([pair("a", { StatusCode: 0 })], context());
  assert.equal(menuAction(pending, "ledger.drawer-open.copy-raw-response").hint, "No response yet");
  assert.equal(menuAction(two, "no.such.action"), null);
});

test("type-to-filter keeps a disabled submenu's actions disabled", () => {
  const all = menuFor([pair("a"), pair("b")], context({ all: true, count: 1200 }));
  const found = filterMenu(all, "raw requests");
  assert.equal(found.length, 1);
  assert.equal(found[0].disabled, true);
  assert.equal(found[0].hint, "Not for all matching");
});

test("Select offers each highlight the selection has", () => {
  const palette = effectivePalette(null, { 3: "IDOR" });
  const none = menuFor([pair("a"), pair("b")], context({ palette }));
  assert.equal(item(none, "s-highlight-3"), undefined);

  const one = menuFor([pair("a", { Highlight: 3 }), pair("b")], context({ palette }));
  assert.equal(item(one, "s-highlight-3").label, "All with this highlight");
  assert.deepEqual(item(one, "s-highlight-3").action, { type: "select", kind: "highlight", number: 3 });

  const two = menuFor([pair("a", { Highlight: 3 }), pair("b", { Highlight: 1 }), pair("c", { Highlight: 3 })], context({ palette }));
  assert.equal(item(two, "s-highlight-3").label, "All with highlight IDOR");
  assert.equal(item(two, "s-highlight-1").label, "All with highlight Red");

  const rows = [pair("a", { Highlight: 3 }), pair("b", { Highlight: 1 }), pair("c", { Highlight: 3 })];
  assert.deepEqual(similarIDs("highlight", rows, rows, 3), ["a", "c"]);
});

test("actions that would change nothing are disabled, with a reason", () => {
  const palette = effectivePalette([]);
  const plain = menuFor([pair("a"), pair("b")], context({ palette }));
  const swatches = item(plain, "highlight").swatches;
  assert.equal(swatches[8].disabled, true, "None, with nothing highlighted");
  assert.equal(swatches[8].hint, "Nothing to clear");
  assert.equal(swatches[0].disabled, false);
  assert.equal(item(plain, "n-clear").disabled, true, "Clear notes, with no notes");
  assert.equal(item(plain, "n-clear").hint, "No notes to clear");
  assert.equal(item(plain, "f-F1").disabled, true, "a finding every pair is linked to");
  assert.equal(item(plain, "f-F1").hint, "Already linked");
  assert.equal(item(plain, "f-F2").disabled, false);

  const red = item(menuFor([pair("a", { Highlight: 1 }), pair("b", { Highlight: 1 })], context({ palette })), "highlight");
  assert.equal(red.swatches[0].disabled, true, "a highlight every pair already has");
  assert.equal(red.swatches[8].disabled, false);

  const noted = menuFor([pair("a", { Metadata: { has_note: 1 } }), pair("b")], context());
  assert.equal(item(noted, "n-clear").disabled, false);
});

test("under a partly loaded selection nothing is disabled for being a no-op", () => {
  const menu = menuFor([pair("a"), pair("b")], context({ all: true, count: 1200 }));
  assert.ok(item(menu, "highlight").swatches.every((s) => !s.disabled));
  assert.equal(item(menu, "n-clear").disabled, false);
});

test("Copy browser view URL is for one pair with a response that is not a WebSocket upgrade", () => {
  const view = (pairs) => item(menuFor(pairs, context()), "browser-view");
  assert.deepEqual(view([pair("a")]).action, { type: "browser-view", id: "a" });
  assert.equal(view([pair("a")]).disabled, false);
  assert.equal(view([pair("a")]).actionId, "ledger.drawer-open.copy-browser-view-url");
  for (const [pairs, hint] of [
    [[pair("a"), pair("b")], "One request at a time"],
    [[pair("a", { StatusCode: 0 })], "No response yet"],
    [[pair("a", { StatusCode: 101 })], "Not for a WebSocket upgrade"],
  ]) {
    assert.equal(view(pairs).disabled, true);
    assert.equal(view(pairs).hint, hint);
  }
});

test("the browser view shortcut says why the menu disables it", () => {
  const menu = menuFor([pair("a", { StatusCode: 0 })], context());
  assert.deepEqual(menuAction(menu, "ledger.drawer-open.copy-browser-view-url"), {
    action: { type: "browser-view", id: "a" },
    disabled: true,
    hint: "No response yet",
  });
});
