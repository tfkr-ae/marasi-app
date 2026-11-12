import { test } from "node:test";
import assert from "node:assert/strict";
import { Call } from "@wailsio/runtime";
import { createRuntime } from "./runtime.js";
import { codeIDs } from "./errorCodes.js";
import { toastError } from "./toasts.js";

// A fake of @wailsio/runtime: a listener gets a {name, data} event, data is
// null when nothing was sent, and a listener with a maximum stops after that
// many calls.
function fakeRuntime() {
  const listeners = new Map();
  const subscribe = (name, callback, max) => {
    const listener = { callback, left: max };
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return () => listeners.set(name, (listeners.get(name) ?? []).filter((l) => l !== listener));
  };
  const fake = {
    titles: [],
    opened: [],
    emitted: [],
    Events: {
      On: (name, callback) => subscribe(name, callback, -1),
      Once: (name, callback) => subscribe(name, callback, 1),
      Off(...names) {
        for (const name of names) listeners.delete(name);
      },
      Emit(name, data) {
        fake.emitted.push([name, data]);
        for (const listener of listeners.get(name) ?? []) {
          if (listener.left === 0) continue;
          listener.left -= 1;
          listener.callback({ name, data: data ?? null });
        }
      },
    },
    Window: {
      SetTitle(title) {
        fake.titles.push(title);
      },
    },
    Browser: {
      OpenURL(url) {
        fake.opened.push(url);
      },
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
  fake.Events.Emit("request", { ID: "r1" });
  assert.deepEqual(got, [{ ID: "r1" }]);
});

test("an event with no payload calls the subscriber with null", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.on("intercepted", (...args) => got.push(args));
  fake.Events.Emit("intercepted");
  assert.deepEqual(got, [[null]]);
});

test("a once subscriber fires on the first event only", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.once("project-opening", (payload) => got.push(payload));
  fake.Events.Emit("project-opening", 1);
  fake.Events.Emit("project-opening", 2);
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
  fake.Events.Emit("log", "x");
  assert.deepEqual(got, [["b", "x"]]);
});

test("off removes every listener for the name and no other", () => {
  const { fake, runtime } = setup();
  const got = [];
  runtime.on("ws-open", (payload) => got.push(["a", payload]));
  runtime.once("ws-open", (payload) => got.push(["b", payload]));
  runtime.on("ws-close", (payload) => got.push(["close", payload]));
  runtime.off("ws-open");
  fake.Events.Emit("ws-open", 1);
  fake.Events.Emit("ws-close", 2);
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

test("a failed binding call reads as the Go error's text", () => {
  const error = new Call.RuntimeError("starting launch: launch_pending (l1, l2): busy");
  assert.equal(String(error), "starting launch: launch_pending (l1, l2): busy");
  assert.equal(`${error}`, "starting launch: launch_pending (l1, l2): busy");
  assert.deepEqual(codeIDs(error, "launch_pending"), ["l1", "l2"]);
  const toasts = [];
  toastError({ trigger: (toast) => toasts.push(toast.message) }, "Failed to launch", error);
  assert.deepEqual(toasts, ["Failed to launch: starting launch: launch_pending (l1, l2): busy"]);
});

test("isIOS asks Go for the OS, since iOS pages get no window._wails.environment", async () => {
  const runtimeOn = (OS) => () => ({ System: { Environment: async () => ({ OS, Arch: "arm64", Debug: false }) } });
  assert.equal(await createRuntime(runtimeOn("ios")).isIOS(), true);
  assert.equal(await createRuntime(runtimeOn("darwin")).isIOS(), false);
});
