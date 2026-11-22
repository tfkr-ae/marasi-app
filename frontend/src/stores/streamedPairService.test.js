// The streamed pair messages store over the service: createStreamedPairStore
// driven through createStreamedPairApi and a fake service client answering
// Marasi's /stream and /traffic routes, with events fed as the app's
// service.on handlers feed them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { fakeServiceClient } from "./fakeServiceClient.js";
import { switchingService } from "./switchingService.js";
import {
  createStreamedPairApi,
  MESSAGE_CAP,
  toStreamedPairEvent,
  toStreamMessage,
  toStreamProgress,
} from "./streamedPairApi.js";
import { createStreamedPairStore } from "./createStreamedPairStore.js";

const b64 = (text) => Buffer.from(text).toString("base64");

// UUIDv7-like ids that sort in arrival order.
const idOf = (n) => `0190${String(n).padStart(8, "0")}-0000-7000-8000-000000000000`;

const message = (n, overrides = {}) => ({
  id: idOf(n),
  pair_id: "p1",
  direction: n % 2 ? "request" : "response",
  framing: "grpc",
  flags: 0,
  payload: b64(`message ${n}`),
  compressed: false,
  created_at: "2026-11-22T10:00:00Z",
  metadata: {},
  ...overrides,
});

const pairRead = (overrides = {}) => ({
  id: "p1",
  number: 7,
  request: { method: "POST", host: "chat.test", path: "/chat.v1.ChatService/Converse" },
  response: { status_code: 200 },
  metadata: {},
  streamed: { request: { framing: "grpc", ending: null }, response: { framing: "grpc", ending: null } },
  ...overrides,
});

// A service holding `count` stored messages for p1, oldest first, paged as
// GET /stream/{pair}/message pages them (cursor: the last id of the page
// before).
function fakeService({ count = 3, pair = pairRead(), routes = {} } = {}) {
  const state = { messages: Array.from({ length: count }, (_, i) => message(i + 1)), pair };
  state.client = fakeServiceClient({
    "GET /traffic/p1": () => state.pair,
    "GET /stream/p1/message": ({ cursor, limit = 100 }) => {
      const start = cursor ? state.messages.findIndex((m) => m.id === cursor) + 1 : 0;
      const items = state.messages.slice(start, start + limit);
      const more = start + limit < state.messages.length;
      return { items, next_cursor: more ? items[items.length - 1].id : null };
    },
    ...routes,
  });
  return state;
}

function setup(options) {
  const service = fakeService(options);
  const store = createStreamedPairStore(createStreamedPairApi(service.client));
  const view = () => get(store).pairs.p1;
  const ids = () => view().messages.map((m) => m.ID);
  const calls = (path) => service.client.calls.filter((c) => c.path === path);
  return { service, store, view, ids, calls };
}

test("opening a pair loads its messages oldest first, a page of 500 at a time", async () => {
  const { store, ids, calls, view } = setup({ count: 1200 });
  await store.open("p1");
  assert.equal(ids().length, 1200);
  assert.equal(ids()[0], idOf(1));
  assert.equal(ids()[1199], idOf(1200));
  assert.deepEqual(
    calls("/stream/p1/message").map((c) => c.query.limit),
    [500, 500, 500],
  );
  assert.equal(view().hasMore, false);
});

test("loading stops at 5,000 messages and Load more reads the rest", async () => {
  const { store, ids, view } = setup({ count: MESSAGE_CAP + 700 });
  await store.open("p1");
  assert.equal(MESSAGE_CAP, 5000);
  assert.equal(ids().length, 5000);
  assert.equal(view().hasMore, true);

  await store.loadMore("p1");
  assert.equal(ids().length, 5700);
  assert.equal(ids()[5699], idOf(5700));
  assert.equal(view().hasMore, false);
});

test("live messages append to an open pair, in arrival order, without repeats", async () => {
  const { store, ids } = setup({ count: 2 });
  await store.open("p1");
  store.onMessage(toStreamMessage(message(4)));
  store.onMessage(toStreamMessage(message(3)));
  store.onMessage(toStreamMessage(message(4)));
  assert.deepEqual(ids(), [idOf(1), idOf(2), idOf(3), idOf(4)]);
});

