import { test } from "node:test";
import assert from "node:assert/strict";
import { DETAIL_LINES, cardContent } from "./cardContent.js";
import { SEVERITY_BADGE } from "../logbook/severityColors.js";
import { METHOD_CLASS, statusClass, tertiaryVariant } from "../launchpad/format.js";

const palette = [{ number: 2, label: "Auth", color: "#7c3aed" }];
const texts = (content) => content.chips.map((chip) => chip.text);

test("a pair card shows number, method, status and highlight, then path, host and the facts line", () => {
  const pair = {
    ID: "p1", Number: 42, Method: "POST", StatusCode: 302, Highlight: 2, Scheme: "https", Host: "api.example.com",
    Path: "/login?next=/", ContentType: "text/html; charset=utf-8", Length: 2048, ClientProtocol: "h2", OriginProtocol: "http/1.1",
  };
  const content = cardContent({ kind: "pair", id: "p1" }, pair, { palette, light: true });
  assert.equal(content.label, "Pair");
  assert.deepEqual(texts(content), ["#42", "POST", "302", "Auth"]);
  assert.equal(content.chips[1].classes, METHOD_CLASS.POST);
  assert.ok(content.chips[2].classes.includes(statusClass(302)));
  assert.equal(content.chips[3].color, "#7c3aed");
  assert.equal(content.accent.color, "#7c3aed");
  assert.deepEqual(content.title, { text: "/login?next=/", mono: true });
  assert.equal(content.lines[0].text, "https://api.example.com");
  assert.equal(content.footer, "html · 2.0 KB · h2→1.1");
});

test("a pending pair says so", () => {
  const content = cardContent({ kind: "pair", id: "p1" }, { Number: 1, Method: "GET", StatusCode: 0, Path: "/" }, { palette });
  assert.equal(texts(content)[2], "pending");
});

test("a finding card shows its severity badge, CVSS, title, write-up and counts", () => {
  const finding = {
    ID: "f1", Title: "SQL injection in login", Severity: "Critical", CVSSScore: 9.81, WriteUp: "The  username\nfield is concatenated",
    Requests: ["a", "b"], Artifacts: [{ ID: "x" }],
  };
  const content = cardContent({ kind: "finding", id: "f1" }, finding, { palette });
  assert.equal(content.label, "Finding");
  assert.deepEqual(texts(content), ["Critical", "CVSS 9.8"]);
  assert.equal(content.chips[0].classes, SEVERITY_BADGE.Critical);
  assert.equal(content.title.text, "SQL injection in login");
  assert.equal(content.lines[0].text, "The username field is concatenated");
  assert.equal(content.footer, "2 pairs · 1 artifact");
});

test("a finding with no severity has the Logbook's no-severity badge", () => {
  const content = cardContent({ kind: "finding", id: "f2" }, { ID: "f2", Title: "Open redirect", Severity: "" });
  assert.equal(content.chips[0].text, "No severity");
  // As LogbookSummary, LogbookRecord and RecordChecklist draw it.
  assert.equal(content.chips[0].classes, "variant-soft");
});

test("a test case card shows its category in the tertiary variant, all its tags, and its counts", () => {
  const testCase = {
    ID: "t1", Title: "Login rate limit", Category: "Authentication", Tags: ["login", "rate", "brute", "extra"],
    Description: "Try 100 logins", Requests: ["a"], Artifacts: [],
  };
  const light = cardContent({ kind: "testCase", id: "t1" }, testCase, { palette, light: true, findingCount: 3 });
  assert.deepEqual(texts(light), ["Authentication", "#login", "#rate", "#brute", "#extra"]);
  assert.equal(light.chips[0].classes, tertiaryVariant(true));
  assert.equal(light.footer, "1 pair · 3 findings · 0 artifacts");
  const dark = cardContent({ kind: "testCase", id: "t1" }, testCase, { palette, light: false });
  assert.equal(dark.chips[0].classes, tertiaryVariant(false));
});

// A pair's raw messages as the Ledger shows them (LF line endings).
const rawPair = {
  ID: "p9", Number: 41, Method: "POST", StatusCode: 200, Scheme: "https", Host: "api.shop.example", Path: "/v2/auth/login",
};
const raw = {
  Request: 'POST /v2/auth/login HTTP/1.1\nHost: api.shop.example\nContent-Type: application/json\n\n{"username":"alice"}',
  Response: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"token":"abc"}',
};
const pairSource = { kind: "pair", id: "p9" };

