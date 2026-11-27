import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToQuery, hasQueryTerm, QUERY_FIELDS, toggleQueryTerm } from "./ledgerQueryFields.js";

test("toggling a term into an empty query makes it the whole query", () => {
  assert.equal(toggleQueryTerm("", "note:*"), "note:*");
});

test("toggling a term the query lacks appends it after one space", () => {
  assert.equal(toggleQueryTerm("status_code >= 500", "note:*"), "status_code >= 500 note:*");
});

test("toggling a term the query has removes it and keeps the rest as typed", () => {
  assert.equal(toggleQueryTerm('host = "a.test"   note:*  method = "GET"', "note:*"), 'host = "a.test"   method = "GET"');
  assert.equal(toggleQueryTerm("note:*", "note:*"), "");
});

test("removing a term also removes the AND that joined it", () => {
  assert.equal(toggleQueryTerm("status_code >= 500 AND note:*", "note:*"), "status_code >= 500");
  assert.equal(toggleQueryTerm("note:* AND status_code >= 500", "note:*"), "status_code >= 500");
});

test("a term spanning several words is found and removed whole", () => {
  assert.ok(hasQueryTerm("finding:* highlight = 3", "highlight = 3"));
  assert.equal(toggleQueryTerm("highlight = 3 finding:*", "highlight = 3"), "finding:*");
});

test("a term inside quotes, joined by OR or negated is not the term itself", () => {
  assert.ok(!hasQueryTerm('note:"note:*"', "note:*"));
  assert.ok(!hasQueryTerm("finding:* OR note:*", "note:*"));
  assert.ok(!hasQueryTerm("note:* OR finding:*", "note:*"));
  assert.ok(!hasQueryTerm("NOT note:*", "note:*"));
  assert.ok(!hasQueryTerm("-note:*", "note:*"));
  assert.ok(!hasQueryTerm("(note:* host = \"a\")", "note:*"));
  assert.equal(toggleQueryTerm("NOT note:*", "note:*"), "NOT note:* note:*");
});

test("an example inserted into an empty query box becomes the whole query", () => {
  assert.equal(appendToQuery("", 'host = "*.acme.test"'), 'host = "*.acme.test"');
});

test("an example is appended to existing query text after one space", () => {
  assert.equal(appendToQuery("status_code >= 500", 'method = "POST"'), 'status_code >= 500 method = "POST"');
});

test("no extra space is added when the query text already ends in whitespace", () => {
  assert.equal(appendToQuery("status_code >= 500 ", 'method = "POST"'), 'status_code >= 500 method = "POST"');
});

test("the field list documents launchpad membership in its three forms", () => {
  const field = QUERY_FIELDS.find((f) => f.name === "launchpad");
  assert.ok(field, "launchpad field listed");
  assert.deepEqual(field.ops, ["=", "!=", ":"]);
  assert.equal(field.example, "launchpad:*");
  for (const form of ['launchpad = "<uuid>"', 'launchpad != "<uuid>"', "launchpad:*"]) {
    assert.ok(field.help.includes(form), `help mentions ${form}`);
  }
});

test("the field list documents id with = and != against a quoted UUID", () => {
  const field = QUERY_FIELDS.find((f) => f.name === "id");
  assert.ok(field, "id field listed");
  assert.deepEqual(field.ops, ["=", "!="]);
  assert.match(field.example, /^id = "[0-9a-f-]{36}"$/);
  for (const form of ['id = "<uuid>"', 'id != "<uuid>"']) assert.ok(field.help.includes(form), `help mentions ${form}`);
});

test("the field list documents status_code presence with :*", () => {
  const field = QUERY_FIELDS.find((f) => f.name === "status_code");
  assert.ok(field, "status_code field listed");
  assert.deepEqual(field.ops, ["=", "!=", "<", "<=", ">", ">=", ":"]);
  assert.deepEqual(field.values, { ":": ["*"] });
  assert.equal(field.example, "status_code >= 500");
  for (const form of ["status_code:*", "NOT status_code:*"]) {
    assert.ok(field.help.includes(form), `help mentions ${form}`);
  }
});
