import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToQuery } from "./ledgerQueryFields.js";

test("an example inserted into an empty query box becomes the whole query", () => {
  assert.equal(appendToQuery("", 'host = "*.acme.test"'), 'host = "*.acme.test"');
});

test("an example is appended to existing query text after one space", () => {
  assert.equal(appendToQuery("status_code >= 500", 'method = "POST"'), 'status_code >= 500 method = "POST"');
});

test("no extra space is added when the query text already ends in whitespace", () => {
  assert.equal(appendToQuery("status_code >= 500 ", 'method = "POST"'), 'status_code >= 500 method = "POST"');
});
