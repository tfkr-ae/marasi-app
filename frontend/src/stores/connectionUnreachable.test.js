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
const lab = { id: "remote-1", kind: "remote", name: "Lab", url: "http://100.109.251.70:8888", noPassword: false };

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
  assert.equal(state.error, "Couldn't reach 100.109.251.70:8888");
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
  assert.equal(state.error, "No answer from 100.109.251.70:8888");
});
