import { test } from "node:test";
import assert from "node:assert/strict";
import { directionArrow, kindContexts, kindOf, MESSAGE_KINDS, stepTab } from "./kinds.js";

const websocket = MESSAGE_KINDS.websocket;

test("a modal opened without a kind shows a WebSocket connection", () => {
  assert.equal(kindOf({ upgradeRequest: {} }), websocket);
  assert.equal(kindOf(undefined), websocket);
  assert.equal(kindOf({ kind: "websocket" }), websocket);
});

test("the WebSocket kind keeps its four tabs in order", () => {
  assert.deepEqual(
    websocket.tabs.map((tab) => [tab.id, tab.label]),
    [
      ["stream", "Stream"],
      ["checkpoint", "Checkpoint"],
      ["inject", "Inject"],
      ["connection", "Connection"],
    ],
  );
});

test("stepping tabs wraps around a kind's tabs", () => {
  assert.equal(stepTab(websocket, "stream", 1), "checkpoint");
  assert.equal(stepTab(websocket, "connection", 1), "stream");
  assert.equal(stepTab(websocket, "stream", -1), "connection");
  assert.equal(stepTab(websocket, "unknown", 1), "checkpoint");
});

test("a kind gets one shared menu context and one per tab, eligible only while its modal shows that tab", () => {
  const contexts = kindContexts(websocket);
  assert.deepEqual(
    contexts.map((c) => [c.id, c.label, c.tier]),
    [
      ["websocket", "WebSocket", "overlay"],
      ["websocket.stream", "WebSocket Stream tab", "overlay"],
      ["websocket.checkpoint", "WebSocket Checkpoint tab", "overlay"],
      ["websocket.inject", "WebSocket Inject tab", "overlay"],
      ["websocket.connection", "WebSocket Connection tab", "overlay"],
    ],
  );
  const inject = contexts.find((c) => c.id === "websocket.inject");
  assert.deepEqual(inject.overlaps, ["websocket"]);
  assert.equal(inject.isEligible({ modal: "WebsocketStream", websocketTab: "inject" }), true);
  assert.equal(inject.isEligible({ modal: "WebsocketStream", websocketTab: "stream" }), false);
  assert.equal(inject.isEligible({ modal: "Finding", websocketTab: "inject" }), false);
  assert.equal(contexts[0].isEligible({ modal: "WebsocketStream" }), true);
});

const stream = MESSAGE_KINDS.stream;

test("a modal opened with the stream kind shows a streamed pair, with Messages and Pair tabs", () => {
  assert.equal(kindOf({ kind: "stream", pairId: "p1" }), stream);
  assert.deepEqual(
    stream.tabs.map((tab) => [tab.id, tab.label]),
    [
      ["messages", "Messages"],
      ["pair", "Pair"],
    ],
  );
});

test("each kind's contexts are eligible only while the modal shows that kind", () => {
  const [streamShared, streamMessages] = kindContexts(stream);
  const [websocketShared] = kindContexts(websocket);
  assert.deepEqual(
    kindContexts(stream).map((c) => [c.id, c.label]),
    [
      ["stream", "Streamed pair"],
      ["stream.messages", "Streamed pair Messages tab"],
      ["stream.pair", "Streamed pair Pair tab"],
    ],
  );
  const showingStream = { modal: "WebsocketStream", streamTab: "messages", websocketTab: null };
  assert.equal(streamShared.isEligible(showingStream), true);
  assert.equal(streamMessages.isEligible(showingStream), true);
  assert.equal(websocketShared.isEligible(showingStream), false);

  const showingWebSocket = { modal: "WebsocketStream", websocketTab: "stream", streamTab: null };
  assert.equal(streamShared.isEligible(showingWebSocket), false);
  assert.equal(websocketShared.isEligible(showingWebSocket), true);
  assert.equal(streamShared.isEligible({ modal: "Finding", streamTab: "messages" }), false);
});

test("request arrows are primary; response arrows are surface in light mode and secondary in dark", () => {
  assert.deepEqual(directionArrow(true), { up: true, class: "text-primary-500" });
  assert.deepEqual(directionArrow(false), { up: false, class: "text-surface-600 dark:text-secondary-500" });
});
