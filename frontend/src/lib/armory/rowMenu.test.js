import { test } from "node:test";
import assert from "node:assert/strict";
import { armoryMenuFor, pairTarget, runArmoryAction } from "./rowMenu.js";

const pair = (id) => ({ ID: id, Method: "GET", Host: "api.acme.test", Path: `/v1/users/${id}`, StatusCode: 200 });

// A target of these pairs, by their IDs.
const targetOf = (...pairs) => ({ pairs, selection: { ids: pairs.map((p) => String(p.ID)) }, count: pairs.length });

const context = (extra = {}) => ({
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

test("the menu offers only Send to Launchpad, Finding and Test case", () => {
  const menu = armoryMenuFor(targetOf(pair("a")), context());
  assert.deepEqual(ids(menu), ["launchpad", "finding", "testcase"]);
  assert.deepEqual(menu, [item(menu, "launchpad"), "sep", item(menu, "finding"), item(menu, "testcase")]);
});

test("no pairs, no menu", () => {
  assert.deepEqual(armoryMenuFor(targetOf(), context()), []);
});

test("Send to Launchpad makes a new launchpad or adds to one of the launchpads", () => {
  const menu = armoryMenuFor(targetOf(pair("a")), context({ launchpads: [{ ID: "L1", Name: "Login" }, { ID: "L2", Name: "" }] }));
  assert.deepEqual(ids(item(menu, "launchpad").sub), ["lp-new", "lp-add"]);
  assert.deepEqual(item(menu, "lp-new").action, { type: "new-launchpad" });
  assert.equal(item(menu, "lp-new").label, "New launchpad");
  assert.deepEqual(
    item(menu, "lp-add").sub.map((it) => [it.label, it.action]),
    [
      ["Login", { type: "add-to-launchpad", id: "L1", name: "Login" }],
      ["Untitled launchpad", { type: "add-to-launchpad", id: "L2", name: "" }],
    ],
  );
  assert.equal(item(menu, "lp-add").disabled, false);
});

test("a linked finding is checked and disabled, an unlinked one can be linked, and Unlink lists only the linked", () => {
  const menu = armoryMenuFor(targetOf(pair("a")), context());
  assert.deepEqual(
    item(menu, "f-link").sub.map((it) => [it.label, it.severity, it.checked, it.disabled]),
    [
      ["IDOR", "High", true, true],
      ["XSS", "Low", true, true],
      ["CSRF", "Medium", false, false],
    ],
  );
  assert.equal(item(menu, "f-F1").hint, "Already linked");
  assert.deepEqual(item(menu, "f-F3").action, { type: "link-finding", id: "F3", title: "CSRF" });
  assert.deepEqual(
    item(menu, "f-unlink").sub.map((it) => it.action),
    [
      { type: "unlink-finding", id: "F1", title: "IDOR" },
      { type: "unlink-finding", id: "F2", title: "XSS" },
    ],
  );
  assert.equal(item(menu, "finding").badge, 2);
});

test("over several pairs a target some of them link is mixed, still linkable and unlinkable", () => {
  const menu = armoryMenuFor(targetOf(pair("a"), pair("b"), pair("c")), context());
  assert.deepEqual(
    item(menu, "f-link").sub.map((it) => [it.id, it.checked, it.disabled]),
    [
      ["f-F1", "mixed", false],
      ["f-F2", "mixed", false],
      ["f-F3", false, false],
    ],
  );
  assert.deepEqual(ids(item(menu, "f-unlink").sub), ["fu-F1", "fu-F2"]);
  assert.equal(item(menu, "f-new").label, "New finding with 3 requests");
  assert.equal(item(menu, "lp-new").label, "New launchpad with 3 entries");
});

test("IDs match whether they are numbers or strings", () => {
  const menu = armoryMenuFor(targetOf(pair(7)), context({ findings: [{ ID: "F1", Title: "IDOR", Requests: ["7"] }] }));
  assert.equal(item(menu, "f-F1").checked, true);
});

test("Test case mirrors Finding: new from this request, link and unlink", () => {
  const menu = armoryMenuFor(targetOf(pair("a")),
    context({ testCases: [{ ID: "T1", Title: "Auth", Requests: ["a"] }, { ID: "T2", Title: "", Requests: [] }] }),
  );
  assert.deepEqual(ids(item(menu, "testcase").sub), ["t-new", "t-link", "t-unlink"]);
  assert.equal(item(menu, "t-new").label, "New test case from this request");
  assert.deepEqual(item(menu, "t-new").action, { type: "new-test-case" });
  assert.deepEqual(item(menu, "t-T2").action, { type: "link-test-case", id: "T2", title: "Untitled test case" });
  assert.deepEqual(item(menu, "tu-T1").action, { type: "unlink-test-case", id: "T1", title: "Auth" });
  assert.equal(item(menu, "t-T1").disabled, true);
  assert.equal(item(menu, "testcase").badge, 1);
});

test("with no launchpads, findings or test cases, their link submenus are disabled and say so", () => {
  const menu = armoryMenuFor(targetOf(pair("a")), { launchpads: [], findings: [], testCases: [] });
  for (const [id, hint] of [
    ["lp-add", "No launchpads yet"],
    ["f-link", "No findings yet"],
    ["t-link", "No test cases yet"],
  ]) {
    assert.equal(item(menu, id).disabled, true, id);
    assert.equal(item(menu, id).hint, hint);
  }
  assert.equal(item(menu, "f-unlink"), undefined);
  assert.equal(item(menu, "t-unlink"), undefined);
});

// A fake Ledger store: records each bulk call and resolves as Marasi would.
function fakeLedger() {
  const calls = [];
  const record = (name, result) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(result);
  };
  return {
    calls,
    sendToNewLaunchpad: record("sendToNewLaunchpad", { launchpadId: "L9", count: 1 }),
    addToLaunchpad: record("addToLaunchpad", 1),
    linkToFinding: record("linkToFinding", 1),
    unlinkFromFinding: record("unlinkFromFinding", 1),
    linkToTestCase: record("linkToTestCase", 1),
    unlinkFromTestCase: record("unlinkFromTestCase", 1),
    pairNumber: (id) => (id === "late" ? 12 : "?"),
  };
}

test("a one-pair target sends that pair to a new launchpad named by its own number", async () => {
  const ledger = fakeLedger();
  const target = pairTarget({ ...pair("a"), Number: 4 });
  const outcome = await runArmoryAction({ type: "new-launchpad" }, target, { ledger });
  assert.deepEqual(outcome, { type: "new-launchpad", launchpadId: "L9" });
  const [[name, selection, count, { numberOf }]] = ledger.calls;
  assert.equal(name, "sendToNewLaunchpad");
  assert.deepEqual(selection, { ids: ["a"] });
  assert.equal(count, 1);
  assert.equal(numberOf("a"), 4);
});

// Three pairs, numbered by their own pair numbers.
const threePairs = () => ({
  pairs: [
    { ...pair("a"), Number: 2 },
    { ...pair("b"), Number: 7 },
    { ...pair("c"), Number: 31 },
  ],
  selection: { ids: ["a", "b", "c"] },
  count: 3,
});

test("a multi-pair target sends every pair to a new launchpad, numbered by their own numbers", async () => {
  const ledger = fakeLedger();
  await runArmoryAction({ type: "new-launchpad" }, threePairs(), { ledger });
  const [[, selection, count, { numberOf }]] = ledger.calls;
  assert.deepEqual(selection, { ids: ["a", "b", "c"] });
  assert.equal(count, 3);
  assert.deepEqual(["a", "b", "c"].map(numberOf), [2, 7, 31]);
});

test("a multi-pair target adds every pair to a launchpad", async () => {
  const ledger = fakeLedger();
  const outcome = await runArmoryAction({ type: "add-to-launchpad", id: "L1", name: "Login" }, threePairs(), { ledger });
  assert.deepEqual(ledger.calls, [["addToLaunchpad", { ids: ["a", "b", "c"] }, "L1"]]);
  assert.deepEqual(outcome, { type: "add-to-launchpad", launchpadId: "L1", name: "Login", count: 1 });
});

test("a multi-pair target links and unlinks every pair to a finding or test case", async () => {
  for (const [type, method] of [
    ["link-finding", "linkToFinding"],
    ["unlink-finding", "unlinkFromFinding"],
    ["link-test-case", "linkToTestCase"],
    ["unlink-test-case", "unlinkFromTestCase"],
  ]) {
    const ledger = fakeLedger();
    const outcome = await runArmoryAction({ type, id: "X1", title: "IDOR" }, threePairs(), { ledger });
    assert.deepEqual(ledger.calls, [[method, { ids: ["a", "b", "c"] }, "X1"]], type);
    assert.deepEqual(outcome, { type, title: "IDOR", count: 1 });
  }
});

test("a multi-pair target opens a new finding or test case with every pair as a request", async () => {
  for (const [type, kind] of [
    ["new-finding", "finding"],
    ["new-test-case", "testCase"],
  ]) {
    const opened = [];
    const newRecord = (...args) => opened.push(args);
    const outcome = await runArmoryAction({ type }, threePairs(), { ledger: fakeLedger(), newRecord });
    assert.deepEqual(opened, [[kind, { requestIds: ["a", "b", "c"] }]], type);
    assert.deepEqual(outcome, { type });
  }
});

test("a query Selection names its count and disables what needs each pair", () => {
  // A whole group: 500 pairs by query, two of them loaded.
  const target = { pairs: [pair("a"), pair("b")], selection: { query: "status_code = 404", exclusion: [], as_of: "t" }, count: 500 };
  const menu = armoryMenuFor(target, context());
  assert.equal(item(menu, "lp-new").label, "New launchpad with 500 entries");
  assert.equal(item(menu, "lp-new").disabled, undefined);
  assert.equal(item(menu, "f-new").disabled, true);
  assert.equal(item(menu, "t-new").disabled, true);
  assert.equal(item(menu, "f-new").label, "New finding with 500 requests");
});

test("a pair that arrived without its own number takes the Ledger's", async () => {
  const ledger = fakeLedger();
  await runArmoryAction({ type: "new-launchpad" }, pairTarget(pair("late")), { ledger });
  const [[, , , { numberOf }]] = ledger.calls;
  assert.equal(numberOf("late"), 12);
});

test("a one-pair target targets that pair alone, by its ID", () => {
  const row = { ...pair(7), Number: 3 };
  assert.deepEqual(pairTarget(row), { pairs: [row], selection: { ids: ["7"] }, count: 1 });
});
