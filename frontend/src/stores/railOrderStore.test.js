import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { DEFAULT_RAIL_ORDER } from "../lib/railOrder.js";
import { createRailOrderStore } from "./createRailOrderStore.js";

function fakeBindings({ saved = [] } = {}) {
  const calls = [];
  const api = {
    calls,
    saved: [...saved],
    get: async () => [...api.saved],
    save: async (order) => {
      calls.push(["save", [...order]]);
      api.saved = [...order];
      return [...api.saved];
    },
    reset: async () => {
      calls.push(["reset"]);
      api.saved = [];
      return [];
    },
  };
  return api;
}

function hold(api, name) {
  const real = api[name];
  let release;
  let fail;
  const gate = new Promise((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  api[name] = async (...args) => {
    await gate;
    return real(...args);
  };
  return { release: () => release(), fail: (err) => fail(err) };
}

test("read loads persisted custom rail order and exposes resolved pages and default flag", async () => {
  const saved = [
    "launchpad",
    "cyberchef",
    "ledger",
    "compass",
    "checkpoint",
    "armory",
    "logbook",
    "workshop",
    "excalidraw",
    "interact",
  ];
  const api = fakeBindings({ saved });
  const store = createRailOrderStore(api);

  assert.deepEqual(get(store.railOrder), DEFAULT_RAIL_ORDER);
  assert.equal(get(store.isDefault), true);

  await store.read();

  assert.deepEqual(get(store.railOrder), saved);
  assert.equal(get(store.railPages)[0].id, "launchpad");
  assert.equal(get(store.railPages)[1].id, "cyberchef");
  assert.equal(get(store.isDefault), false);
});

test("read falls back cleanly to default order when binding rejects", async () => {
  const api = fakeBindings();
  api.get = async () => {
    throw new Error("read failed");
  };
  const store = createRailOrderStore(api);

  await store.read();

  assert.deepEqual(get(store.railOrder), DEFAULT_RAIL_ORDER);
  assert.equal(get(store.isDefault), true);
});

test("save updates optimistically, persists custom order, and rolls back on failure", async () => {
  const api = fakeBindings();
  const store = createRailOrderStore(api);
  await store.read();

  const custom = [
    "launchpad",
    "ledger",
    "compass",
    "checkpoint",
    "armory",
    "logbook",
    "workshop",
    "cyberchef",
    "excalidraw",
    "interact",
  ];
  const held = hold(api, "save");
  const saving = store.save(custom);

  // Optimistic update visible immediately before persistence resolves.
  assert.deepEqual(get(store.railOrder), custom);
  assert.equal(get(store.isDefault), false);

  held.fail(new Error("disk full"));
  await assert.rejects(saving, /disk full/);

  // Rolled back to previous persisted state (default).
  assert.deepEqual(get(store.railOrder), DEFAULT_RAIL_ORDER);
  assert.equal(get(store.isDefault), true);

  // Succeeding save persists cleanly.
  const api2 = fakeBindings();
  const store2 = createRailOrderStore(api2);
  await store2.save(custom);
  assert.deepEqual(api2.calls, [["save", custom]]);
  assert.deepEqual(get(store2.railOrder), custom);
  assert.equal(get(store2.isDefault), false);
});

test("save delegates to reset when the next order matches the canonical default", async () => {
  const custom = [
    "launchpad",
    "ledger",
    "compass",
    "checkpoint",
    "armory",
    "logbook",
    "workshop",
    "cyberchef",
    "excalidraw",
    "interact",
  ];
  const api = fakeBindings({ saved: custom });
  const store = createRailOrderStore(api);
  await store.read();
  assert.equal(get(store.isDefault), false);

  await store.save([...DEFAULT_RAIL_ORDER]);

  assert.deepEqual(api.calls, [["reset"]]);
  assert.deepEqual(get(store.railOrder), DEFAULT_RAIL_ORDER);
  assert.equal(get(store.isDefault), true);
});

test("reset restores default order and rolls back if reset binding fails", async () => {
  const custom = [
    "interact",
    "ledger",
    "compass",
    "checkpoint",
    "launchpad",
    "armory",
    "logbook",
    "workshop",
    "cyberchef",
    "excalidraw",
  ];
  const api = fakeBindings({ saved: custom });
  const store = createRailOrderStore(api);
  await store.read();

  const held = hold(api, "reset");
  const resetting = store.reset();
  assert.equal(get(store.isDefault), true);

  held.fail(new Error("permission denied"));
  await assert.rejects(resetting, /permission denied/);

  assert.deepEqual(get(store.railOrder), custom);
  assert.equal(get(store.isDefault), false);
});
