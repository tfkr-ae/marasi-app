import { test } from "node:test";
import assert from "node:assert/strict";
import { drawerBodies, linkedTo, metadataText, pairTiming, SYNTAX_AUTO_LIMIT, usesSyntax } from "./drawer.js";

const details = {
  Request: { Raw: "GET / HTTP/1.1" },
  Response: { Raw: "HTTP/1.1 200 OK\n\n{\"a\":1}" },
  Prettified: { Request: "", Response: "HTTP/1.1 200 OK\n\n{\n  \"a\": 1\n}" },
};

test("the drawer shows Marasi's prettified copies, falling back to the raw text where there is none", () => {
  assert.deepEqual(drawerBodies(details, { prettify: true }), {
    request: "GET / HTTP/1.1",
    response: "HTTP/1.1 200 OK\n\n{\n  \"a\": 1\n}",
  });
  assert.deepEqual(drawerBodies(details, { prettify: false }), {
    request: "GET / HTTP/1.1",
    response: "HTTP/1.1 200 OK\n\n{\"a\":1}",
  });
});

test("a response that arrived after the pair was selected replaces the one read with it", () => {
  const pending = { Request: { Raw: "GET / HTTP/1.1" }, Response: null, Prettified: { Request: "", Response: "" } };
  const incoming = { Raw: "HTTP/1.1 204 No Content", Prettified: "" };
  assert.equal(drawerBodies(pending, { prettify: true, incomingResponse: incoming }).response, "HTTP/1.1 204 No Content");
  assert.equal(drawerBodies(pending, { prettify: true }).response, "");
  assert.deepEqual(drawerBodies(null, { prettify: true }), { request: "", response: "" });
});

test("a joined SSE response is shown in both Prettify modes", () => {
  const joined = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: hello\n\n";
  assert.equal(drawerBodies(details, { prettify: true, joinedResponse: joined }).response, joined);
  assert.equal(drawerBodies(details, { prettify: false, joinedResponse: joined }).response, joined);
  assert.equal(
    drawerBodies(details, {
      prettify: true,
      incomingResponse: { Raw: "HTTP/1.1 200 OK\r\n\r\n", Prettified: "" },
      joinedResponse: joined,
    }).response,
    joined,
  );
});

test("syntax highlighting follows the setting; auto stops at 75,000 characters", () => {
  const big = "x".repeat(SYNTAX_AUTO_LIMIT);
  assert.equal(usesSyntax("GET /", "enabled"), true);
  assert.equal(usesSyntax(big, "enabled"), true);
  assert.equal(usesSyntax("GET /", "auto"), true);
  assert.equal(usesSyntax(big, "auto"), false);
  assert.equal(usesSyntax("GET /", "disabled"), false);
  assert.equal(usesSyntax("", "enabled"), false, "nothing to highlight");
  assert.equal(usesSyntax("GET /", undefined), false, "before the settings load");
});

test("timing is the time from request to response, absent without a response", () => {
  const at = (ms) => new Date(Date.UTC(2026, 9, 16, 12, 0, 0, ms)).toISOString();
  assert.equal(pairTiming({ RequestedAt: at(0), RespondedAt: at(77) }), "77 ms");
  assert.equal(pairTiming({ RequestedAt: at(0), RespondedAt: at(1240) }), "1.24 s");
  assert.equal(pairTiming({ RequestedAt: at(0), RespondedAt: "0001-01-01T00:00:00Z" }), "");
  assert.equal(pairTiming({ RequestedAt: at(0) }), "");
  assert.equal(pairTiming(undefined), "");
});

test("the findings or test cases a pair is linked to", () => {
  const records = [
    { ID: 1, Title: "Rate limit", Requests: ["p1", "p2"] },
    { ID: 2, Title: "XSS", Requests: ["p3"] },
    { ID: 3, Title: "Empty", Requests: null },
  ];
  assert.deepEqual(linkedTo("p2", records).map((r) => r.ID), [1]);
  assert.deepEqual(linkedTo("p9", records), []);
  assert.deepEqual(linkedTo("p1", undefined), []);
});

test("metadata reads as indented JSON, as the metadata modal showed it", () => {
  assert.equal(metadataText({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(metadataText("already text"), "already text");
  assert.equal(metadataText(null), "");
});
