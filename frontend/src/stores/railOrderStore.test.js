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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("overlapping failing saves both roll back to lastPersisted rather than an unpersisted optimistic order", async () => {
  const persisted = [
    "checkpoint",
    "ledger",
    "compass",
    "launchpad",
    "armory",
    "logbook",
    "workshop",
    "cyberchef",
    "excalidraw",
    "interact",
  ];
  const first = [
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
  const second = [
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

  // Case 1: first fails, then second fails.
  {
    const gates = [deferred(), deferred()];
    const api = fakeBindings({ saved: persisted });
    let call = 0;
    api.save = async () => gates[call++].promise;
    const store = createRailOrderStore(api);
    await store.read();

    const p1 = store.save(first);
    assert.deepEqual(get(store.railOrder), first);
    const p2 = store.save(second);
    assert.deepEqual(get(store.railOrder), second);

    gates[0].reject(new Error("first failed"));
    await assert.rejects(p1, /first failed/);
    // Second write is still in flight; optimistic state remains `second`.
    assert.deepEqual(get(store.railOrder), second);

    gates[1].reject(new Error("second failed"));
    await assert.rejects(p2, /second failed/);
    // Must roll back to true persisted order, NOT `first`.
    assert.deepEqual(get(store.railOrder), persisted);
  }

  // Case 2: second fails first, then first fails late.
  {
    const gates = [deferred(), deferred()];
    const api = fakeBindings({ saved: persisted });
    let call = 0;
    api.save = async () => gates[call++].promise;
    const store = createRailOrderStore(api);
    await store.read();

    const p1 = store.save(first);
    const p2 = store.save(second);

    gates[1].reject(new Error("second failed"));
    await assert.rejects(p2, /second failed/);
    assert.deepEqual(get(store.railOrder), persisted);

    gates[0].reject(new Error("first failed"));
    await assert.rejects(p1, /first failed/);
    assert.deepEqual(get(store.railOrder), persisted);
  }
});

test("a late failure from an older save after a newer save succeeded does not clobber the confirmed order", async () => {
  const first = [
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
  const second = [
    "cyberchef",
    "ledger",
    "compass",
    "checkpoint",
    "launchpad",
    "armory",
    "logbook",
    "workshop",
    "excalidraw",
    "interact",
  ];

  const gates = [deferred(), deferred()];
  const api = fakeBindings();
  let call = 0;
  api.save = async (order) => {
    const idx = call++;
    await gates[idx].promise;
    return [...order];
  };
  const store = createRailOrderStore(api);
  await store.read();

  const p1 = store.save(first);
  const p2 = store.save(second);

  // Newer write succeeds first.
  gates[1].resolve();
  await p2;
  assert.deepEqual(get(store.railOrder), second);

  // Older write fails late and must NOT overwrite `second`.
  gates[0].reject(new Error("stale write failed"));
  await assert.rejects(p1, /stale write failed/);
  assert.deepEqual(get(store.railOrder), second);
  assert.equal(get(store.isDefault), false);
});

test("when an older save succeeds before a newer overlapping save fails, rollback lands on the older confirmed order", async () => {
  const first = [
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
  const second = [
    "cyberchef",
    "ledger",
    "compass",
    "checkpoint",
    "launchpad",
    "armory",
    "logbook",
    "workshop",
    "excalidraw",
    "interact",
  ];

  const gates = [deferred(), deferred()];
  const api = fakeBindings();
  let call = 0;
  api.save = async (order) => {
    const idx = call++;
    await gates[idx].promise;
    return [...order];
  };
  const store = createRailOrderStore(api);
  await store.read();

  const p1 = store.save(first);
  const p2 = store.save(second);

  gates[0].resolve();
  await p1;
  // Second write is still in flight.
  assert.deepEqual(get(store.railOrder), second);

  gates[1].reject(new Error("second failed"));
  await assert.rejects(p2, /second failed/);
  assert.deepEqual(get(store.railOrder), first);
});
