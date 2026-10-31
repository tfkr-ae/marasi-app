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