test("a message that lands while the first page loads is kept once", async () => {
  const { store, ids, service } = setup({ count: 2 });
  const opened = store.open("p1");
  // Stored after the page was read, announced before it came back.
  service.messages.push(message(3));
  store.onMessage(toStreamMessage(message(3)));
  await opened;
  assert.deepEqual(ids(), [idOf(1), idOf(2), idOf(3)]);
});

test("messages of a pair without an open modal are not kept, and closing releases them", async () => {
  const { store } = setup({ count: 2 });
  store.onMessage(toStreamMessage(message(1)));
  assert.deepEqual(get(store).pairs, {});

  await store.open("p1");
  store.close("p1");
  assert.deepEqual(get(store).pairs, {});
  store.onMessage(toStreamMessage(message(3)));
  assert.deepEqual(get(store).pairs, {});
});

test("selecting a message reads it once for its text form, and keeps it", async () => {
  const text = '1:VARINT 1\n3:LEN {"echo: hi"}';
  const { store, view, calls } = setup({
    count: 2,
    routes: { [`GET /stream/p1/message/${idOf(2)}`]: { ...message(2), text } },
  });
  await store.open("p1");
  await store.select("p1", idOf(2));
  await store.select("p1", idOf(2));
  assert.equal(calls(`/stream/p1/message/${idOf(2)}`).length, 1);
  assert.deepEqual(view().details[idOf(2)], { Text: text, Payload: message(2).payload, Full: false });
});

test("a message whose event left its payload out shows the payload read on selection, marked full", async () => {
  const whole = b64("x".repeat(70_000));
  const { store, view, ids } = setup({
    count: 0,
    routes: { [`GET /stream/p1/message/${idOf(1)}`]: { ...message(1), payload: whole, text: null } },
  });
  await store.open("p1");
  store.onMessage(toStreamMessage({ ...message(1), payload: null, payload_truncated: true }));
  assert.deepEqual(ids(), [idOf(1)]);
  assert.equal(view().messages[0].PayloadTruncated, true);

  await store.select("p1", idOf(1));
  assert.deepEqual(view().details[idOf(1)], { Text: null, Payload: whole, Full: true });
});

test("a failed read on selection is shown, and selecting again retries it", async () => {
  let fail = true;
  const { store, view } = setup({
    count: 1,
    routes: {
      [`GET /stream/p1/message/${idOf(1)}`]: () =>
        fail ? { status: 500, body: { error: "internal_server_error" } } : { ...message(1), text: "1:VARINT 1" },
    },
  });
  await store.open("p1");
  await store.select("p1", idOf(1));
  assert.match(view().details[idOf(1)].Error, /internal_server_error/);
  fail = false;
  await store.select("p1", idOf(1));
  assert.equal(view().details[idOf(1)].Text, "1:VARINT 1");
});

const ended = (overrides = {}) => ({
  pair_id: "p1",
  directions: {
    request: { framing: "grpc", messages: 3, ending: "complete" },
    response: {
      framing: "grpc",
      messages: 2,
      ending: "reset",
      reset_code: "CANCEL",
      trailers: [{ name: "grpc-status", value: "1" }],
    },
  },
  streamed: { request: { framing: "grpc", ending: "complete" }, response: { framing: "grpc", ending: "reset" } },
  ...overrides,
});

test("opening a pair reads its head for the header, and an ended pair's directions from its metadata", async () => {
  const { store, view } = setup({
    count: 0,
    pair: pairRead({ metadata: { streamed: ended().directions }, streamed: ended().streamed }),
  });
  await store.open("p1");
  assert.deepEqual(view().pair, { ID: "p1", Number: 7, Method: "POST", Host: "chat.test", Path: "/chat.v1.ChatService/Converse" });
  assert.deepEqual(view().directions, {
    request: { Framing: "grpc", Ending: "complete", Messages: 3, ResetCode: "", Trailers: [] },
    response: { Framing: "grpc", Ending: "reset", Messages: 2, ResetCode: "CANCEL", Trailers: [{ Name: "grpc-status", Value: "1" }] },
  });
});

