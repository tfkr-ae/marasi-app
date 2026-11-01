// The parse check v1 ran in Go (http.ReadRequest, http.ReadResponse). The
// expected messages are what Go 1.25 answers for each text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHTTPParse } from "./httpParse.js";

// [text, what Go answers]: "" when it parses.
const requests = [
  ["GET / HTTP/1.1\r\nHost: x\r\n\r\n", ""],
  ["GET / HTTP/1.1\nHost: x\n\n", ""],
  ["GET / HTTP/1.1\nHost: x\n\nbody here", ""],
  ["", "EOF"],
  ["GET / HTTP/1.1", "unexpected EOF"],
  ["GET / HTTP/1.1\nHost: x\n", "unexpected EOF"],
  ["GET /", "malformed HTTP request \"GET /\""],
  ["GET / HTTP/1.1 extra\n\n", "malformed HTTP version \"HTTP/1.1 extra\""],
  ["G@T / HTTP/1.1\n\n", "invalid method \"G@T\""],
  ["GET / HTTP/2\n\n", "malformed HTTP version \"HTTP/2\""],
  ["GET / HTTP/1.x\n\n", "malformed HTTP version \"HTTP/1.x\""],
  ["GET / HTTP/3.0\n\n", ""],
  ["GET foo HTTP/1.1\n\n", "parse \"foo\": invalid URI for request"],
  ["GET * HTTP/1.1\n\n", ""],
  ["GET http://x/y HTTP/1.1\n\n", ""],
  ["CONNECT x:443 HTTP/1.1\n\n", ""],
  ["GET / HTTP/1.1\nHost x\n\n", "malformed MIME header: missing colon: \"Host x\""],
  ["GET / HTTP/1.1\n Host: x\n\n", "malformed MIME header initial line:  Host: x"],
  ["GET / HTTP/1.1\nHost: x\n  folded\n\n", ""],
  ["GET / HTTP/1.1\nBad Key: x\n\n", ""],
  ["GET / HTTP/1.1\nKey : x\n\n", ""],
  ["GET / HTTP/1.1\n: x\n\n", "malformed MIME header line: : x"],
  ["GET / HTTP/1.1\nContent-Length: abc\n\n", "bad Content-Length \"abc\""],
  ["GET / HTTP/1.1\nContent-Length: 1\nContent-Length: 2\n\n", "http: message cannot contain multiple Content-Length headers; got [\"1\" \"2\"]"],
  ["GET / HTTP/1.1\nContent-Length: 1\nContent-Length: 1\n\n", ""],
  ["GET / HTTP/1.1\nContent-Length: -1\n\n", "bad Content-Length \"-1\""],
  ["GET / HTTP/1.1\nTransfer-Encoding: gzip\n\n", "unsupported transfer encoding: \"gzip\""],
  ["GET / HTTP/1.1\nTransfer-Encoding: chunked\n\n", ""],
  ["GET / HTTP/1.1\nTransfer-Encoding: chunked\nTransfer-Encoding: chunked\n\n", "too many transfer encodings: [\"chunked\" \"chunked\"]"],
  ["GET / HTTP/1.0\nTransfer-Encoding: gzip\n\n", ""],
  ["GET /a b HTTP/1.1\n\n", "malformed HTTP version \"b HTTP/1.1\""],
  ["GET /\u0001 HTTP/1.1\n\n", "parse \"/\\x01\": net/url: invalid control character in URL"],
  ["GET / HTTP/1.1\nX: a\u0001b\n\n", "malformed MIME header line: X: a\u0001b"],
  ["GET  / HTTP/1.1\n\n", "malformed HTTP version \"/ HTTP/1.1\""],
  [" GET / HTTP/1.1\n\n", "invalid method \"\""],
  ["GET  HTTP/1.1\n\n", "parse \"\": empty url"],
  ["GET /a%zz HTTP/1.1\n\n", "parse \"/a%zz\": invalid URL escape \"%zz\""],
  ["GET /a%2 HTTP/1.1\n\n", "parse \"/a%2\": invalid URL escape \"%2\""],
  ["GET /a%20b?x=%zz HTTP/1.1\n\n", ""],
  ["GET 1http://x/ HTTP/1.1\n\n", "parse \"1http://x/\": invalid URI for request"],
  ["GET :x HTTP/1.1\n\n", "parse \":x\": missing protocol scheme"],
  ["GET http://x:abc/ HTTP/1.1\n\n", "parse \"http://x:abc/\": invalid port \":abc\" after host"],
  ["GET http://[::1/ HTTP/1.1\n\n", "parse \"http://[::1/\": missing ']' in host"],
  ["GET http://[::1]:80/ HTTP/1.1\n\n", ""],
  ["GET mailto:x HTTP/1.1\n\n", ""],
  ["GET / HTTP/1.1\nContent-Length:\n\n", "invalid empty Content-Length \"\""],
  ["GET / HTTP/1.1\nContent-Length: +1\n\n", "bad Content-Length \"+1\""],
  ["GET / HTTP/1.1\nContent-Length: 99999999999999999999\n\n", "bad Content-Length \"99999999999999999999\""],
  ["GET / HTTP/1.1\ncontent-length: 1\nContent-Length: 2\n\n", "http: message cannot contain multiple Content-Length headers; got [\"1\" \"2\"]"],
  ["GET / HTTP/1.1\ntransfer-encoding: Chunked\n\n", ""],
  ["GET / HTTP/1.1\nTransfer-Encoding: chunked\nTrailer: Content-Length\n\n", "bad trailer key \"Content-Length\""],
  ["GET / HTTP/1.1\nTrailer: Content-Length\n\n", ""],
  ["GET / HTTP/1.1\nX: a\n\tb\n\n", ""],
  ["GET / HTTP/1.1\r\nHost: x\r\n", "unexpected EOF"],
  ["GET / HTTP/1.1\nHost:x\n\n", ""],
  ["GET / HTTP/1.1\nX: a\n\n", "malformed MIME header line: X: a"],
  ["GET / HTTP/1.1\nX: �\n\n", ""],
];
const responses = [
  ["HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", ""],
  ["HTTP/1.1 200 OK\n\n", ""],
  ["HTTP/1.1 200\n\n", ""],
  ["HTTP/1.1  200 OK\n\n", ""],
  ["", "unexpected EOF"],
  ["HTTP/1.1\n\n", "malformed HTTP response \"HTTP/1.1\""],
  ["HTTP/1.1 20 OK\n\n", "malformed HTTP status code \"20\""],
  ["HTTP/1.1 abc OK\n\n", "malformed HTTP status code \"abc\""],
  ["HTTP/1.1 2000 OK\n\n", "malformed HTTP status code \"2000\""],
  ["HTTP/1.1 -10 OK\n\n", "malformed HTTP status code \"-10\""],
  ["HTTP/9 200 OK\n\n", "malformed HTTP version \"HTTP/9\""],
  ["HTTP/1.1 200 OK\nBroken\n\n", "malformed MIME header: missing colon: \"Broken\""],
  ["HTTP/1.1 200 OK\nContent-Length: x\n\n", "bad Content-Length \"x\""],
  ["HTTP/1.1 200 OK\nTransfer-Encoding: gzip\n\n", "unsupported transfer encoding: \"gzip\""],
  ["HTTP/1.1 200 OK", "unexpected EOF"],
  ["HTTP/1.1 204 No Content\nContent-Length: x\n\n", "bad Content-Length \"x\""],
  ["HTTP/1.1 200 OK\nContent-Length: 1\nContent-Length: 2\n\n", "http: message cannot contain multiple Content-Length headers; got [\"1\" \"2\"]"],
  ["HTTP/1.0 200 OK\nTransfer-Encoding: gzip\n\n", ""],
  ["HTTP/1.1 200 OK\n Folded: x\n\n", "malformed MIME header initial line:  Folded: x"],
  ["HTTP/1.1 999 Odd\n\n", ""],
];

test("a held request's edit parses as Go's http.ReadRequest would", () => {
  for (const [text, error] of requests) assert.equal(checkHTTPParse(text, "request"), error, JSON.stringify(text));
});

test("a held response's edit parses as Go's http.ReadResponse would", () => {
  for (const [text, error] of responses) assert.equal(checkHTTPParse(text, "response"), error, JSON.stringify(text));
});

test("a WebSocket payload is never parsed", () => {
  assert.equal(checkHTTPParse("not HTTP", "websocket"), "");
});
