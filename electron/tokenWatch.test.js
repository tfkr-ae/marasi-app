import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { watchToken } from "./tokenWatch.js";

const configDir = join("/cfg", "Marasi");
const socket = join(configDir, "instances", "default.sock");
const oldToken = "a".repeat(64);
const newToken = "b".repeat(64);

// A stream whose events the test sends, and that the test can end.
function fakeStream() {
  let onEvent;
  let end;
  const opened = [];
  const open = (path, handler) => {
    opened.push(path);
    onEvent = handler;
    return { closed: new Promise((resolve) => (end = resolve)), close: () => end() };
  };
  return { open, opened, send: (name) => onEvent({ name, data: "{}" }), end: () => end() };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a local token rotated on the socket is read again without asking", async () => {
  const stream = fakeStream();
  const calls = [];
  const connection = { instance: "default", origin: "http://127.0.0.1:7070", token: oldToken, loopbackTurnedOn: false };
  const watch = watchToken(connection, {
    configDir,
    streamSocket: (path, eventsPath, handler) => {
      assert.equal(path, socket);
      return stream.open(eventsPath, handler);
    },
    call: async (path, method, route) => {
      calls.push(`${method} ${route}`);
      return { status: 200, body: { token: newToken } };
    },
    onRefused: () => assert.fail("a local rotation never asks"),
  });
  assert.deepEqual(stream.opened, ["/events"]);
  stream.send("traffic.request");
  await settle();
  assert.equal(connection.token, oldToken);
  stream.send("control_listener.token_rotated");
  await settle();
  assert.equal(connection.token, newToken);
  assert.deepEqual(calls, ["GET /service/control-listener/token"]);
  watch.stop();
});

test("a local 401 reads the token again too", async () => {
  const stream = fakeStream();
  const connection = { instance: "default", origin: "http://127.0.0.1:7070", token: oldToken };
  const watch = watchToken(connection, {
    configDir,
    streamSocket: (_path, eventsPath, handler) => stream.open(eventsPath, handler),
    call: async () => ({ status: 200, body: { token: newToken } }),
    onRefused: () => assert.fail("a local 401 never asks"),
  });
  await watch.refused();
  assert.equal(connection.token, newToken);
  watch.stop();
});

test("a local stream that ends opens again after a pause", async () => {
  const stream = fakeStream();
  const pauses = [];
  const watch = watchToken(
    { instance: "default", origin: "http://127.0.0.1:7070", token: oldToken },
    {
      configDir,
      streamSocket: (_path, eventsPath, handler) => stream.open(eventsPath, handler),
      call: async () => ({ status: 200, body: { token: oldToken } }),
      sleep: async (ms) => pauses.push(ms),
    },
  );
  stream.end();
  await settle();
  await settle();
  assert.deepEqual(stream.opened, ["/events", "/events"]);
  assert.equal(pauses.length, 1);
  watch.stop();
  stream.end();
  await settle();
  await settle();
  assert.equal(stream.opened.length, 2);
});

// A remote instance's /events, which the test ends, and its status, which
// answers `statuses` in turn.
function fakeRemote(statuses) {
  const requests = [];
  let end;
  const fetch = async (url, init) => {
    requests.push(`${new URL(url).pathname} ${init.headers.Authorization}`);
    if (url.endsWith("/events")) {
      const body = new ReadableStream({ start: (controller) => (end = () => controller.close()) });
      return new Response(body, { status: 200 });
    }
    return new Response("{}", { status: statuses.shift() });
  };
  return { fetch, requests, end: () => end() };
}

test("a remote stream that ends on a refused token asks for the new token", async () => {
  const remote = fakeRemote([401]);
  let refusals = 0;
  watchToken(
    { instance: "Lab box", origin: "http://10.1.26.31:7070", token: oldToken, remote: true },
    { fetch: remote.fetch, onRefused: () => refusals++, sleep: async () => {} },
  );
  await settle();
  remote.end();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(refusals, 1);
  assert.deepEqual(remote.requests, [`/events Bearer ${oldToken}`, `/service/status Bearer ${oldToken}`]);
});

test("a remote stream that ends while the token still works opens again", async () => {
  const remote = fakeRemote([200]);
  const watch = watchToken(
    { instance: "Lab box", origin: "http://10.1.26.31:7070", token: oldToken, remote: true },
    { fetch: remote.fetch, onRefused: () => assert.fail("the token still works"), sleep: async () => {} },
  );
  await settle();
  remote.end();
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(remote.requests, [`/events Bearer ${oldToken}`, `/service/status Bearer ${oldToken}`, `/events Bearer ${oldToken}`]);
  watch.stop();
});

test("a remote 401 asks once", async () => {
  let refusals = 0;
  const watch = watchToken(
    { instance: "Lab box", origin: "http://10.1.26.31:7070", token: oldToken, remote: true },
    { fetch: () => new Promise(() => {}), onRefused: () => refusals++ },
  );
  await watch.refused();
  await watch.refused();
  assert.equal(refusals, 1);
});
