// The WebSocket modal over the service: createWebSocketStore driven through
// createWebSocketApi and a fake service client answering Marasi's
// /websocket, /traffic/{id}/websocket and /checkpoint routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { serviceError } from "../lib/service/errors.js";
import { createWebSocketApi, toConnection, toMessage, toProgress, toHeldMessage } from "./webSocketApi.js";
import { createWebSocketStore } from "./createWebSocketStore.js";

const b64 = (text) => Buffer.from(text).toString("base64");
const unb64 = (data) => Buffer.from(data, "base64").toString();

const connection = (overrides = {}) => ({
  id: "conn1",
  request_id: "up1",
  state: "open",
  transport: "wss",
  host: "example.com",
  path: "/socket",
  started_at: "2026-11-06T22:00:00+04:00",
  closed_at: null,
  close_code: 0,
  close_reason: "",
  deflate: { server_no_context_takeover: true, client_no_context_takeover: false, server_max_window_bits: 15, client_max_window_bits: 15 },
  removed_extensions: [],
  ...overrides,
});

const message = (n) => ({
  id: `m${n}`,
  connection_id: "conn1",
  request_id: "up1",
  direction: n % 2 ? "client" : "server",
  opcode: 1,
  frame_count: 1,
  compressed: false,
  payload: b64(`message ${n}`),
  is_binary: false,
  created_at: `2026-11-06T22:00:0${n}+04:00`,
  metadata: {},
});

const heldMessage = (id, requestId = "up1", at = "2026-11-06T22:01:00+04:00") => ({
  id,
  type: "websocket",
  payload: b64("held"),
  opcode: 1,
  direction: "client",
  connection_id: "conn1",
  request_id: requestId,
  frame_count: 1,
  compressed: false,
  metadata: {},
  intercepted_at: at,
});

// `messages` newest first, as the service pages them, `pageSize` at a time.
function fakeService({ conn = connection(), messages = [3, 2, 1].map(message), held = [], pageSize = 2 } = {}) {
  const state = { conn, messages, held, websocket_intercept: false, calls: [] };
  const refuse = (method, path, status, error) => {
    throw serviceError({ method, path, status, body: { error } });
  };
  state.client = {
    get: async (path, query) => {
      state.calls.push(["GET", path, query]);
      if (path === "/traffic/up1/websocket" && state.conn) return state.conn;
      if (path === "/websocket/conn1" && state.conn) return state.conn;
      if (path === "/websocket/conn1/message") {
        const start = query?.cursor ? state.messages.findIndex((m) => m.id === query.cursor) : 0;
        const items = state.messages.slice(start, start + pageSize);
        const next = state.messages[start + pageSize];
        return { items, next_cursor: next ? next.id : null };
      }
      if (path === "/checkpoint") {
        const items = state.held.filter((item) => !query?.kind || item.type === query.kind);
        return { items, intercept: false, websocket_intercept: state.websocket_intercept };
      }
      refuse("GET", path, 404, "not_found");
    },
    post: async (path, body) => {
      state.calls.push(["POST", path, body]);
      let match;
      if ((match = /^\/checkpoint\/([^/]+)\/(forward|drop)$/.exec(path))) {
        if (!state.held.some((item) => item.id === match[1])) refuse("POST", path, 404, "not_found");
        state.held = state.held.filter((item) => item.id !== match[1]);
        return { items: state.held };
      }
      if (path === "/checkpoint/websocket-intercept") {
        state.websocket_intercept = body.websocket_intercept;
        return { items: state.held, intercept: false, websocket_intercept: state.websocket_intercept };
      }
      if (path === "/websocket/conn1/inject") {
        if (state.conn.state !== "open") refuse("POST", path, 409, "websocket_not_open");
        return message(9);
      }
      if (path === "/websocket/conn1/close") {
        state.conn = { ...state.conn, state: "closed", close_code: body.code };
        return state.conn;
      }
      refuse("POST", path, 404, "not_found");
    },
  };
  return state;
}

function setup(options) {
  const service = fakeService(options);
  const store = createWebSocketStore(createWebSocketApi(service.client));
  return { service, store };
}

const posts = (service) => service.calls.filter((call) => call[0] === "POST").map(([, path, body]) => [path, body]);

test("populate reads every page of the connection's messages, oldest first, and the connection", async () => {
  const { store } = setup();
  await store.populate("up1");
  const state = get(store);
  assert.deepEqual(state.messagesByRequestId.up1.map((m) => m.ID), ["m1", "m2", "m3"]);
  const [first] = state.messagesByRequestId.up1;
  assert.deepEqual(
    [first.RequestID, first.ConnectionID, first.Direction, first.Payload, first.IsBinary, first.CreatedAt],
    ["up1", "conn1", "client", b64("message 1"), false, "2026-11-06T22:00:01+04:00"],
  );
  const conn = state.connectionsByRequestId.up1;
  assert.deepEqual([conn.ID, conn.State, conn.Transport, conn.Host, conn.Path], ["conn1", "open", "wss", "example.com", "/socket"]);
  assert.equal(conn.Deflate.ServerNoContextTakeover, true);
});

