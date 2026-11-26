import { test } from "node:test";
import assert from "node:assert/strict";
import { choosesFirstSuggestion, explicitCompletion, queryErrorRange, querySuggestions } from "./ledgerQueryEditor.js";

// Ticket 06 supplies the real list; any list works here.
const READY_MADE_QUERIES = [
  { label: "Server errors", query: "status_code >= 500" },
  { label: "In any launchpad", query: "launchpad:*" },
];

const labels = (r) => r?.options.map((o) => o.label);

test("an empty query box offers the ready-made queries, replacing the whole query", () => {
  const r = querySuggestions("", 0, false, READY_MADE_QUERIES);
  assert.deepEqual(labels(r), READY_MADE_QUERIES.map((q) => q.label));
  assert.equal(r.options[0].insert, "status_code >= 500");
  assert.deepEqual([r.from, r.to], [0, 0]);
});

test("ready-made queries open on request only once the box holds text elsewhere", () => {
  assert.equal(querySuggestions("", 12, false, READY_MADE_QUERIES), null);
  assert.equal(querySuggestions("", 12, true, READY_MADE_QUERIES).to, 12);
});

test("field names match by prefix only", () => {
  assert.deepEqual(labels(querySuggestions("sta", 3)), ["status_code"]);
  assert.deepEqual(labels(querySuggestions("request_", 8)), ["request_framing", "request_head", "request_body"]);
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

test("without ready-made queries an empty box offers the fields on request only", () => {
  assert.equal(querySuggestions("", 0, false), null);
  assert.ok(labels(querySuggestions("", 0, true)).includes("highlight"));
});

test("the nightly's fields are suggested by prefix", () => {
  assert.deepEqual(labels(querySuggestions("hi", 2)), ["highlight"]);
  assert.deepEqual(labels(querySuggestions("si", 2)), ["sitemap"]);
  assert.deepEqual(labels(querySuggestions("fi", 2)), ["finding"]);
  assert.deepEqual(labels(querySuggestions("te", 2)), ["test_case"]);
  assert.deepEqual(labels(querySuggestions("le", 2)), ["length"]);
});

test("number is the pair number, compared as a whole number", () => {
  assert.deepEqual(labels(querySuggestions("nu", 2)), ["number"]);
  assert.deepEqual(labels(querySuggestions("number ", 7)), ["=", "!=", "<", "<=", ">", ">="]);
  assert.deepEqual(labels(querySuggestions("number = ", 9)), ["10"]);
});

test("length compares as a whole number", () => {
  assert.deepEqual(labels(querySuggestions("length ", 7)), ["=", "!=", "<", "<=", ">", ">="]);
  assert.deepEqual(labels(querySuggestions("length > ", 9)), ["100000"]);
});

test("highlight takes a colour number, or :* for any highlight", () => {
  assert.deepEqual(labels(querySuggestions("highlight ", 10)), ["=", "!=", ":"]);
  assert.deepEqual(labels(querySuggestions("highlight = ", 12)), ["1"]);
  assert.deepEqual(labels(querySuggestions("highlight:", 10)), ["*"]);
  assert.equal(querySuggestions("highlight:*", 11), null);
});

test("link fields offer * after the colon, and no made-up uuid after =", () => {
  for (const field of ["launchpad", "finding", "test_case"]) {
    assert.deepEqual(labels(querySuggestions(`${field} `, field.length + 1)), ["=", "!=", ":"]);
    assert.deepEqual(labels(querySuggestions(`${field}:`, field.length + 1)), ["*"]);
    assert.equal(querySuggestions(`${field} = `, field.length + 3), null);
  }
});

test("streamed takes only :*, which NOT negates", () => {
  assert.deepEqual(labels(querySuggestions("stre", 4)), ["streamed"]);
  assert.deepEqual(labels(querySuggestions("streamed ", 9)), [":"]);
  assert.deepEqual(labels(querySuggestions("streamed:", 9)), ["*"]);
  assert.deepEqual(labels(querySuggestions("NOT streamed:", 13)), ["*"]);
  assert.equal(querySuggestions("streamed:*", 10), null);
});

test("request_framing and response_framing offer each framing, and * for any", () => {
  for (const field of ["request_framing", "response_framing"]) {
    assert.deepEqual(labels(querySuggestions(`${field} `, field.length + 1)), ["=", "!="]);
    const values = labels(querySuggestions(`${field} = `, field.length + 3));
    assert.deepEqual(values, ['"grpc"', '"grpc-web"', '"connect"', '"sse"', '"ndjson"', '"*"']);
    assert.deepEqual(labels(querySuggestions(`${field} != `, field.length + 4)), values);
  }
  assert.deepEqual(labels(querySuggestions("response_", 9)), ["response_framing", "response_head", "response_body"]);
});

test("sitemap takes a quoted node name", () => {
  assert.deepEqual(labels(querySuggestions("sitemap ", 8)), ["=", "!="]);
  assert.deepEqual(labels(querySuggestions('sitemap = "', 11)), ['"https://api.acme.test/v2"']);
});

test("note offers text to search for, or * for any note", () => {
  assert.deepEqual(labels(querySuggestions("note:", 5)), ['"idor"', "*"]);
  assert.equal(querySuggestions("note:*", 6), null);
});

test("metadata.<key> offers * after the colon for a key that is present", () => {
  assert.deepEqual(labels(querySuggestions("metadata.extension ", 19)), ["=", "!=", ":"]);
  assert.deepEqual(labels(querySuggestions("metadata.extension:", 19)), ["*"]);
  assert.deepEqual(labels(querySuggestions("metadata.extension = ", 21)), ['"workshop"']);
});

// The underline covers the word starting at Marasi's 1-based position, as
// offsets into the editor's text.
test("the error underline covers the word at Marasi's 1-based position", () => {
  const doc = 'status_code >= 500 AND bogus = "x"';
  assert.deepEqual(queryErrorRange(doc, { position: 24, message: "unknown field" }), { from: 23, to: 28 });
  assert.equal(doc.slice(23, 28), "bogus");
});

test("the underline stops at a parenthesis", () => {
  assert.deepEqual(queryErrorRange("(host = x)", { position: 9, message: "m" }), { from: 8, to: 9 });
});

test("Marasi counts characters, so the underline lands right after an emoji", () => {
  // "😀" is one character to Marasi but two UTF-16 units to the editor.
  const doc = 'note:"😀" AND bogus';
  assert.deepEqual(queryErrorRange(doc, { position: 14, message: "m" }), { from: 14, to: 19 });
  assert.equal(doc.slice(14, 19), "bogus");
});

test("an error past the end of the query underlines nothing", () => {
  assert.equal(queryErrorRange("host =", { position: 7, message: "expected a value" }), null);
});

test("an error with no position underlines nothing", () => {
  assert.equal(queryErrorRange("host = x", { position: 0, message: "bad exclusion" }), null);
  assert.equal(queryErrorRange("host = x", null), null);
});

test("a dotted metadata path is still a metadata field", () => {
  assert.deepEqual(labels(querySuggestions("metadata.auth.user ", 19)), ["=", "!=", ":"]);
});

// CodeMirror keeps a completion "explicit" while its list stays open, so the
// ready-made list opened on focus would make a pasted query offer every field
// after its closing quote, and Enter would append "host".
test("a request for suggestions is explicit only where it was made", () => {
  const explicit = explicitCompletion();
  assert.equal(explicit.at(true, 0), false);
  explicit.request(0);
  assert.equal(explicit.at(true, 0), true);
  const pasted = 'response_body:"quokka-live"';
  assert.equal(explicit.at(true, pasted.length), false);
  assert.equal(querySuggestions(pasted, pasted.length, explicit.at(true, pasted.length)), null);
  assert.equal(explicit.at(false, 0), false);
  explicit.request(pasted.length);
  assert.equal(explicit.at(true, pasted.length), true);
});

test("id offers = and !=, and no value, since only a real pair's UUID fits", () => {
  assert.ok(labels(querySuggestions("i", 1)).includes("id"));
  assert.deepEqual(labels(querySuggestions("id ", 3)), ["=", "!="]);
  assert.equal(querySuggestions("id = ", 5), null);
});

test("the suggestion list opens with nothing chosen in a blank box, so Enter runs it cleared", () => {
  assert.equal(choosesFirstSuggestion(""), false);
  assert.equal(choosesFirstSuggestion("   "), false);
  assert.equal(choosesFirstSuggestion("sta"), true);
});
