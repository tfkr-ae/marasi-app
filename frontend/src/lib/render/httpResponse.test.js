import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlText, parseRawResponse } from "./httpResponse.js";

const enc = (s) => new TextEncoder().encode(s);

test("parseRawResponse splits HTTP/1.1 CRLF response and preserves binary body containing CRLFCRLF", () => {
  const head = enc("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 14\r\n\r\n");
  const body = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0xff, 0xfe, 0x01, 0x02, 0x03]);
  const raw = new Uint8Array(head.length + body.length);
  raw.set(head, 0);
  raw.set(body, head.length);

  const parsed = parseRawResponse(raw);
  assert.equal(parsed.statusCode, 200);
  assert.equal(parsed.contentType, "image/png");
  assert.equal(parsed.charset, "");
  assert.deepEqual(parsed.contentEncodings, []);
  assert.deepEqual([...parsed.bodyBytes], [...body]);
});

test("parseRawResponse handles LF-only delimiters and multi-line Content-Encoding", () => {
  const raw = enc(
    "HTTP/1.1 200 OK\nContent-Type: text/html; charset=ISO-8859-1\nContent-Encoding: gzip, identity\nContent-Encoding: br\n\n<h1>Hi</h1>",
  );
  const parsed = parseRawResponse(raw);
  assert.equal(parsed.statusCode, 200);
  assert.equal(parsed.contentType, "text/html");
  assert.equal(parsed.charset, "ISO-8859-1");
  assert.deepEqual(parsed.contentEncodings, ["gzip", "br"]);
  assert.equal(new TextDecoder().decode(parsed.bodyBytes), "<h1>Hi</h1>");
});

test("parseRawResponse handles Marasi HTTP/2 text form with :pseudo-headers", () => {
  const raw = enc(
    "HTTP/2 200\r\n:status: 200\r\ncontent-type: text/html; charset=\"utf-8\"\r\ncontent-encoding: zstd\r\n\r\n<p>h2</p>",
  );
  const parsed = parseRawResponse(raw);
  assert.equal(parsed.statusCode, 200);
  assert.equal(parsed.contentType, "text/html");
  assert.equal(parsed.charset, "utf-8");
  assert.deepEqual(parsed.contentEncodings, ["zstd"]);
  assert.equal(new TextDecoder().decode(parsed.bodyBytes), "<p>h2</p>");
});

test("parseRawResponse handles empty bodies (204 / 304) and headerless payloads with fallbacks", () => {
  const empty = parseRawResponse(enc("HTTP/1.1 204 No Content\r\nDate: Sat, 28 Nov 2026 00:00:00 GMT\r\n\r\n"));
  assert.equal(empty.statusCode, 204);
  assert.equal(empty.bodyBytes.length, 0);

  const headerless = parseRawResponse(enc("<html><body>Raw</body></html>"), {
    fallbackContentType: "text/html; charset=utf-8",
    fallbackStatusCode: 200,
  });
  assert.equal(headerless.hasHead, false);
  assert.equal(headerless.statusCode, 200);
  assert.equal(headerless.contentType, "text/html");
  assert.equal(new TextDecoder().decode(headerless.bodyBytes), "<html><body>Raw</body></html>");
});

test("decodeHtmlText honors explicit charset, sniffs <meta charset>, and falls back cleanly to utf-8", () => {
  // ISO-8859-1 / windows-1252 byte 0xE9 = é
  const latin1Bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
  assert.equal(decodeHtmlText(latin1Bytes, { charset: "iso-8859-1" }), "café");

  const metaHtml = Uint8Array.from([...enc('<meta charset="windows-1252">caf'), 0xe9]);
  assert.equal(decodeHtmlText(metaHtml), '<meta charset="windows-1252">café');

  // Unknown charset label safely falls back to UTF-8
  assert.equal(decodeHtmlText(enc("café"), { charset: "nonexistent-charset-xyz" }), "café");
});
