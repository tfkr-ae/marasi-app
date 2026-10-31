import { test } from "node:test";
import assert from "node:assert/strict";
import { EventsOff, EventsOn, EventsOnce } from "./runtime.js";

test("subscribing to an event hands back an unsubscribe, though no events arrive yet", () => {
  const stop = EventsOn("request", () => assert.fail("an event arrived"));
  const stopOnce = EventsOnce("project-opening", () => assert.fail("an event arrived"));
  assert.doesNotThrow(() => {
    stop();
    stopOnce();
    EventsOff("request");
  });
});

test("the updater's events from the main process reach their subscribers until they're turned off", () => {
  let send;
  globalThis.window = { marasiApp: { onUpdateEvent: (callback) => (send = callback) } };
  try {
    const progress = [];
    const once = [];
    EventsOn("update-progress", (payload) => progress.push(payload));
    EventsOnce("update-installed", (payload) => once.push(payload));
    send("update-progress", { Step: "download", Received: 1, Total: 2 });
    send("update-installed", { Version: "a" });
    send("update-installed", { Version: "b" });
    send("request", { id: 1 });
    EventsOff("update-progress");
    send("update-progress", { Step: "verify" });
    assert.deepEqual(progress, [{ Step: "download", Received: 1, Total: 2 }]);
    assert.deepEqual(once, [{ Version: "a" }]);
  } finally {
    delete globalThis.window;
  }
});
