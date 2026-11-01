// The WebSocket bindings: a connection and its messages by the upgrade
// pair's request id, in v1's shapes, inject and close, WebSocket
// interception and the connection's held messages.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as App from "./App.js";
import { useConnection } from "./marasi.js";

let sent;
let answers;
const realFetch = globalThis.fetch;

const b64 = (text) => Buffer.from(text).toString("base64");

beforeEach(() => {
  sent = [];
  answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    const method = init.method ?? "GET";
    sent.push({ method, path: pathname + search, body: init.body ? JSON.parse(init.body) : undefined });
    let answer = answers[`${method} ${pathname}${search}`] ?? answers[`${method} ${pathname}`] ?? { body: {} };
    if (typeof answer === "function") answer = answer();
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  useConnection("http://127.0.0.1:50037");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const requestId = "44444444-4444-4444-8444-444444444444";
const connectionId = "33333333-3333-4333-8333-333333333333";
const gone = { status: 404, body: { error: "not_found" } };

const connection = {
  id: connectionId,
  request_id: requestId,
  state: "open",
  transport: "wss",
  host: "echo.example",
  path: "/socket?x=1",
  started_at: "2026-11-01T10:00:00Z",
  closed_at: null,
  close_code: 0,
  close_reason: "",
  deflate: {
    server_no_context_takeover: true,
    client_no_context_takeover: false,
    server_max_window_bits: 15,
    client_max_window_bits: 12,
  },
  removed_extensions: ["x-webkit-deflate-frame"],
};

test("GetWebSocketConnection reads the connection behind an upgrade pair, in v1's shape", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  assert.deepEqual(await App.GetWebSocketConnection(requestId), {
    ID: connectionId,
    RequestID: requestId,
    State: "open",
    Transport: "wss",
    Host: "echo.example",
    Path: "/socket?x=1",
    StartedAt: "2026-11-01T10:00:00Z",
    ClosedAt: null,
    CloseCode: 0,
    CloseReason: "",
    Deflate: {
      ServerNoContextTakeover: true,
      ClientNoContextTakeover: false,
      ServerMaxWindowBits: 15,
      ClientMaxWindowBits: 12,
    },
    RemovedExtensions: ["x-webkit-deflate-frame"],
  });
});

test("GetWebSocketConnection is null for an upgrade with no connection yet", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = gone;
  assert.equal(await App.GetWebSocketConnection(requestId), null);
});

const wireMessage = (id, payload, extra = {}) => ({
  id,
  connection_id: connectionId,
  request_id: requestId,
  direction: "client",
  opcode: 1,
  frame_count: 1,
  compressed: false,
  payload: b64(payload),
  is_binary: false,
  created_at: "2026-11-01T10:00:01Z",
  metadata: {},
  ...extra,
});

test("GetWebSocketMessages reads every page of a connection's messages, oldest first, in v1's shape", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  answers[`GET /websocket/${connectionId}/message?limit=500`] = {
    body: { items: [wireMessage("m3", "three"), wireMessage("m2", "two")], next_cursor: "m2" },
  };
  answers[`GET /websocket/${connectionId}/message?limit=500&cursor=m2`] = {
    body: {
      items: [wireMessage("m1", "one", { direction: "server", opcode: 2, is_binary: true, compressed: true, frame_count: 3, metadata: { injected: true } })],
      next_cursor: null,
    },
  };
  assert.deepEqual(await App.GetWebSocketMessages(requestId), [
    {
      ID: "m1",
      ConnectionID: connectionId,
      RequestID: requestId,
      Direction: "server",
      Opcode: 2,
      FrameCount: 3,
      Compressed: true,
      Payload: b64("one"),
      IsBinary: true,
      CreatedAt: "2026-11-01T10:00:01Z",
      Metadata: { injected: true },
    },
    {
      ID: "m2",
      ConnectionID: connectionId,
      RequestID: requestId,
      Direction: "client",
      Opcode: 1,
      FrameCount: 1,
      Compressed: false,
      Payload: b64("two"),
      IsBinary: false,
      CreatedAt: "2026-11-01T10:00:01Z",
      Metadata: {},
    },
    {
      ID: "m3",
      ConnectionID: connectionId,
      RequestID: requestId,
      Direction: "client",
      Opcode: 1,
      FrameCount: 1,
      Compressed: false,
      Payload: b64("three"),
      IsBinary: false,
      CreatedAt: "2026-11-01T10:00:01Z",
      Metadata: {},
    },
  ]);
});

