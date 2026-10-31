import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventStream, RECONNECT_DELAYS_MS } from "./eventStream.js";

// A fake EventSource: each one opened is in `sources`, and the test plays
// the server's side through open(), emit() and fail().
function fakeEventSource() {
  const sources = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      sources.push(this);
    }
    addEventListener(name, listener) {
      (this.listeners[name] ??= []).push(listener);
    }
    close() {
      this.closed = true;
    }
    open() {
      for (const listener of this.listeners.open ?? []) listener({});
    }
    emit(name, data) {
      for (const listener of this.listeners[name] ?? []) listener({ data: JSON.stringify(data) });
    }
    fail() {
      for (const listener of this.listeners.error ?? []) listener({});
    }
  }
  return { FakeEventSource, sources };
}

// A fake timer: run() fires the one waiting.
function fakeTimer() {
  const waiting = [];
  return {
    waiting,
    set: (fn, ms) => waiting.push({ fn, ms }),
    clear: (handle) => {
      const index = handle - 1;
      if (waiting[index]) waiting[index].cancelled = true;
    },
    run() {
      const next = waiting.find((entry) => !entry.cancelled && !entry.ran);
      next.ran = true;
      next.fn();
      return next.ms;
    },
    pending: () => waiting.filter((entry) => !entry.cancelled && !entry.ran).length,
  };
}

function start({ handlers = {}, onReconnect = () => {} } = {}) {
  const { FakeEventSource, sources } = fakeEventSource();
  const timer = fakeTimer();
  const stream = createEventStream({
    url: "http://127.0.0.1:9000/events",
    handlers,
    onReconnect,
    EventSource: FakeEventSource,
    timer,
  });
  return { stream, sources, timer };
}

test("opens one stream on the instance's /events", () => {
  const { sources } = start();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "http://127.0.0.1:9000/events");
});

test("sends each event's payload to its handler", () => {
  const seen = [];
  const { sources } = start({ handlers: { "log.added": (log) => seen.push(log) } });
  sources[0].open();
  sources[0].emit("log.added", { id: "a", message: "hello" });
  assert.deepEqual(seen, [{ id: "a", message: "hello" }]);
});

test("when the stream drops it reopens after a growing delay", () => {
  const { sources, timer } = start();
  sources[0].fail();
  assert.equal(sources[0].closed, true);
  assert.equal(timer.run(), RECONNECT_DELAYS_MS[0]);
  assert.equal(sources.length, 2);
  sources[1].fail();
  assert.equal(timer.run(), RECONNECT_DELAYS_MS[1]);
  assert.equal(sources.length, 3);
});

test("the delay stops growing at its longest", () => {
  const { sources, timer } = start();
  let ms;
  for (let i = 0; i < RECONNECT_DELAYS_MS.length + 3; i++) {
    sources.at(-1).fail();
    ms = timer.run();
  }
  assert.equal(ms, RECONNECT_DELAYS_MS.at(-1));
});

test("a stream that opens again starts the delay over", () => {
  const { sources, timer } = start();
  sources[0].fail();
  timer.run();
  sources[1].fail();
  timer.run();
  sources[2].open();
  sources[2].fail();
  assert.equal(timer.run(), RECONNECT_DELAYS_MS[0]);
});

test("after a reconnect it asks for a reload, as events aren't replayed", () => {
  let reloads = 0;
  const { sources, timer } = start({ onReconnect: () => reloads++ });
  sources[0].open();
  assert.equal(reloads, 0);
  sources[0].fail();
  timer.run();
  sources[1].open();
  assert.equal(reloads, 1);
});

test("stop closes the stream and cancels a waiting reopen", () => {
  const { stream, sources, timer } = start();
  sources[0].fail();
  stream.stop();
  assert.equal(timer.pending(), 0);
  assert.equal(sources.length, 1);
  const again = start();
  again.stream.stop();
  assert.equal(again.sources[0].closed, true);
});

test("an event with a payload that isn't JSON is skipped", () => {
  const seen = [];
  const { sources } = start({ handlers: { "log.added": (log) => seen.push(log) } });
  const errors = console.error;
  console.error = () => {};
  try {
    for (const listener of sources[0].listeners["log.added"]) listener({ data: "{not json" });
  } finally {
    console.error = errors;
  }
  sources[0].emit("log.added", { id: "b" });
  assert.deepEqual(seen, [{ id: "b" }]);
});
