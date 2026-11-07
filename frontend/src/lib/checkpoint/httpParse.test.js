import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { httpParseError } from "./httpParse.js";

// httpParse.cases.json holds what Go's net/http.ReadRequest and
// ReadResponse answered for each text, the check the app's Go side ran
// before (CheckHTTPParse). http_parse_cases_test.go at the repo root checks
// the file against Go, so the port and Go agree on every case.
const cases = JSON.parse(readFileSync(new URL("./httpParse.cases.json", import.meta.url), "utf8"));

test("the parse check gives Go's error for every recorded case", () => {
  const mismatches = cases
    .map((c) => ({ ...c, got: httpParseError(c.text, c.type) }))
    .filter((c) => c.got !== c.error)
    .map((c) => `${c.type} ${JSON.stringify(c.text)}\n  want ${JSON.stringify(c.error)}\n  got  ${JSON.stringify(c.got)}`);
  assert.deepEqual(mismatches, []);
});

test("an edited request or response that parses has no error", () => {
  assert.equal(httpParseError("GET /login HTTP/1.1\nHost: x\n\n", "request"), "");
  assert.equal(httpParseError("HTTP/1.1 302 Found\nLocation: /\n\n", "response"), "");
});

test("a request without the blank line after its headers is cut short", () => {
  assert.equal(httpParseError("GET / HTTP/1.1\nHost: x", "request"), "unexpected EOF");
});

test("WebSocket payloads aren't checked", () => {
  assert.equal(httpParseError("BROKEN", "websocket"), "");
});

test("a large body is not read", () => {
  const body = "x".repeat(5_000_000);
  const started = Date.now();
  assert.equal(httpParseError(`POST / HTTP/1.1\nContent-Length: 5000000\n\n${body}`, "request"), "");
  assert.ok(Date.now() - started < 200);
});
