import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heldProtocol, httpParseError } from "./httpParse.js";

// httpParse.cases.json holds what Marasi's Checkpoint rebuild answered for
// each text, recorded by scripts/record-checkpoint-parse-cases.sh at the
// marasi version go.mod pins (http_parse_cases_test.go at the repo root
// checks the version), so the port and Marasi agree on every case.
const { marasi, cases } = JSON.parse(readFileSync(new URL("./httpParse.cases.json", import.meta.url), "utf8"));

test("the cases were recorded from a marasi version", () => {
  assert.match(marasi, /^v\d/);
  assert.ok(cases.some((c) => c.protocol === "h2") && cases.some((c) => c.protocol === "http/1.1"));
});

test("the parse check gives Marasi's error for every recorded case", () => {
  const mismatches = cases
    .map((c) => ({ ...c, got: httpParseError(c.text, c.type, c.protocol) }))
    .filter((c) => c.got !== c.error)
    .map(
      (c) =>
        `${c.protocol} ${c.type} ${JSON.stringify(c.text)}\n  want ${JSON.stringify(c.error)}\n  got  ${JSON.stringify(c.got)}`,
    );
  assert.deepEqual(mismatches, []);
});

test("an edited request or response that parses has no error", () => {
  assert.equal(httpParseError("GET /login HTTP/1.1\nHost: x\n\n", "request"), "");
  assert.equal(httpParseError("HTTP/1.1 302 Found\nLocation: /\n\n", "response"), "");
  assert.equal(httpParseError("GET /login HTTP/2\r\n:authority: x\r\n\r\n", "request", "h2"), "");
  assert.equal(httpParseError("HTTP/2 302\r\nlocation: /\r\n\r\n", "response", "h2"), "");
});

test("a request without the blank line after its headers is cut short", () => {
  assert.equal(httpParseError("GET / HTTP/1.1\nHost: x", "request"), "reading the edited request head: unexpected EOF");
});

test("an HTTP/2 item is read in its text form, an HTTP/1.1 one by the codec", () => {
  assert.equal(
    httpParseError("GET / HTTP/2\n\n", "request"),
    'reading the edited request head: parsing request line "GET / HTTP/2": malformed message head',
  );
  assert.equal(
    httpParseError("GET / HTTP/1.1\nHost: x\n\n", "request", "h2"),
    'not an HTTP/2 message in the text form: the request line "GET / HTTP/1.1" is not METHOD target HTTP/2',
  );
});

test("a head past 1 MiB is too large", () => {
  const value = "a".repeat(1 << 20);
  assert.equal(
    httpParseError(`GET / HTTP/1.1\nX: ${value}\n\n`, "request"),
    "reading the edited request head: message head too large",
  );
  assert.equal(httpParseError(`GET / HTTP/1.1\nX: ${"é".repeat(1 << 19)}\n\n`, "request"), "reading the edited request head: message head too large");
  assert.equal(httpParseError(`GET / HTTP/2\nx: ${value}\n\n`, "request", "h2"), "");
});

test("the held raw text tells an HTTP/2 item", () => {
  assert.equal(heldProtocol("GET /a HTTP/2\r\n:authority: x\r\n\r\n", "request"), "h2");
  assert.equal(heldProtocol("HTTP/2 200\r\n\r\n", "response"), "h2");
  assert.equal(heldProtocol("GET /a HTTP/1.1\r\nHost: x\r\n\r\n", "request"), "http/1.1");
  assert.equal(heldProtocol("HTTP/1.1 200 OK\r\n\r\n", "response"), "http/1.1");
  assert.equal(heldProtocol("", "request"), "http/1.1");
});

test("WebSocket payloads aren't checked", () => {
  assert.equal(httpParseError("BROKEN", "websocket"), "");
});

test("a large body is not read", () => {
  const body = "x".repeat(5_000_000);
  for (const [head, protocol] of [
    ["POST / HTTP/1.1\nContent-Length: 5000000\n\n", "http/1.1"],
    ["POST / HTTP/2\ncontent-length: 5000000\n\n", "h2"],
  ]) {
    const started = Date.now();
    assert.equal(httpParseError(`${head}${body}`, "request", protocol), "");
    assert.ok(Date.now() - started < 200);
  }
});
