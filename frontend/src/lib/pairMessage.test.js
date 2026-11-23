import { test } from "node:test";
import assert from "node:assert/strict";
import { hasResponse, headerName, pairText, splitMessage } from "./pairMessage.js";

test("a pair's raw text takes LF line endings, as Send takes it from the Ledger", () => {
  assert.equal(pairText("GET / HTTP/1.1\r\nHost: a\r\n\r\nbody\r\n"), "GET / HTTP/1.1\nHost: a\n\nbody\n");
  assert.equal(pairText("a\nb"), "a\nb");
  assert.equal(pairText(null), "");
});

test("a message splits at the blank line after its headers", () => {
  assert.deepEqual(splitMessage("GET / HTTP/1.1\nHost: a\n\n{\"a\":1}\n"), { head: "GET / HTTP/1.1\nHost: a", body: '{"a":1}\n', hasBody: true });
  assert.deepEqual(splitMessage("GET / HTTP/1.1\nHost: a"), { head: "GET / HTTP/1.1\nHost: a", body: "", hasBody: false });
});

test("a header line's name, HTTP/2 pseudo-headers included", () => {
  assert.equal(headerName("Host: a"), "Host");
  assert.equal(headerName(":authority: api.example"), ":authority");
  assert.equal(headerName("no colon"), "");
});

test("a pair has a response once its row shows a status", () => {
  assert.equal(hasResponse({ StatusCode: 200 }), true);
  assert.equal(hasResponse({ StatusCode: 0 }), false);
  assert.equal(hasResponse({ StatusCode: -1 }), false);
  assert.equal(hasResponse(undefined), false);
});
