import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abandonLabel,
  abandonText,
  bulkTargets,
  dropTitle,
  groupByHost,
  interceptedFor,
  itemTitle,
  offersInterceptResponse,
  streamedHead,
  summarize,
  treeOrder,
} from "./items.js";

const request = (id, text) => ({ ID: id, Type: "request", text });

test("a held request reads its method, path and host from its text", () => {
  const item = request("a", "POST /api/login?x=1 HTTP/1.1\r\nHost: shop.test\r\nContent-Length: 2\r\n\r\n{}");
  assert.deepEqual(summarize(item, item.text), {
    kind: "REQ",
    method: "POST",
    path: "/api/login?x=1",
    host: "shop.test",
    status: 0,
  });
});

test("a held HTTP/2 request reads its host from :authority", () => {
  const item = request("h2", "GET /me HTTP/2\r\n:scheme: https\r\n:authority: api.shop.test\r\naccept: */*\r\n\r\n");
  assert.deepEqual(summarize(item, item.text), { kind: "REQ", method: "GET", path: "/me", host: "api.shop.test", status: 0 });
});

test("a held response takes its status from its text and the rest from its request", () => {
  const item = { ID: "b", Type: "response", text: "HTTP/1.1 302 Found\r\nLocation: /\r\n\r\n" };
  const request = { Method: "GET", Path: "/login", Host: "shop.test", Number: 12 };
  assert.deepEqual(summarize(item, item.text, { request }), {
    kind: "RES",
    method: "GET",
    path: "/login",
    host: "shop.test",
    status: 302,
  });
});

test("a WebSocket message shows its direction and its connection's host and path", () => {
  const item = { ID: "c", Type: "websocket", Direction: "server", text: "{}" };
  const connection = { Host: "chat.test", Path: "/socket" };
  assert.deepEqual(summarize(item, item.text, { connection }), {
    kind: "WS",
    method: "S→C",
    path: "/socket",
    host: "chat.test",
    status: 0,
  });
});

test("a request in absolute form takes its host and path from the URL", () => {
  const item = request("d", "GET http://api.test/v1?q=2 HTTP/1.1\r\n\r\n");
  const { host, path } = summarize(item, item.text);
  assert.deepEqual({ host, path }, { host: "api.test", path: "/v1?q=2" });
});

test("the tree groups items by host in order of each host's first item, hold order within", () => {
  const hosts = { a: "x.test", b: "y.test", c: "x.test", d: "y.test", e: "z.test" };
  const items = ["a", "b", "c", "d", "e"].map((ID) => ({ ID }));
  const groups = groupByHost(items, (item) => hosts[item.ID]);
  assert.deepEqual(
    groups.map((g) => [g.host, g.items.map((item) => item.ID)]),
    [["x.test", ["a", "c"]], ["y.test", ["b", "d"]], ["z.test", ["e"]]],
  );
});

test("an item with no known host goes under an empty-host group", () => {
  const groups = groupByHost([{ ID: "a" }], () => "");
  assert.deepEqual(groups.map((g) => g.host), [""]);
});

test("the on-screen order follows the tree and skips collapsed hosts", () => {
  const hosts = { a: "x.test", b: "y.test", c: "x.test", d: "z.test" };
  const groups = groupByHost(["a", "b", "c", "d"].map((ID) => ({ ID })), (item) => hosts[item.ID]);
  assert.deepEqual(treeOrder(groups), ["a", "c", "b", "d"]);
  assert.deepEqual(treeOrder(groups, new Set(["y.test"])), ["a", "c", "d"]);
});

test("Forward n and Drop n act on the picked items in hold order", () => {
  const state = { items: [{ ID: "a" }, { ID: "b" }, { ID: "c" }], picked: ["c", "a"] };
  assert.deepEqual(bulkTargets(state), ["a", "c"]);
});

test("with nothing picked, Forward n and Drop n act on every item", () => {
  const state = { items: [{ ID: "a" }, { ID: "b" }], picked: [] };
  assert.deepEqual(bulkTargets(state), ["a", "b"]);
});

test("the drop confirmation counts the items", () => {
  assert.equal(dropTitle(1), "Drop 1 intercepted item?");
  assert.equal(dropTitle(6), "Drop 6 intercepted items?");
});

test("how long an item has been intercepted reads in s, m, h", () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  assert.equal(interceptedFor("2026-10-23T09:59:58Z", now), "2s");
  assert.equal(interceptedFor("2026-10-23T09:59:00Z", now), "1m");
  assert.equal(interceptedFor("2026-10-23T08:30:00Z", now), "1h");
  assert.equal(interceptedFor("2026-10-21T10:00:00Z", now), "2d");
});

