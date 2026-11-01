// The connected instance's proxy listener, as Home's listener button shows
// it: read from GET /listener/status, changed by start, update and stop, and
// kept live by the listener.* events, whoever made the change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createListenerStore, listenerAddress } from "./createListenerStore.js";

const active = (proxy_listener) => ({ status: "active", proxy_listener });
const inactive = { status: "inactive", proxy_listener: null };

// A fake listener API: `status` is what GET /listener/status answers, and
// each change answers with the status it leaves.
function fakeApi(status = active("127.0.0.1:8080")) {
  const calls = [];
  return {
    calls,
    status: async () => status,
    start: async (address, port) => {
      calls.push(["start", address, port]);
      return active(`${address}:${port}`);
    },
    update: async (address, port) => {
      calls.push(["update", address, port]);
      return active(`${address}:${port}`);
    },
    stop: async () => {
      calls.push(["stop"]);
      return inactive;
    },
  };
}

test("reload shows the instance's listener address and port", async () => {
  const store = createListenerStore(fakeApi(active("192.168.1.5:9090")));
  await store.reload();
  assert.deepEqual(get(store), { status: true, address: "192.168.1.5", port: "9090" });
});

test("an IPv6 listener shows its address without brackets", async () => {
  const store = createListenerStore(fakeApi(active("[::1]:8080")));
  await store.reload();
  assert.deepEqual(get(store), { status: true, address: "::1", port: "8080" });
});

test("an inactive listener keeps the last address it had", async () => {
  const api = fakeApi(active("127.0.0.1:8081"));
  const store = createListenerStore(api);
  await store.reload();
  store.onListener(inactive);
  assert.deepEqual(get(store), { status: false, address: "127.0.0.1", port: "8081" });
});

test("setting up the listener starts it when it is stopped", async () => {
  const api = fakeApi(inactive);
  const store = createListenerStore(api);
  await store.reload();
  await store.setup("0.0.0.0", "8082");
  assert.deepEqual(api.calls, [["start", "0.0.0.0", 8082]]);
  assert.deepEqual(get(store), { status: true, address: "0.0.0.0", port: "8082" });
});

test("setting up the listener moves it when it is running", async () => {
  const api = fakeApi();
  const store = createListenerStore(api);
  await store.reload();
  await store.setup("127.0.0.1", 8083);
  assert.deepEqual(api.calls, [["update", "127.0.0.1", 8083]]);
  assert.equal(get(store).port, "8083");
});

test("a refused setup leaves the listener as it was", async () => {
  const api = fakeApi();
  api.update = async () => {
    throw new Error("POST /listener/update: listener_unavailable (address in use)");
  };
  const store = createListenerStore(api);
  await store.reload();
  await assert.rejects(store.setup("127.0.0.1", "80"), /listener_unavailable/);
  assert.deepEqual(get(store), { status: true, address: "127.0.0.1", port: "8080" });
});

test("stop stops the listener", async () => {
  const api = fakeApi();
  const store = createListenerStore(api);
  await store.reload();
  await store.stop();
  assert.deepEqual(api.calls, [["stop"]]);
  assert.equal(get(store).status, false);
});

test("a listener change made elsewhere shows up from its event", async () => {
  const store = createListenerStore(fakeApi());
  await store.reload();
  store.onListener({ status: "active", proxy_listener: "10.0.0.2:8888" });
  assert.deepEqual(get(store), { status: true, address: "10.0.0.2", port: "8888" });
  store.onListener({ status: "inactive", proxy_listener: "10.0.0.2:8888", reason: "failed" });
  assert.deepEqual(get(store), { status: false, address: "10.0.0.2", port: "8888" });
});

test("the listener's address reads as host:port, IPv6 in brackets", () => {
  assert.equal(listenerAddress({ address: "127.0.0.1", port: "8081" }), "127.0.0.1:8081");
  assert.equal(listenerAddress({ address: "::1", port: "52114" }), "[::1]:52114");
});