test("a pair card with no view holds the request and shows its request line", () => {
  const content = cardContent(pairSource, rawPair, { palette, raw });
  assert.deepEqual(content.parts, ["request"]);
  assert.equal(content.part, "request");
  assert.deepEqual(content.firstLines, [{ part: "request", text: "POST /v2/auth/login HTTP/1.1" }]);
  assert.equal(content.label, "Pair");
});

test("a card holding the response shows the status line; one holding both shows the request line first", () => {
  const response = cardContent(pairSource, rawPair, { palette, raw, view: { part: "response", expanded: false } });
  assert.deepEqual(response.parts, ["response"]);
  assert.equal(response.partName, "Response");
  assert.deepEqual(response.firstLines, [{ part: "response", text: "HTTP/1.1 200 OK" }]);
  assert.equal(response.hasResponse, true);

  const both = cardContent(pairSource, rawPair, { palette, raw, view: { part: "both", expanded: false } });
  assert.deepEqual(both.parts, ["request", "response"]);
  assert.equal(both.partName, "Request + Response");
  assert.deepEqual(both.firstLines, [
    { part: "request", text: "POST /v2/auth/login HTTP/1.1" },
    { part: "response", text: "HTTP/1.1 200 OK" },
  ]);
});

test("first lines come from CRLF messages and HTTP/2 start lines as the Ledger shows them", () => {
  const h2 = { Request: "GET /a HTTP/2\r\n:authority: x\r\n\r\n", Response: "HTTP/2 404 Not Found\r\n\r\n" };
  const content = cardContent(pairSource, { ...rawPair, StatusCode: 404 }, { raw: h2, view: { part: "both" } });
  assert.deepEqual(content.firstLines.map((line) => line.text), ["GET /a HTTP/2", "HTTP/2 404 Not Found"]);
});

test("a pending pair has no response to offer: its response line says so", () => {
  const pending = { ...rawPair, StatusCode: 0 };
  const pendingRaw = { Request: raw.Request, Response: "" };
  const request = cardContent(pairSource, pending, { raw: pendingRaw });
  assert.equal(request.hasResponse, false);
  const both = cardContent(pairSource, pending, { raw: pendingRaw, view: { part: "both" } });
  assert.deepEqual(both.firstLines, [
    { part: "request", text: "POST /v2/auth/login HTTP/1.1" },
    { part: "response", text: "No response yet" },
  ]);
});

test("a pair card shows no first lines until its raw messages are read", () => {
  const content = cardContent(pairSource, rawPair, { palette });
  assert.deepEqual(content.parts, ["request"]);
  assert.deepEqual(content.firstLines, []);
});

test("a deleted pair's card has no parts, no first lines and no part name", () => {
  const content = cardContent(pairSource, null, { raw, view: { part: "both" } });
  assert.equal(content.deleted, true);
  assert.equal(content.parts, undefined);
  assert.equal(content.firstLines, undefined);
  assert.equal(content.partName, undefined);
});

test("finding and test case cards have no parts", () => {
  const finding = cardContent({ kind: "finding", id: "f" }, { ID: "f", Title: "X" }, { raw, view: { part: "both" } });
  const testCase = cardContent({ kind: "testCase", id: "t" }, { ID: "t", Title: "Y" }, { raw, view: { part: "both" } });
  for (const content of [finding, testCase]) {
    assert.equal(content.parts, undefined);
    assert.equal(content.firstLines, undefined);
  }
});

test("a collapsed card has no details", () => {
  assert.equal(cardContent(pairSource, rawPair, { raw, view: { part: "both", expanded: false } }).details, undefined);
});

