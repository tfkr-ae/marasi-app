import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_TEXT_SCALE_MAX,
  SYSTEM_TEXT_SCALE_MIN,
  readSystemTextScale,
  systemTextScaleFrom,
  watchSystemTextScale,
} from "./systemTextScale.js";

test("a system scale is held to its range and rounded", () => {
  assert.equal(systemTextScaleFrom(1), 1);
  assert.equal(systemTextScaleFrom(1.15), 1.15);
  assert.equal(systemTextScaleFrom(1.3333), 1.33);
  assert.equal(systemTextScaleFrom(5), SYSTEM_TEXT_SCALE_MAX);
  assert.equal(systemTextScaleFrom(0.5), SYSTEM_TEXT_SCALE_MIN);
});

test("anything but a positive number is 1", () => {
  for (const value of [undefined, null, "", "big", NaN, 0, -1, Infinity]) {
    assert.equal(systemTextScaleFrom(value), 1, String(value));
  }
});

test("Android's scale comes from MarasiAndroid.textScale", () => {
  assert.equal(readSystemTextScale("android", { MarasiAndroid: { textScale: () => 1.3 } }), 1.3);
  assert.equal(readSystemTextScale("android", { MarasiAndroid: {} }), 1);
  assert.equal(readSystemTextScale("android", {}), 1);
  const throwing = { MarasiAndroid: { textScale: () => { throw new Error("gone"); } } };
  assert.equal(readSystemTextScale("android", throwing), 1);
});

function iosWindow(bodyPx) {
  const listeners = {};
  const probes = new Set();
  const observers = [];
  const doc = {
    visibilityState: "visible",
    body: { appendChild: (el) => probes.add(el) },
    createElement: () => {
      const el = { style: {}, setAttribute() {}, remove: () => probes.delete(el) };
      return el;
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
    removeEventListener: (name) => delete listeners[name],
  };
  const win = {
    document: doc,
    getComputedStyle: () => ({ fontSize: `${win.bodyPx}px` }),
    ResizeObserver: class {
      constructor(fn) {
        this.fn = fn;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        observers.splice(observers.indexOf(this), 1);
      }
    },
    listeners,
    probes,
    observers,
    bodyPx,
  };
  doc.defaultView = win;
  return win;
}

test("iOS's scale is its body text size over 17px", () => {
  assert.equal(readSystemTextScale("ios", iosWindow(17)), 1);
  assert.equal(readSystemTextScale("ios", iosWindow(23)), 1.35);
  assert.equal(readSystemTextScale("ios", iosWindow(14)), 0.82);
});

test("the desktop's scale is 1", () => {
  assert.equal(readSystemTextScale("desktop", { MarasiAndroid: { textScale: () => 2 } }), 1);
});

test("on iOS the scale is read again when Text Size changes or the app comes back, until stopped", () => {
  const win = iosWindow(17);
  const seen = [];
  const stop = watchSystemTextScale("ios", (scale) => seen.push(scale), win);
  assert.equal(win.probes.size, 1);
  win.bodyPx = 21;
  win.observers[0].fn();
  win.bodyPx = 19;
  win.listeners.visibilitychange();
  assert.deepEqual(seen, [1, 1.24, 1.12]);
  stop();
  assert.deepEqual(Object.keys(win.listeners), []);
  assert.equal(win.observers.length, 0);
  assert.equal(win.probes.size, 0);
});

test("a one-off iOS read leaves no probe behind", () => {
  const win = iosWindow(19);
  readSystemTextScale("ios", win);
  assert.equal(win.probes.size, 0);
});

test("on the desktop the watch reports 1 and listens to nothing", () => {
  const seen = [];
  watchSystemTextScale("desktop", (scale) => seen.push(scale), {});
  assert.deepEqual(seen, [1]);
});