test("GetWebSocketMessages is empty for an upgrade with no connection yet", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = gone;
  assert.deepEqual(await App.GetWebSocketMessages(requestId), []);
});

test("InjectWebSocketMessage sends the text as UTF-8 on the pair's connection, compressed by the leg's rules", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  await App.InjectWebSocketMessage(requestId, "server", 1, "héllo", false);
  assert.deepEqual(sent.at(-1), {
    method: "POST",
    path: `/websocket/${connectionId}/inject`,
    body: { direction: "server", opcode: 1, payload: b64("héllo"), compress: "auto" },
  });
});

test("InjectWebSocketMessage sends uncompressed when asked", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  await App.InjectWebSocketMessage(requestId, "client", 2, "x", true);
  assert.equal(sent.at(-1).body.compress, "never");
});

test("InjectWebSocketMessage rejects when the connection has closed", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  answers[`POST /websocket/${connectionId}/inject`] = { status: 409, body: { error: "websocket_not_open" } };
  await assert.rejects(App.InjectWebSocketMessage(requestId, "client", 1, "x", false));
});

test("CloseWebSocket closes the pair's connection with the code and reason", async () => {
  answers[`GET /traffic/${requestId}/websocket`] = { body: connection };
  answers[`POST /websocket/${connectionId}/close`] = { body: { ...connection, state: "closed" } };
  await App.CloseWebSocket(requestId, 1000, "bye");
  assert.deepEqual(sent.at(-1), {
    method: "POST",
    path: `/websocket/${connectionId}/close`,
    body: { code: 1000, reason: "bye" },
  });
});

const checkpointAnswer = (items, websocketIntercept = false) => ({
  body: { items, intercept: false, websocket_intercept: websocketIntercept },
});
const heldMessage = (id, rid, at) => ({
  id,
  type: "websocket",
  payload: b64("held"),
  opcode: 1,
  direction: "client",
  connection_id: connectionId,
  request_id: rid,
  intercepted_at: at,
});

test("GetWSInterceptFlag reads the instance's WebSocket interception", async () => {
  answers["GET /checkpoint"] = checkpointAnswer([], true);
  assert.equal(await App.GetWSInterceptFlag(), true);
});

test("SetWSIntercept sets WebSocket interception and resolves the instance's value", async () => {
  answers["POST /checkpoint/websocket-intercept"] = checkpointAnswer([], true);
  assert.equal(await App.SetWSIntercept(1), true);
  assert.deepEqual(sent.at(-1).body, { websocket_intercept: true });
});

test("ToggleWSIntercept sets the opposite of the instance's value", async () => {
  answers["GET /checkpoint"] = checkpointAnswer([], true);
  answers["POST /checkpoint/websocket-intercept"] = checkpointAnswer([], false);
  assert.equal(await App.ToggleWSIntercept(), false);
  assert.deepEqual(sent.at(-1).body, { websocket_intercept: false });
});

test("GetWSIntercepted reads the oldest message held on the pair's connection, as v1's message", async () => {
  answers["GET /checkpoint?kind=websocket"] = checkpointAnswer([
    heldMessage("other", "55555555-5555-4555-8555-555555555555", "2026-11-01T10:00:00Z"),
    heldMessage("h1", requestId, "2026-11-01T10:00:01Z"),
    heldMessage("h2", requestId, "2026-11-01T10:00:02Z"),
  ]);
  assert.deepEqual(await App.GetWSIntercepted(requestId), {
    ID: "h1",
    Type: "websocket",
    ConnectionID: connectionId,
    RequestID: requestId,
    Direction: "client",
    Opcode: 1,
    Payload: b64("held"),
    CreatedAt: "2026-11-01T10:00:01Z",
  });
});

test("GetWSIntercepted is null when nothing is held on the pair's connection", async () => {
  answers["GET /checkpoint?kind=websocket"] = checkpointAnswer([]);
  assert.equal(await App.GetWSIntercepted(requestId), null);
});

test("ForwardWSIntercepted forwards the held message with its payload text and opcode", async () => {
  await App.ForwardWSIntercepted("h1", 2, "édited");
  assert.deepEqual(sent.at(-1), {
    method: "POST",
    path: "/checkpoint/h1/forward",
    body: { payload: b64("édited"), opcode: 2 },
  });
});

test("DropWSIntercepted drops the held message", async () => {
  await App.DropWSIntercepted("h1");
  assert.deepEqual(sent.at(-1), { method: "POST", path: "/checkpoint/h1/drop", body: {} });
});
