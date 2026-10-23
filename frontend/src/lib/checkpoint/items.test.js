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
