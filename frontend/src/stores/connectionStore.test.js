import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";

// A fake backend whose `held` is the WebSocket Checkpoint queue, oldest
// first. A forward or drop of a message no longer held fails as the app's
// Go side does.
function fakeApi(held) {
  const api = { held, calls: [] };
  const settle = (id) => {
    if (!api.held.some((msg) => msg.ID === id)) {
      throw new Error(`settling Checkpoint item: checkpoint_gone (${id}): checkpoint item not found: ${id}`);
    }
    api.held = api.held.filter((msg) => msg.ID !== id);
  };
  api.GetWSIntercepted = async (requestId) => api.held.find((msg) => msg.RequestID === requestId) ?? null;
  api.ForwardWSIntercepted = async (id, opcode, payload) => {
    api.calls.push(["forward", id, payload]);
    settle(id);
  };
  api.DropWSIntercepted = async (id) => {
    api.calls.push(["drop", id]);
    settle(id);
  };
  return api;
}

const message = (id, at) => ({ ID: id, RequestID: "conn", Opcode: 1, Payload: "", CreatedAt: at });

function holding(...messages) {
  const api = fakeApi([...messages]);
  const store = createConnectionStore(api);
  for (const msg of messages) store.upsertInterception(msg);
  const queued = () => (get(store).interceptionsByRequestId.conn ?? []).map((msg) => msg.ID);
  return { api, store, queued };
}

test("a message forwarded or dropped elsewhere leaves the connection's queue", async () => {
  const { api, store, queued } = holding(message("m1", "2026-10-23T10:00:00Z"), message("m2", "2026-10-23T10:00:01Z"));
  // The Checkpoint page forwarded m1.
  api.held = api.held.filter((msg) => msg.ID !== "m1");

  await store.onSettled({ ID: "m1", Type: "websocket", RequestID: "conn" });

  assert.deepEqual(queued(), ["m2"]);
});

test("forwarding a message that already left clears it without an error", async () => {
  const { api, store, queued } = holding(message("m1", "2026-10-23T10:00:00Z"));
  // The Checkpoint page forwarded it before its event arrived.
  api.held = [];

  await store.forwardInterception("conn", "edited");

  assert.deepEqual(api.calls, [["forward", "m1", "edited"]]);
  assert.deepEqual(queued(), []);
  assert.equal(get(store).interceptionErrorsByRequestId.conn, "");
});
