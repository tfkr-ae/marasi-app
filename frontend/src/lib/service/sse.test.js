// The fetch-based EventSource the app hands the service client: it reads
// GET /events as a fetch stream so it can send the password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFetchEventSource } from "./sse.js";

// A fake fetch answering with `status` and a body streamed as `chunks`; the
// stream stays open until end() unless `ends` is true.
function streamingFetch({ status = 200, chunks = [], ends = false } = {}) {
  const calls = [];
  let controller;
  const fetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers, signal: init.signal });
    const body = new ReadableStream({
      start(c) {
        controller = c;
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        if (ends) c.close();
        init.signal?.addEventListener("abort", () => {
          try {
            c.error(new DOMException("aborted", "AbortError"));
          } catch {}
        });
      },
    });
    return { ok: status >= 200 && status < 300, status, body };
  };
  return { fetch, calls, push: (text) => controller.enqueue(new TextEncoder().encode(text)), end: () => controller.close() };
}

// Resolves once `check()` holds, polling the event loop.
async function until(check) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok(check(), "condition never held");
}

test("named events are read across chunk boundaries, comments skipped", async () => {
  const http = streamingFetch({
    chunks: [": connected\n\n", "event: log.added\nda", 'ta: {"id":"l1"}\n', "\n: heartbeat\n\nevent: traffic.request\r", '\ndata: {"id":"t1"}\r\n\r\n'],
  });
  const EventSource = createFetchEventSource(http.fetch);
  const source = new EventSource("http://127.0.0.1:1/events", { headers: { Authorization: "Bearer pw" } });
  const got = [];
  let opened = false;
  source.onopen = () => (opened = true);
  source.addEventListener("log.added", (e) => got.push([e.type, e.data]));
  source.addEventListener("traffic.request", (e) => got.push([e.type, e.data]));

  await until(() => got.length === 2);
  assert.equal(opened, true);
  assert.deepEqual(got, [
    ["log.added", '{"id":"l1"}'],
    ["traffic.request", '{"id":"t1"}'],
  ]);
  assert.equal(http.calls[0].headers.Authorization, "Bearer pw");
  source.close();
});

test("a refused stream reports its status as an error", async () => {
  const http = streamingFetch({ status: 401, ends: true });
  const EventSource = createFetchEventSource(http.fetch);
  const source = new EventSource("http://127.0.0.1:1/events");
  const errors = [];
  source.onerror = (e) => errors.push(e.status);
  await until(() => errors.length === 1);
  assert.deepEqual(errors, [401]);
});

test("a stream the service ends reports an error, once", async () => {
  const http = streamingFetch({ chunks: [": connected\n\n"] });
  const EventSource = createFetchEventSource(http.fetch);
  const source = new EventSource("http://127.0.0.1:1/events");
  const errors = [];
  source.onerror = (e) => errors.push(e.status ?? null);
  await until(() => http.calls.length === 1);
  http.end();
  await until(() => errors.length === 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(errors, [null]);
});

test("close() stops the stream without reporting an error", async () => {
  const http = streamingFetch({ chunks: [": connected\n\n"] });
  const EventSource = createFetchEventSource(http.fetch);
  const source = new EventSource("http://127.0.0.1:1/events");
  const errors = [];
  source.onerror = () => errors.push(true);
  await until(() => http.calls.length === 1);
  source.close();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(http.calls[0].signal.aborted, true);
  assert.deepEqual(errors, []);
});
