import { test } from "node:test";
import assert from "node:assert/strict";
import { querySuggestions } from "./ledgerQueryEditor.js";
import { READY_MADE_QUERIES } from "./ledgerQueryFields.js";

const labels = (r) => r?.options.map((o) => o.label);

test("an empty query box offers the ready-made queries, replacing the whole query", () => {
  const r = querySuggestions("", 0, false);
  assert.deepEqual(labels(r), READY_MADE_QUERIES.map((q) => q.label));
  assert.equal(r.options[0].insert, "status_code >= 500");
  assert.deepEqual([r.from, r.to], [0, 0]);
});

test("ready-made queries open on request only once the box holds text elsewhere", () => {
  assert.equal(querySuggestions("", 12, false), null);
  assert.equal(querySuggestions("", 12, true).to, 12);
});

test("field names match by prefix only", () => {
  assert.deepEqual(labels(querySuggestions("sta", 3)), ["status_code"]);
  assert.deepEqual(labels(querySuggestions("request_", 8)), ["request_head", "request_body"]);
  assert.deepEqual(labels(querySuggestions("met", 3)), ["method", "metadata.", "metadata"]);
});

test("keywords are offered alongside fields, ignoring case", () => {
  assert.deepEqual(labels(querySuggestions("status_code >= 500 an", 21)), ["AND"]);
});

test("a field followed by a space offers its operators, then continues", () => {
  const r = querySuggestions("status_code ", 12);
  assert.deepEqual(labels(r), ["=", "!=", "<", "<=", ">", ">="]);
  assert.equal(r.from, 12);
  assert.ok(r.options.every((o) => o.next));
});

test("a field and an operator offer the field's example value", () => {
  const r = querySuggestions("status_code >= ", 15);
  assert.deepEqual(labels(r), ["500"]);
  assert.deepEqual(labels(querySuggestions('request_body:"pa', 16)), ['"password"']);
  assert.equal(querySuggestions('request_body:"pa', 16).from, 13);
});

test("a field with only the : operator gets it when chosen", () => {
  const r = querySuggestions("request_b", 9);
  assert.equal(r.options[0].insert, "request_body:");
});

test("keywords followed by a space are not mistaken for fields", () => {
  assert.equal(querySuggestions("status_code >= 500 AND ", 23), null);
});

test("an unknown word offers nothing", () => {
  assert.equal(querySuggestions("eyJhbG", 6), null);
});

test("a finished value offers nothing, so Enter runs the query", () => {
  assert.equal(querySuggestions("status_code >= 500", 18), null);
  assert.equal(querySuggestions("status_code >= 404", 18), null);
  assert.equal(querySuggestions("launchpad:*", 11), null);
  assert.deepEqual(labels(querySuggestions("status_code >= 5", 16)), ["500"]);
});

test("a word typed in full is not offered back", () => {
  assert.equal(querySuggestions("status_code >= 500 AND", 22), null);
  assert.equal(querySuggestions("host", 4), null);
});
