// The connection store reaching a remote the network can't reach, through
// the real service client: a refused or blocked connection (macOS ATS reads
// only "Load failed") and a host that never answers. Either way the
// connect fails with a reason naming the address, never spinning on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";
import { createServiceClient } from "../lib/service/client.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const lab = { id: "remote-1", kind: "remote", name: "Lab", url: "http://192.0.2.10:8888", noPassword: false };

function storeOver(fetch) {
  const client = createServiceClient({ fetch, EventSource: class {} });
  return createConnectionStore({
    listConnections: async () => ({ connections: [local, lab], activeId: "remote-1" }),
    connectionPassword: async () => "pw",
    use: (connection) => client.use(connection),
    readStatus: (options) => client.request("GET", "/service/status", options),
    openEvents: () => {},
    closeEvents: () => {},
    loadProject: async () => {},
  });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a remote the network refuses fails with the address it couldn't reach", async () => {
  const store = storeOver(async () => {
    throw new TypeError("Load failed");
  });
  await store.start();
  await settle();
  const state = get(store);
  assert.equal(state.phase, "failed");
  assert.equal(state.error, "Couldn't reach 192.0.2.10:8888");
});

test("a remote that never answers fails after 10 s instead of connecting forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = storeOver(
    (url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  );
  await store.start();
  await settle();
  t.mock.timers.tick(9_999);
  await settle();
  assert.equal(get(store).phase, "connecting");
  t.mock.timers.tick(1);
  await settle();
  const state = get(store);
  assert.equal(state.phase, "failed");
  assert.equal(state.error, "No answer from 192.0.2.10:8888");
});

// The start screen's Connections…: before any project has loaded, the
// researcher leaves the remote for Local without waiting for its timeout.
function switchableStoreOver(fetch, loaded) {
  const client = createServiceClient({ fetch, EventSource: class {} });
  return createConnectionStore({
    listConnections: async () => ({ connections: [local, lab], activeId: "remote-1" }),
    connectionPassword: async () => "pw",
    connectLocal: async () => ({ url: "http://127.0.0.1:7000", password: "local-pw", startedByApp: true }),
    confirmSwitch: async () => true,
    setActive: async () => {},
    clearStores: async () => {},
    use: (connection) => client.use(connection),
    readStatus: (options) => client.request("GET", "/service/status", options),
    openEvents: () => {},
    closeEvents: () => {},
    loadProject: async (status) => loaded.push(status.project),
    reloadProject: async (status) => loaded.push(status.project),
  });
}

// Local's status, from the instance Go started.
const localStatus = () =>
  new Response(JSON.stringify({ project: "/local/scratch.marasi", run_id: "run-1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const neverAnswersRemote = (url, init) =>
  url.startsWith("http://127.0.0.1:7000")
    ? Promise.resolve(localStatus())
    : new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

test("switching to Local while a remote is still connecting starts Local and loads its project", async () => {
  const loaded = [];
  const store = switchableStoreOver(neverAnswersRemote, loaded);
  await store.start();
  await settle();
  assert.equal(get(store).phase, "connecting");
  store.switchTo("local");
  for (let i = 0; i < 5; i++) await settle();
  const state = get(store);
  assert.equal(state.connection.id, "local");
  assert.equal(state.phase, "connected");
  assert.deepEqual(loaded, ["/local/scratch.marasi"]);
});

test("switching to Local after a remote failed starts Local and loads its project", async () => {
  const loaded = [];
  const store = switchableStoreOver(async (url) => {
    if (url.startsWith("http://127.0.0.1:7000")) {
      return localStatus();
    }
    throw new TypeError("Load failed");
  }, loaded);
  await store.start();
  await settle();
  assert.equal(get(store).phase, "failed");
  store.switchTo("local");
  for (let i = 0; i < 5; i++) await settle();
  const state = get(store);
  assert.equal(state.connection.id, "local");
  assert.equal(state.phase, "connected");
  assert.deepEqual(loaded, ["/local/scratch.marasi"]);
});