test("an upgrade with no stored connection yet has no messages and no connection", async () => {
  const { store } = setup({ conn: null });
  await store.populate("up1");
  assert.deepEqual(get(store).messagesByRequestId.up1, []);
  assert.equal(get(store).connectionsByRequestId.up1, undefined);
});

test("inject finds the connection by its upgrade request and sends the payload", async () => {
  const { service, store } = setup();
  await store.inject("up1", "server", 1, "hello", true);
  await store.inject("up1", "client", 2, "", false);
  const sent = posts(service);
  assert.equal(sent[0][0], "/websocket/conn1/inject");
  assert.deepEqual({ ...sent[0][1], payload: unb64(sent[0][1].payload) }, { direction: "server", opcode: 1, payload: "hello", compress: "never" });
  assert.deepEqual(sent[1][1], { direction: "client", opcode: 2, payload: "", compress: "auto" });
});

test("inject on a closed connection rejects with the service's code", async () => {
  const { store } = setup({ conn: connection({ state: "closed" }) });
  await assert.rejects(store.inject("up1", "client", 1, "x", false), /websocket_not_open/);
});

test("close sends the code and reason and keeps the closed connection", async () => {
  const { service, store } = setup();
  await store.close("up1", 1000, "");
  assert.deepEqual(posts(service), [["/websocket/conn1/close", { code: 1000, reason: "" }]]);
  assert.equal(get(store).connectionsByRequestId.up1.State, "closed");
});

test("the Checkpoint tab shows the connection's oldest held message and forwards its edit", async () => {
  const { service, store } = setup({ held: [heldMessage("h1"), heldMessage("x1", "other"), heldMessage("h2")] });
  await store.populateInterception("up1");
  const [head] = get(store).interceptionsByRequestId.up1;
  assert.deepEqual([head.ID, head.RequestID, head.CreatedAt], ["h1", "up1", "2026-11-06T22:01:00+04:00"]);

  await store.forwardInterception("up1", "edited");
  const [[path, body]] = posts(service);
  assert.equal(path, "/checkpoint/h1/forward");
  assert.deepEqual({ ...body, payload: unb64(body.payload) }, { payload: "edited", opcode: 1 });
  assert.deepEqual(get(store).interceptionsByRequestId.up1.map((m) => m.ID), ["h2"]);
});

test("the WebSocket intercept flag is read and turned over on the service", async () => {
  const { service, store } = setup();
  await store.populateInterceptFlag();
  assert.equal(get(store).wsInterceptEnabled, false);
  await store.toggleIntercept();
  assert.deepEqual(posts(service), [["/checkpoint/websocket-intercept", { websocket_intercept: true }]]);
  assert.equal(get(store).wsInterceptEnabled, true);
  store.setInterceptFlag(false);
  assert.equal(get(store).wsInterceptEnabled, false);
});

test("stream events map to the store's shapes", () => {
  assert.equal(toConnection(connection()).RequestID, "up1");
  assert.equal(toConnection(connection({ deflate: null })).Deflate, null);
  assert.equal(toMessage(message(1)).ID, "m1");
  assert.deepEqual(
    toProgress({ message_id: "m5", connection_id: "conn1", request_id: "up1", direction: "server", opcode: 2, bytes: 10, frames: 2 }),
    { MessageID: "m5", ConnectionID: "conn1", RequestID: "up1", Direction: "server", Opcode: 2, Bytes: 10, Frames: 2 },
  );
  assert.equal(toHeldMessage(heldMessage("h1")).CreatedAt, "2026-11-06T22:01:00+04:00");
});

test("resync reads the open connections again, keeping messages already shown", async () => {
  const { service, store } = setup({ held: [heldMessage("h1")] });
  await store.populate("up1");
  await store.populateInterception("up1");
  // While the stream was down: m4 arrived, h1 was forwarded elsewhere, h2
  // was held, and the connection closed.
  service.messages = [{ ...message(4), id: "m4" }, ...service.messages];
  service.held = [heldMessage("h2")];
  service.conn = { ...service.conn, state: "closed" };
  service.websocket_intercept = true;

  await store.resync();
  const state = get(store);
  assert.deepEqual(state.messagesByRequestId.up1.map((m) => m.ID), ["m1", "m2", "m3", "m4"]);
  assert.deepEqual(state.interceptionsByRequestId.up1.map((m) => m.ID), ["h2"]);
  assert.equal(state.connectionsByRequestId.up1.State, "closed");
  assert.equal(state.wsInterceptEnabled, true);
});
