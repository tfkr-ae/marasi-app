import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardMenuShortcuts, listenForMenuShortcuts, menuDispatcher } from "./app.js";
import { MACOS } from "./platform.js";

menuDispatcher.configure({ platform: MACOS });

// A keydown as a same-origin frame's window delivers it.
function keydown(target, { key, code, meta = false, shift = false, ctrl = false, alt = false }) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, code, metaKey: meta, shiftKey: shift, ctrlKey: ctrl, altKey: alt });
  target.dispatchEvent(event);
  return event;
}

const chef = () => ({ route: "/cyberchef", modal: null, dialogOpen: false, drawer: { open: false } });

test("keys pressed in a frame run Marasi's actions, as the window's do", () => {
  const frame = new EventTarget();
  const ran = [];
  const unregister = menuDispatcher.register("cyberchef.bake", () => ran.push("bake"));
  const stop = listenForMenuShortcuts(frame, chef);
  try {
    const bake = keydown(frame, { key: "Enter", code: "Enter", meta: true, shift: true });
    assert.deepEqual(ran, ["bake"]);
    assert.equal(bake.defaultPrevented, true);
    // CyberChef's own Ctrl+Alt+B is left to it.
    const own = keydown(frame, { key: "∫", code: "KeyB", ctrl: true, alt: true });
    assert.equal(own.defaultPrevented, false);
    assert.deepEqual(ran, ["bake"]);
  } finally {
    stop();
    unregister();
  }
  keydown(frame, { key: "Enter", code: "Enter", meta: true, shift: true });
  assert.deepEqual(ran, ["bake"], "removing the listener stops forwarding");
});

test("a frame forwards nothing before the app installs its shortcuts", () => {
  const frame = new EventTarget();
  const stop = forwardMenuShortcuts(frame);
  const ran = [];
  const unregister = menuDispatcher.register("cyberchef.bake", () => ran.push("bake"));
  keydown(frame, { key: "Enter", code: "Enter", meta: true, shift: true });
  unregister();
  stop();
  assert.deepEqual(ran, []);
});
