import { test } from "node:test";
import assert from "node:assert/strict";
import { launchpadResponseView } from "./responseView.js";

const HEAD = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n";
const JOINED = `${HEAD}id: 1\ndata: alpha\n\nid: 2\ndata: beta\n\n`;

test("cancelled launch with complete captured SSE events shows terminal status and joined response", () => {
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: { StatusCode: 200, Raw: HEAD } },
      endText: "Cancelled",
      joinedResponse: JOINED,
    }),
    { kind: "response", text: JOINED, endText: "Cancelled", endMessage: null },
  );
});

test("cancelled launch with no response or no complete events keeps Cancelled — no response", () => {
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: null },
      endText: "Cancelled",
      joinedResponse: null,
    }),
    { kind: "ended-empty", text: "", endText: "Cancelled", endMessage: "Cancelled — no response" },
  );
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: { StatusCode: 200, Raw: HEAD } },
      endText: "Cancelled",
      joinedResponse: HEAD,
    }),
    { kind: "ended-empty", text: "", endText: "Cancelled", endMessage: "Cancelled — no response" },
  );
});

test("failed launch without captured events preserves its error text", () => {
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: null },
      endText: "Failed: upstream_error",
      joinedResponse: null,
    }),
    { kind: "ended-empty", text: "", endText: "Failed: upstream_error", endMessage: "Failed: upstream_error" },
  );
});

test("completed or captured SSE entry prefers joined response and falls back to stored head", () => {
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: { StatusCode: 200, Raw: HEAD } },
      endText: null,
      joinedResponse: JOINED,
    }),
    { kind: "response", text: JOINED, endText: null, endMessage: null },
  );
  assert.deepEqual(
    launchpadResponseView({
      selectedId: "p1",
      details: { Response: { StatusCode: 200, Raw: HEAD } },
      endText: null,
      joinedResponse: null,
    }),
    { kind: "response", text: HEAD, endText: null, endMessage: null },
  );
});

test("waiting, loading, and empty states remain intact", () => {
  assert.equal(
    launchpadResponseView({ selectedId: "p1", details: { Response: null }, endText: null, joinedResponse: null }).kind,
    "waiting",
  );
  assert.equal(
    launchpadResponseView({ selectedId: "p1", details: null, endText: null, joinedResponse: null }).kind,
    "loading",
  );
  assert.equal(
    launchpadResponseView({ selectedId: null, details: null, endText: null, joinedResponse: null }).kind,
    "empty",
  );
});
