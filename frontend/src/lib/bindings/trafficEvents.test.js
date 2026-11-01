// Marasi's traffic.request and traffic.response events in the shapes v1's
// request and response events had, which the stores merge into rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handshakeEndedEvent, requestEvent, responseEvent } from "./traffic.js";

test("a traffic.request event reads as v1's request event", () => {
  assert.deepEqual(
    requestEvent({
      id: "019a3b5c-0001-7000-8000-000000000001",
      number: 7,
      scheme: "https",
      method: "POST",
      host: "example.com",
      path: "/login?next=/",
      metadata: { has_note: 0 },
      requested_at: "2026-11-01T01:05:12+04:00",
      sitemap_node: "/login",
    }),
    {
      ID: "019a3b5c-0001-7000-8000-000000000001",
      Number: 7,
      Scheme: "https",
      Method: "POST",
      Host: "example.com",
      Path: "/login?next=/",
      Metadata: { has_note: 0 },
      RequestedAt: "2026-11-01T01:05:12+04:00",
      SitemapNode: "/login",
    },
  );
});

test("a traffic.response event reads as v1's response event, with its route", () => {
  const event = {
    id: "019a3b5c-0001-7000-8000-000000000001",
    status: "302 Found",
    status_code: 302,
    content_type: "text/html",
    length: "128",
    metadata: { has_note: 0 },
    responded_at: "2026-11-01T01:05:13+04:00",
    upstream_proxy: { name: "burp", address: "127.0.0.1:8081" },
  };
  assert.deepEqual(responseEvent(event), {
    ID: "019a3b5c-0001-7000-8000-000000000001",
    Status: "302 Found",
    StatusCode: 302,
    ContentType: "text/html",
    Length: "128",
    Metadata: { has_note: 0 },
    RespondedAt: "2026-11-01T01:05:13+04:00",
    Route: { Name: "burp", Address: "127.0.0.1:8081" },
  });
  assert.equal(responseEvent({ ...event, upstream_proxy: null, metadata: null }).Route, null);
  assert.deepEqual(responseEvent({ ...event, metadata: null }).Metadata, {});
});

test("a websocket.handshake_ended event reads as v1's ws-state event", () => {
  assert.deepEqual(
    handshakeEndedEvent({ request_id: "019a3b5c-0001-7000-8000-000000000001", state: "dropped" }),
    { RequestID: "019a3b5c-0001-7000-8000-000000000001", State: "dropped" },
  );
});
