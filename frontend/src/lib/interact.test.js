import { test } from "node:test";
import assert from "node:assert/strict";
import { createInteractActivator } from "./interact.js";

test("first activation lazy-loads Interactsh, marks it visible, waits a tick, and then navigates", async () => {
  const activator = createInteractActivator();
  const events = [];
  let loaded = 0;

  activator.register({
    load: async () => {
      loaded += 1;
      events.push("load:start");
      await Promise.resolve();
      events.push("load:done");
    },
    show: () => events.push("show"),
    tick: async () => {
      events.push("tick:start");
      await Promise.resolve();
      events.push("tick:done");
    },
  });

  await activator.activate(() => events.push("navigate"));
  assert.equal(loaded, 1);
  assert.deepEqual(events, ["load:start", "load:done", "show", "tick:start", "tick:done", "navigate"]);
});

test("subsequent activations do not reload Interactsh and still navigate", async () => {
  const activator = createInteractActivator();
  let loads = 0;
  let shows = 0;
  const routes = [];

  activator.register({
    load: async () => {
      loads += 1;
    },
    show: () => {
      shows += 1;
    },
    tick: async () => {},
  });

  await activator.activate(() => routes.push("/interact"));
  await activator.activate(() => routes.push("/interact"));
  assert.equal(loads, 1);
  assert.equal(shows, 2);
  assert.deepEqual(routes, ["/interact", "/interact"]);
});

test("concurrent activations share a single in-flight load before showing and navigating", async () => {
  const activator = createInteractActivator();
  let loads = 0;
  let finishLoad;
  const events = [];

  activator.register({
    load: () => {
      loads += 1;
      return new Promise((resolve) => {
        finishLoad = resolve;
      });
    },
    show: () => events.push("show"),
    tick: async () => events.push("tick"),
  });

  const first = activator.activate(() => events.push("nav:1"));
  const second = activator.activate(() => events.push("nav:2"));
  assert.equal(loads, 1);
  assert.deepEqual(events, []);

  finishLoad();
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.ok(events.indexOf("show") < events.indexOf("nav:1"));
  assert.ok(events.indexOf("tick") < events.indexOf("nav:2"));
});

test("a failed load neither shows nor navigates and can be retried", async () => {
  const activator = createInteractActivator();
  let attempts = 0;
  const events = [];

  activator.register({
    load: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network error");
      events.push("loaded");
    },
    show: () => events.push("show"),
    tick: async () => events.push("tick"),
  });

  await assert.rejects(() => activator.activate(() => events.push("navigate")), /network error/);
  assert.deepEqual(events, []);

  await activator.activate(() => events.push("navigate"));
  assert.equal(attempts, 2);
  assert.deepEqual(events, ["loaded", "show", "tick", "navigate"]);
});

test("unregistering clears only its own registration", async () => {
  const activator = createInteractActivator();
  const events = [];

  const stopFirst = activator.register({
    load: async () => events.push("first"),
    show: () => {},
    tick: async () => {},
  });
  const stopSecond = activator.register({
    load: async () => events.push("second"),
    show: () => {},
    tick: async () => {},
  });

  stopFirst();
  await activator.activate(() => events.push("nav:1"));
  assert.deepEqual(events, ["second", "nav:1"]);

  stopSecond();
  await activator.activate(() => events.push("nav:2"));
  assert.deepEqual(events, ["second", "nav:1", "nav:2"]);
});
