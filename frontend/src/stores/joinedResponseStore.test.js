import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceClient } from "../lib/service/client.js";
import { serviceError } from "../lib/service/errors.js";
import {
  createJoinedResponseStore,
  hasJoinedSSEEvents,
  sseResponseState,
} from "./createJoinedResponseStore.js";

const enc = (text) => new TextEncoder().encode(text);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeApi(handlers = {}, { readPairStreamed } = {}) {
  const calls = [];
  let generation = 0;
  return {
    calls,
    bumpConnection() {
      generation++;
    },
    bind() {
      const bound = generation;
      return { live: () => bound === generation };
    },
    async readJoinedResponse(id) {
      calls.push(id);
      const handler = handlers[id];
      if (!handler) throw serviceError({ method: "GET", path: `/traffic/${id}/response/joined`, status: 404, body: { error: "not_found" } });
      return typeof handler === "function" ? await handler(id) : handler;
    },
    ...(readPairStreamed ? { readPairStreamed } : {}),
  };
}

const HEAD = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n";
const SAMPLE = `${HEAD}id: 1\nevent: tick\ndata: hello-one\n\nid: 2\ndata: hello-two\n\n`;

test("sseResponseState recognizes SSE framing and all ending kinds across shapes", () => {
  assert.deepEqual(sseResponseState({ response: { framing: "sse", ending: null } }), {
    isSSE: true,
    ended: false,
    ending: null,
  });
  for (const ending of ["complete", "cancelled", "reset", "cut short"]) {
    assert.deepEqual(sseResponseState({ Streamed: { response: { framing: "sse", ending } } }), {
      isSSE: true,
      ended: true,
      ending,
    });
  }
  assert.deepEqual(sseResponseState({ Metadata: { streamed: { response: { framing: "sse", ending: "complete" } } } }), {
    isSSE: true,
    ended: true,
    ending: "complete",
  });
  assert.deepEqual(sseResponseState({ response: { framing: "grpc", ending: "complete" } }), {
    isSSE: false,
    ended: false,
    ending: null,
  });
  assert.equal(hasJoinedSSEEvents(SAMPLE), true);
  assert.equal(hasJoinedSSEEvents(HEAD), false);
  assert.equal(hasJoinedSSEEvents(""), false);
});

