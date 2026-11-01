import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "./runtime.js";

// A fake of Wails v2's window.runtime: listeners take the emitted values as
// arguments, and a listener with a maximum stops after that many calls.
function fakeRuntime() {
  const listeners = new Map();
  const fake = {
    titles: [],
    opened: [],
    emitted: [],
    EventsOnMultiple(name, callback, max) {
      const listener = { callback, left: max };
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
    },
    EventsOff(name) {
      listeners.delete(name);
    },
    EventsEmit(name, ...data) {
      fake.emitted.push([name, ...data]);
      for (const listener of listeners.get(name) ?? []) {
        if (listener.left === 0) continue;
        listener.left -= 1;
        listener.callback(...data);
      }
    },
    WindowSetTitle(title) {
      fake.titles.push(title);
    },
    BrowserOpenURL(url) {
      fake.opened.push(url);
    },
  };
  return fake;
}

function setup() {
  const fake = fakeRuntime();
  return { fake, runtime: createRuntime(() => fake) };
}

test("a subscriber gets the event's payload", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.on("request", (payload) => got.push(payload));
  fake.EventsEmit("request", { ID: "r1" });
  assert.deepEqual(got, [{ ID: "r1" }]);
});

test("an event with no payload calls the subscriber with undefined", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.on("intercepted", (...args) => got.push(args));
  fake.EventsEmit("intercepted");
  assert.deepEqual(got, [[undefined]]);
});

test("a once subscriber fires on the first event only", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.once("project-opening", (payload) => got.push(payload));
  fake.EventsEmit("project-opening", 1);
  fake.EventsEmit("project-opening", 2);
  assert.deepEqual(got, [1]);
});

test("an unsubscribe function removes only its own listener", () => {
  const { fake, runtime } = setup();
  const got = [];
  const stopA = runtime.on("log", (payload) => got.push(["a", payload]));
  runtime.on("log", (payload) => got.push(["b", payload]));
  const stopOnce = runtime.once("log", (payload) => got.push(["once", payload]));
  stopA();
  stopOnce();
  fake.EventsEmit("log", "x");
  assert.deepEqual(got, [["b", "x"]]);
});

test("off removes every listener for the name and no other", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.on("ws-open", (payload) => got.push(["a", payload]));
  runtime.once("ws-open", (payload) => got.push(["b", payload]));
  runtime.on("ws-close", (payload) => got.push(["close", payload]));
  runtime.off("ws-open");
  fake.EventsEmit("ws-open", 1);
  fake.EventsEmit("ws-close", 2);
  assert.deepEqual(got, [["close", 2]]);
});

test("emit sends the name and one data value", () => {
  const { fake, runtime } = setup();
  runtime.emit("extension_sync_state", { extensionID: "e1", state: {} });
  assert.deepEqual(fake.emitted, [["extension_sync_state", { extensionID: "e1", state: {} }]]);
});

test("the window title and browser links reach the runtime", () => {
  const { fake, runtime } = setup();
  runtime.setWindowTitle("acme-audit");
  runtime.openURL("https://github.com/tfkr-ae/marasi-app/releases");
  assert.deepEqual(fake.titles, ["acme-audit"]);
  assert.deepEqual(fake.opened, ["https://github.com/tfkr-ae/marasi-app/releases"]);
});