test("a time from the future or missing reads as now or nothing", () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  assert.equal(interceptedFor("2026-10-23T10:00:03Z", now), "0s");
  assert.equal(interceptedFor(undefined, now), "");
});

test("the title names the pair by number once Marasi has stored it", () => {
  const summary = { kind: "RES", method: "GET", path: "/login", host: "shop.test", status: 302 };
  assert.equal(itemTitle(summary, 412), "#412 · GET /login");
  assert.equal(itemTitle({ ...summary, kind: "REQ" }), "GET /login");
});

test("a WebSocket message is titled by its connection", () => {
  const summary = { kind: "WS", method: "C→S", path: "/socket", host: "chat.test", status: 0 };
  assert.equal(itemTitle(summary), "WS C→S · chat.test/socket");
});

test("an abandoned item's toast says the client left, and whether an edit went with it", () => {
  assert.equal(abandonText("#412", true), "#412 dropped · client left · edit lost");
  assert.equal(abandonText("GET /x", false), "GET /x dropped · client left");
});

test("an abandoned item is named by its pair number once stored, else by its title", () => {
  const response = { ID: "r", Type: "response", text: "HTTP/1.1 200 OK\r\n\r\n" };
  assert.equal(abandonLabel(response, { request: { Number: 412, Method: "GET", Path: "/x" } }), "#412");
  assert.equal(abandonLabel(request("a", "POST /login HTTP/1.1\r\nHost: shop.test\r\n\r\n")), "POST /login");
});

test("a stream message and a trailer block show their direction and their pair's host and path", () => {
  const request = { Method: "POST", Path: "/chat.v1.ChatService/Converse", Host: "127.0.0.1:50051", Number: 7 };
  const message = { ID: "s", Type: "stream", Direction: "request", PairID: "p", text: "1:VARINT 1" };
  const trailer = { ID: "t", Type: "trailer", Direction: "response", PairID: "p", text: "grpc-status: 0" };
  const summary = summarize(message, message.text, { request });
  assert.deepEqual(summary, { kind: "STREAM", method: "C→S", path: "/chat.v1.ChatService/Converse", host: "127.0.0.1:50051", status: 0 });
  assert.equal(itemTitle(summary, 7), "STREAM C→S · 127.0.0.1:50051/chat.v1.ChatService/Converse");
  assert.equal(itemTitle(summarize(trailer, trailer.text, { request })), "TRAILER S→C · 127.0.0.1:50051/chat.v1.ChatService/Converse");
  assert.equal(summarize(trailer, trailer.text).host, "");
});

test("a held head whose content type Marasi streams names its framing", () => {
  const grpc = request("a", "POST /chat.v1.ChatService/Say HTTP/2\r\n:authority: x\r\ncontent-type: application/grpc+proto\r\n\r\n");
  const web = request("b", "POST /x HTTP/1.1\r\nHost: x\r\nContent-Type: application/grpc-web-text\r\n\r\n");
  const sse = { ID: "c", Type: "response", text: "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n\r\n" };
  const sseRequest = request("d", "POST /x HTTP/1.1\r\nContent-Type: text/event-stream\r\n\r\n");
  const json = request("e", "POST /x HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{}");
  const connect = { ID: "f", Type: "response", text: "HTTP/2 200\r\ncontent-type: application/connect+json\r\n\r\n" };
  assert.equal(streamedHead(grpc, grpc.text), "grpc");
  assert.equal(streamedHead(web, web.text), "grpc-web");
  assert.equal(streamedHead(sse, sse.text), "sse");
  assert.equal(streamedHead(sseRequest, sseRequest.text), "");
  assert.equal(streamedHead(json, json.text), "");
  assert.equal(streamedHead(connect, connect.text), "connect");
  assert.equal(streamedHead({ ID: "w", Type: "websocket", text: "" }, ""), "");
});

test("Forward + intercept response is offered on a held request, but not on one whose body arrives as messages", () => {
  const plain = request("p", "POST /login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n\r\n{}");
  const grpc = request("g", "POST /chat.v1.ChatService/Converse HTTP/2\r\n:authority: x\r\ncontent-type: application/grpc\r\n\r\n");
  assert.equal(offersInterceptResponse(plain), true);
  assert.equal(offersInterceptResponse(grpc), false);
  assert.equal(offersInterceptResponse({ ID: "r", Type: "response", text: "HTTP/1.1 200 OK\r\n\r\n" }), false);
  assert.equal(offersInterceptResponse(null), false);
});