test("fetches ended SSE once, preserves exact UTF-8 text and delimiters, and skips ordinary/non-SSE pairs", async () => {
  const utf8 = `${HEAD}event: greeting\ndata: café 🚀\n\n`;
  const api = makeApi({ p1: enc(utf8) });
  const store = createJoinedResponseStore(api);
  const preview = store.createPreview();

  // Ordinary HTTP pair -> no GET.
  preview.sync({ id: "plain", hasResponse: true, sources: [null] });
  // Non-SSE streamed pair (gRPC) -> no GET.
  preview.sync({ id: "grpc1", hasResponse: true, sources: [{ response: { framing: "grpc", ending: "complete" } }] });
  // Live SSE pair -> no GET.
  preview.sync({ id: "p1", hasResponse: false, sources: [{ response: { framing: "sse", ending: null } }] });
  assert.deepEqual(api.calls, []);
  assert.equal(get(preview), null);

  // Ended SSE pair -> single GET, exact UTF-8 preserved.
  preview.sync({ id: "p1", hasResponse: true, sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.deepEqual(api.calls, ["p1"]);
  assert.equal(get(preview), utf8);
  preview.destroy();
});

test("reuses cache across views, deduplicates concurrent reads, and refetches after LRU eviction", async () => {
  const a = `${HEAD}data: AAAA\n\n`;
  const b = `${HEAD}data: BBBB\n\n`;
  const c = `${HEAD}data: CCCC\n\n`;
  const aBytes = enc(a);
  const bBytes = enc(b);
  const cBytes = enc(c);
  const gate = deferred();

  const api = makeApi({
    a: async () => gate.promise,
    b: bBytes,
    c: cBytes,
  });
  // Budget fits two entries (a + b), not three.
  const store = createJoinedResponseStore(api, { maxBytes: aBytes.byteLength + bBytes.byteLength });

  const ledger = store.createPreview();
  const launchpad = store.createPreview();
  const armory = store.createPreview();
  const logbook = store.createPreview();

  // Concurrent reads across two views share one GET.
  ledger.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  launchpad.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  assert.deepEqual(api.calls, ["a"]);

  gate.resolve(aBytes);
  await store.settled();
  assert.equal(get(ledger), a);
  assert.equal(get(launchpad), a);

  // Moving to Armory and Logbook hits cache with no additional GET.
  armory.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  logbook.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  assert.equal(get(armory), a);
  assert.equal(get(logbook), a);
  assert.deepEqual(api.calls, ["a"]);

  // Load b and c -> evicts a (LRU).
  ledger.sync({ id: "b", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  ledger.sync({ id: "c", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.equal(store.stats().cachedCount, 2);
  assert.equal(store.stats().cachedBytes, bBytes.byteLength + cBytes.byteLength);

  // Reopening evicted pair a fetches again.
  ledger.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.deepEqual(api.calls, ["a", "b", "c", "a"]);
  assert.equal(get(ledger), a);

  ledger.destroy();
  launchpad.destroy();
  armory.destroy();
  logbook.destroy();
});

test("oversized response displays for the active preview and releases when it closes or changes pair", async () => {
  const huge = `${HEAD}data: ${"x".repeat(200)}\n\n`;
  const hugeBytes = enc(huge);
  const api = makeApi({ big: hugeBytes });
  const store = createJoinedResponseStore(api, { maxBytes: 50 });

  const preview = store.createPreview();
  preview.sync({ id: "big", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.equal(get(preview), huge);
  assert.equal(store.stats().cachedCount, 0);
  assert.equal(store.stats().cachedBytes, 0);

  // Re-syncing the same pair (e.g., Prettify toggle) keeps it without another GET.
  preview.sync({ id: "big", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  assert.equal(get(preview), huge);
  assert.deepEqual(api.calls, ["big"]);

  // Switching pair releases it; reopening fetches again.
  preview.sync({ id: "other", sources: [null] });
  assert.equal(get(preview), null);

  preview.sync({ id: "big", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.deepEqual(api.calls, ["big", "big"]);
  assert.equal(get(preview), huge);

  preview.destroy();
  assert.equal(get(preview), null);
});

test("live SSE makes no GET while live, updates open preview on end, and handles 409 conflict retries", async () => {
  // Case 1: 409 before traffic.response arrives -> retries when traffic.response arrives.
  let attempts1 = 0;
  const api1 = makeApi({
    p1: async () => {
      attempts1++;
      if (attempts1 === 1) {
        throw serviceError({
          method: "GET",
          path: "/traffic/p1/response/joined",
          status: 409,
          body: { error: "stream_response_open", message: "still open" },
        });
      }
      return enc(SAMPLE);
    },
  });
  const store1 = createJoinedResponseStore(api1);
  const preview1 = store1.createPreview();
  preview1.sync({ id: "p1", hasResponse: false, sources: [{ response: { framing: "sse", ending: null } }] });
  assert.deepEqual(api1.calls, []);

  // streamed_pair.ended arrives early -> first GET hits 409 -> keeps null (stored head).
  store1.onStreamedPair({ pair_id: "p1", streamed: { response: { framing: "sse", ending: "complete" } } });
  await store1.settled();
  assert.deepEqual(api1.calls, ["p1"]);
  assert.equal(get(preview1), null);

  // Final traffic.response arrives -> retries and populates preview.
  store1.onTrafficResponse({ id: "p1", streamed: { response: { framing: "sse", ending: "complete" } } });
  await store1.settled();
  assert.deepEqual(api1.calls, ["p1", "p1"]);
  assert.equal(get(preview1), SAMPLE);
  preview1.destroy();

  // Case 2: traffic.response arrives DURING the first GET before 409 settles -> retries ONCE immediately.
  let attempts2 = 0;
  const firstGate = deferred();
  const api2 = makeApi({
    p2: async () => {
      attempts2++;
      if (attempts2 === 1) {
        await firstGate.promise;
        throw serviceError({
          method: "GET",
          path: "/traffic/p2/response/joined",
          status: 409,
          body: { error: "stream_response_open", message: "still open" },
        });
      }
      return enc(SAMPLE);
    },
  });
  const store2 = createJoinedResponseStore(api2);
  const preview2 = store2.createPreview();
  preview2.sync({ id: "p2", hasResponse: false, sources: [{ response: { framing: "sse", ending: null } }] });
  store2.onStreamedPair({ pair_id: "p2", streamed: { response: { framing: "sse", ending: "cancelled" } } });
  assert.deepEqual(api2.calls, ["p2"]);

  // traffic.response lands while first GET is still in flight.
  store2.onTrafficResponse({ id: "p2", streamed: { response: { framing: "sse", ending: "cancelled" } } });
  firstGate.resolve();
  await store2.settled();
  assert.deepEqual(api2.calls, ["p2", "p2"]);
  assert.equal(get(preview2), SAMPLE);
  preview2.destroy();
});

test("404 falls back quietly without looping, while 409 and transient failures retry on reopen", async () => {
  let errAttempts = 0;
  let openAttempts = 0;
  const api = makeApi({
    older: async () => {
      throw serviceError({ method: "GET", path: "/traffic/older/response/joined", status: 404, text: "404 page not found" });
    },
    flaky: async () => {
      errAttempts++;
      if (errAttempts === 1) {
        throw serviceError({ method: "GET", path: "/traffic/flaky/response/joined", status: 500, body: { error: "internal_server_error" } });
      }
      return enc(SAMPLE);
    },
    pending: async () => {
      openAttempts++;
      if (openAttempts === 1) {
        throw serviceError({ method: "GET", path: "/traffic/pending/response/joined", status: 409, body: { error: "stream_response_open" } });
      }
      return enc(SAMPLE);
    },
  });
  const store = createJoinedResponseStore(api);
  const preview = store.createPreview();

  // 404 on older service: stays null and does not re-fetch on re-sync or reopen.
  preview.sync({ id: "older", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.equal(get(preview), null);
  preview.sync({ id: "other", sources: [null] });
  preview.sync({ id: "older", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.deepEqual(api.calls.filter((id) => id === "older"), ["older"]);

  // Transient 500: doesn't loop on same attachment, retries on reopen and succeeds.
  preview.sync({ id: "flaky", sources: [{ response: { framing: "sse", ending: "reset" } }] });
  await store.settled();
  assert.equal(get(preview), null);
  preview.sync({ id: "flaky", sources: [{ response: { framing: "sse", ending: "reset" } }] });
  assert.deepEqual(api.calls.filter((id) => id === "flaky"), ["flaky"]);
  preview.sync({ id: "other", sources: [null] });
  preview.sync({ id: "flaky", sources: [{ response: { framing: "sse", ending: "reset" } }] });
  await store.settled();
  assert.equal(get(preview), SAMPLE);

  // 409 stream_response_open: retries on reopen and succeeds.
  preview.sync({ id: "pending", sources: [{ response: { framing: "sse", ending: "cut short" } }] });
  await store.settled();
  assert.equal(get(preview), null);
  preview.sync({ id: "other", sources: [null] });
  preview.sync({ id: "pending", sources: [{ response: { framing: "sse", ending: "cut short" } }] });
  await store.settled();
  assert.equal(get(preview), SAMPLE);

  preview.destroy();
});

test("switching pairs mid-fetch keeps each response with its own pair", async () => {
  const gateA = deferred();
  const gateB = deferred();
  const respA = `${HEAD}data: from-A\n\n`;
  const respB = `${HEAD}data: from-B\n\n`;
  const api = makeApi({
    a: () => gateA.promise,
    b: () => gateB.promise,
  });
  const store = createJoinedResponseStore(api);
  const preview = store.createPreview();

  preview.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  preview.sync({ id: "b", sources: [{ response: { framing: "sse", ending: "complete" } }] });

  // A resolves while preview displays B -> preview stays null until B resolves; A is cached.
  gateA.resolve(enc(respA));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(get(preview), null);

  gateB.resolve(enc(respB));
  await store.settled();
  assert.equal(get(preview), respB);

  // Switching back to A hits cache with no extra GET.
  preview.sync({ id: "a", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  assert.equal(get(preview), respA);
  assert.deepEqual(api.calls, ["a", "b"]);
  preview.destroy();
});

test("clearing on project or connection change clears cache and discards late results from old scope", async () => {
  const gate = deferred();
  const api = makeApi({
    p1: () => gate.promise,
    p2: enc(`${HEAD}data: fresh\n\n`),
  });
  const store = createJoinedResponseStore(api);
  const preview = store.createPreview();

  // Populate p2 in cache, start p1 in flight.
  preview.sync({ id: "p2", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await store.settled();
  assert.equal(store.stats().cachedCount, 1);

  preview.sync({ id: "p1", sources: [{ response: { framing: "sse", ending: "complete" } }] });

  // Project switch clears cache & active preview.
  store.clear();
  assert.equal(store.stats().cachedCount, 0);
  assert.equal(get(preview), null);

  // Late result from old scope is discarded and not cached.
  gate.resolve(enc(`${HEAD}data: stale-from-old-project\n\n`));
  await store.settled();
  assert.equal(get(preview), null);
  assert.equal(store.stats().cachedCount, 0);

  // Connection change via client.use() clears cache and supersedes in-flight bytes read.
  const connGate = deferred();
  const fetchCalls = [];
  const client = createServiceClient({
    fetch: async (url) => {
      fetchCalls.push(url);
      if (url.includes("/p-late/")) {
        const bytes = await connGate.promise;
        return new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      }
      return new Response(enc(`${HEAD}data: conn-a\n\n`), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    },
    EventSource: class {},
  });
  client.use({ url: "http://127.0.0.1:1111", password: "a" });
  const liveStore = createJoinedResponseStore({
    bind: () => client.bind(),
    readJoinedResponse: (id, link = client) => link.request("GET", `/traffic/${id}/response/joined`, { as: "bytes" }),
  });
  const p = liveStore.createPreview();
  p.sync({ id: "p-ok", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await liveStore.settled();
  assert.equal(get(p), `${HEAD}data: conn-a\n\n`);

  p.sync({ id: "p-late", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  client.use({ url: "http://127.0.0.1:2222", password: "b" });
  connGate.resolve(enc(`${HEAD}data: stale-conn-a\n\n`));
  await liveStore.settled();
  assert.equal(get(p), null);
  // Next sync on new connection sees cleared cache and fetches fresh on connection B.
  p.sync({ id: "p-ok", sources: [{ response: { framing: "sse", ending: "complete" } }] });
  await liveStore.settled();
  assert.equal(fetchCalls.filter((u) => u.includes("/p-ok/")).length, 2);
  p.destroy();
  preview.destroy();
});

test("resync rechecks visible live SSE pairs and skips already-answered ordinary HTTP pairs", async () => {
  const checked = [];
  const api = makeApi(
    { live1: enc(SAMPLE) },
    {
      readPairStreamed: async (id) => {
        checked.push(id);
        return { response: { framing: "sse", ending: "complete" } };
      },
    },
  );
  const store = createJoinedResponseStore(api);
  const livePreview = store.createPreview();
  const plainPreview = store.createPreview();

  livePreview.sync({ id: "live1", hasResponse: false, sources: [{ response: { framing: "sse", ending: null } }] });
  plainPreview.sync({ id: "http1", hasResponse: true, sources: [null] });
  assert.deepEqual(api.calls, []);

  await store.resync();
  assert.deepEqual(checked, ["live1"]);
  assert.deepEqual(api.calls, ["live1"]);
  assert.equal(get(livePreview), SAMPLE);
  assert.equal(get(plainPreview), null);

  livePreview.destroy();
  plainPreview.destroy();
});