test("an expanded card shows each part it holds in a labelled box: start line, headers, a gap, then the body", () => {
  const content = cardContent(pairSource, rawPair, { raw, view: { part: "both", expanded: true } });
  assert.equal(content.expanded, true);
  assert.deepEqual(content.details, [
    {
      part: "request",
      title: "Request",
      lines: [
        { text: "POST /v2/auth/login HTTP/1.1", kind: "start" },
        { text: "Host: api.shop.example", kind: "header", name: "Host" },
        { text: "Content-Type: application/json", kind: "header", name: "Content-Type" },
        { text: "", kind: "gap" },
        { text: '{"username":"alice"}', kind: "body" },
      ],
    },
    {
      part: "response",
      title: "Response",
      lines: [
        { text: "HTTP/1.1 200 OK", kind: "start" },
        { text: "Content-Type: application/json", kind: "header", name: "Content-Type" },
        { text: "", kind: "gap" },
        { text: '{"token":"abc"}', kind: "body" },
      ],
    },
  ]);
});

test("an expanded card holding only the response shows only its box; a message with no body has no gap", () => {
  const content = cardContent(pairSource, rawPair, {
    raw: { Request: raw.Request, Response: "HTTP/1.1 204 No Content\nServer: x\n\n" },
    view: { part: "response", expanded: true },
  });
  assert.deepEqual(content.details, [
    {
      part: "response",
      title: "Response",
      lines: [
        { text: "HTTP/1.1 204 No Content", kind: "start" },
        { text: "Server: x", kind: "header", name: "Server" },
      ],
    },
  ]);
});

test("a long message stops at the line cap with how many more lines it has", () => {
  const body = Array.from({ length: 40 }, (_, i) => `  "line${i}": ${i},`).join("\n");
  const long = { Request: `POST /bulk HTTP/1.1\nHost: a\n\n${body}`, Response: "" };
  const [request] = cardContent(pairSource, { ...rawPair, StatusCode: 0 }, { raw: long, view: { part: "request", expanded: true } }).details;
  // start + header + gap + 40 body lines = 43
  assert.equal(request.lines.length, DETAIL_LINES + 1);
  assert.deepEqual(request.lines.at(-1), { text: `+${43 - DETAIL_LINES} more lines`, kind: "more" });
  assert.deepEqual(request.lines[3], { text: '  "line0": 0,', kind: "body" }, "a body line keeps its indentation");
});

test("a message just at the cap is shown whole", () => {
  const body = Array.from({ length: DETAIL_LINES - 3 }, (_, i) => `b${i}`).join("\n");
  const [request] = cardContent(pairSource, rawPair, {
    raw: { Request: `GET / HTTP/1.1\nHost: a\n\n${body}`, Response: "" },
    view: { part: "request", expanded: true },
  }).details;
  assert.equal(request.lines.length, DETAIL_LINES);
  assert.ok(request.lines.every((line) => line.kind !== "more"));
});

test("an HTTP/2 message keeps its pseudo-header field lines, named with their colon", () => {
  const h2 = { Request: "GET /a HTTP/2\r\n:authority: x.example\r\n:path: /a\r\naccept: */*\r\n\r\n", Response: "HTTP/2 404 Not Found\r\n\r\n" };
  const [request] = cardContent(pairSource, { ...rawPair, StatusCode: 404 }, { raw: h2, view: { part: "request", expanded: true } }).details;
  assert.deepEqual(request.lines, [
    { text: "GET /a HTTP/2", kind: "start" },
    { text: ":authority: x.example", kind: "header", name: ":authority" },
    { text: ":path: /a", kind: "header", name: ":path" },
    { text: "accept: */*", kind: "header", name: "accept" },
  ]);
});

test("an expanded card's response box says when there is no response yet", () => {
  const content = cardContent(pairSource, { ...rawPair, StatusCode: 0 }, {
    raw: { Request: raw.Request, Response: "" },
    view: { part: "both", expanded: true },
  });
  assert.deepEqual(content.details[1], { part: "response", title: "Response", lines: [], empty: "No response yet" });
});

test("an expanded card has no details until its raw messages are read, and a deleted pair none at all", () => {
  assert.equal(cardContent(pairSource, rawPair, { view: { part: "both", expanded: true } }).details, undefined);
  assert.equal(cardContent(pairSource, null, { raw, view: { part: "both", expanded: true } }).details, undefined);
});

test("a card whose source is gone is marked deleted", () => {
  const content = cardContent({ kind: "finding", id: "f1" }, null, { palette });
  assert.equal(content.deleted, true);
  assert.equal(content.title.text, "Deleted");
  assert.deepEqual(content.chips, []);
});
