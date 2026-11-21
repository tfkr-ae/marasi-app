import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORD_KINDS, isRecordKind, recordLabel, recordName, recordsOf } from "./recordKinds.js";

test("findings and test cases each have one label, used everywhere", () => {
  assert.deepEqual(Object.keys(RECORD_KINDS), ["finding", "testCase"]);
  assert.equal(recordLabel("finding"), "Finding");
  assert.equal(recordLabel("testCase"), "Test case");
  assert.equal(recordLabel("pair"), "Pair");
  assert.equal(isRecordKind("testCase"), true);
  assert.equal(isRecordKind("pair"), false);
});

test("a record's name is its title, or Untitled and its kind", () => {
  assert.equal(recordName("finding", { Title: "SQL injection" }), "SQL injection");
  assert.equal(recordName("finding", { Title: "" }), "Untitled finding");
  assert.equal(recordName("testCase", {}), "Untitled test case");
});

test("the Logbook state's list for a kind", () => {
  const state = { findings: [1], testCases: [2] };
  assert.deepEqual(recordsOf(state, "finding"), [1]);
  assert.deepEqual(recordsOf(state, "testCase"), [2]);
});