test("streamed_pair events drive a live pair's directions: framing as each starts, then endings, counts, reset code and trailers", async () => {
  const { store, view } = setup({
    count: 0,
    pair: pairRead({ streamed: { request: { framing: "grpc", ending: null }, response: null } }),
  });
  await store.open("p1");
  assert.deepEqual(view().directions, {
    request: { Framing: "grpc", Ending: null, Messages: null, ResetCode: "", Trailers: [] },
    response: null,
  });

  store.onStreamedPair(
    toStreamedPairEvent({ pair_id: "p1", streamed: { request: { framing: "grpc", ending: null }, response: { framing: "grpc", ending: null } } }),
  );
  assert.equal(view().directions.response.Framing, "grpc");
  assert.equal(view().directions.response.Ending, null);

  store.onStreamedPair(toStreamedPairEvent(ended()));
  assert.deepEqual(view().directions.response, {
    Framing: "grpc",
    Ending: "reset",
    Messages: 2,
    ResetCode: "CANCEL",
    Trailers: [{ Name: "grpc-status", Value: "1" }],
  });
  assert.equal(view().directions.request.Ending, "complete");
});

test("an event that lands while the head is read wins over the read", async () => {
  let answer;
  const { store, view } = setup({
    count: 0,
    routes: { "GET /traffic/p1": () => new Promise((resolve) => (answer = resolve)) },
  });
  const opened = store.open("p1");
  await new Promise((resolve) => setImmediate(resolve));
  store.onStreamedPair(toStreamedPairEvent(ended()));
  answer(pairRead());
  await opened;
  assert.equal(view().directions.response.Ending, "reset");
  assert.equal(view().pair.Number, 7);
});

test("progress shows per direction while a message arrives, and clears when it lands or the pair ends", async () => {
  const { store, view } = setup({ count: 0 });
  await store.open("p1");
  store.onProgress(toStreamProgress({ pair_id: "p1", direction: "response", framing: "grpc", bytes: 40_000 }));
  store.onProgress(toStreamProgress({ pair_id: "p2", direction: "response", framing: "grpc", bytes: 1 }));
  assert.deepEqual(view().progress, { response: { Bytes: 40_000, Framing: "grpc" } });

  store.onMessage(toStreamMessage(message(2)));
  assert.deepEqual(view().progress, {});

  store.onProgress(toStreamProgress({ pair_id: "p1", direction: "request", framing: "grpc", bytes: 10 }));
  store.onStreamedPair(toStreamedPairEvent(ended()));
  assert.deepEqual(view().progress, {});
  assert.equal(get(store).pairs.p2, undefined);
});

test("a connection switch while the pages load reads no further page from the next connection", async () => {
  const page = (n) => ({ items: [message(n)], next_cursor: idOf(n) });
  let n = 0;
  const service = switchingService({
    "GET /traffic/p1": pairRead(),
    "GET /stream/p1/message": () => page(++n),
  });
  const store = createStreamedPairStore(createStreamedPairApi(service.client));
  service.switchWhen("GET /stream/p1/message");
  await store.open("p1");
  assert.deepEqual(service.onB(), []);
  assert.equal(get(store).pairs.p1.error, "");
});

test("a selection made after a connection switch reads nothing from the next connection", async () => {
  const service = switchingService({
    "GET /traffic/p1": pairRead(),
    "GET /stream/p1/message": { items: [message(1)], next_cursor: null },
  });
  const store = createStreamedPairStore(createStreamedPairApi(service.client));
  await store.open("p1");
  service.switchWhen(`GET /stream/p1/message/${idOf(1)}`);
  await store.select("p1", idOf(1));
  assert.deepEqual(service.onB(), []);
  // Nothing to report; selecting it again reads it anew.
  assert.equal(get(store).pairs.p1.details[idOf(1)], undefined);
});

test("while older messages are left to load, live ones wait for Load more instead of leaving a gap", async () => {
  const { store, ids, service } = setup({ count: MESSAGE_CAP + 1 });
  await store.open("p1");
  service.messages.push(message(MESSAGE_CAP + 2));
  store.onMessage(toStreamMessage(message(MESSAGE_CAP + 2)));
  assert.equal(ids().length, MESSAGE_CAP);

  await store.loadMore("p1");
  assert.deepEqual(ids().slice(-2), [idOf(MESSAGE_CAP + 1), idOf(MESSAGE_CAP + 2)]);
});
