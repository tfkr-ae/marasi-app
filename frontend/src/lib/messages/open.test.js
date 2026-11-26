import { test } from "node:test";
import assert from "node:assert/strict";
import { canOpenPairMessages, fullReadStreamed, messagesModal } from "./open.js";

const upgrade = {
  Metadata: { protocol: "websocket", "websocket.state": "open" },
  Request: { Raw: "GET / HTTP/1.1" },
  Response: { StatusCode: 101 },
};

test("a full read opens messages when streamed or a WebSocket upgrade", () => {
  assert.equal(canOpenPairMessages({ Streamed: { request: true }, Metadata: {} }), true);
  assert.equal(canOpenPairMessages({ Metadata: { streamed: true } }), true);
  assert.equal(canOpenPairMessages(upgrade), true);
  assert.equal(canOpenPairMessages({ Metadata: {}, Response: { StatusCode: 200 } }), false);
  assert.equal(canOpenPairMessages({ Metadata: {}, Response: null }), false);
  assert.equal(canOpenPairMessages(null), false);
  assert.equal(fullReadStreamed({ Streamed: { response: true } }), true);
});

test("messagesModal opens a streamed pair's stream kind, else the upgrade's connection", () => {
  assert.deepEqual(messagesModal("p1", { streamed: true }), {
    type: "component",
    component: "WebsocketStream",
    meta: { kind: "stream", pairId: "p1" },
  });
  assert.deepEqual(messagesModal("p1", { details: { Metadata: { streamed: true } } }).meta, { kind: "stream", pairId: "p1" });
  const ws = messagesModal("p2", { details: upgrade });
  assert.deepEqual(ws.meta.upgradeRequest, upgrade);
  assert.notEqual(ws.meta.upgradeRequest.Metadata, upgrade.Metadata, "a copy");
});
