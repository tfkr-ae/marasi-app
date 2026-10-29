import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount, matchCountText, matchNoun, plural, requestCount, unchangedText } from "./counts.js";

test("a count reads as a number, 100,000+ past the cap, a dash when unknown and ! when invalid", () => {
  assert.equal(matchCountText({ count: 1234, capped: false }), "1,234");
  assert.equal(matchCountText({ count: 100000, capped: true }), "100,000+");
  assert.equal(matchCountText(null), "–");
  assert.equal(matchCountText(undefined), "…");
  assert.equal(matchCountText({ error: "expected a value" }), "!");
  assert.equal(formatCount(100000, true), "100,000+");
});

test("plurals name one thing or many", () => {
  assert.equal(requestCount(1), "1 request");
  assert.equal(requestCount(1200), "1,200 requests");
  assert.equal(plural(2, "match", "matches"), "2 matches");
  assert.equal(matchNoun(1), "match");
  assert.equal(matchNoun(1, true), "matches");
  assert.equal(matchNoun(0), "matches");
});

test("a ⌘A change that touched nothing says why, for one, many or an uncounted selection", () => {
  assert.equal(
    unchangedText({ type: "highlight", name: "Red" }, 1200),
    'All 1,200 matching requests were already highlighted "Red"',
  );
  assert.equal(unchangedText({ type: "clear-highlight" }, 1200), "None of the 1,200 matching requests had a highlight");
  assert.equal(unchangedText({ type: "clear-highlight" }, 1), "The matching request had no highlight");
  assert.equal(unchangedText({ type: "clear-notes" }, null), "None of the matching requests had a note");
  assert.equal(unchangedText({ type: "add-to-launchpad", name: "Login" }, 3), 'All 3 matching requests were already in "Login"');
  assert.equal(unchangedText({ type: "remove-from-launchpad", name: "Login" }, 3), 'None of the 3 matching requests were in "Login"');
  assert.equal(
    unchangedText({ type: "link", noun: "finding", name: "IDOR" }, 1),
    'The matching request was already linked to finding "IDOR"',
  );
  assert.equal(
    unchangedText({ type: "unlink", noun: "test case", name: "Auth" }, 40),
    'None of the 40 matching requests were linked to test case "Auth"',
  );
  assert.equal(unchangedText({ type: "delete" }, 0), "No matching requests to change");
});

test("a change to picked requests that touched nothing drops \"matching\"", () => {
  assert.equal(
    unchangedText({ type: "link", noun: "finding", name: "IDOR" }, 3, "request"),
    'All 3 requests were already linked to finding "IDOR"',
  );
  assert.equal(
    unchangedText({ type: "unlink", noun: "test case", name: "Auth" }, 1, "request"),
    'The request wasn\'t linked to test case "Auth"',
  );
});
