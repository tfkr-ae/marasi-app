// The mobile app's swipe down to close a sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSE_PX, closesAt, HEADER_PX, installSwipeToClose, SHEETS, slideOutMs } from "./swipeToClose.js";

// A root that keeps its listeners, and sends events to them.
function fakeRoot() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    send: (type, event) => listeners.get(type)?.(event),
    listening: () => listeners.size,
  };
}

// Frames and timers that run when the test says.
function fakeTime() {
  const queue = [];
  return {
    frame: (fn) => queue.push(fn),
    cancelFrame: () => {},
    later: (fn) => queue.push(fn),
    run() {
      while (queue.length) queue.shift()();
    },
  };
}

// A sheet, and a target inside it: `scrolled` scrolls the target, `field`
// makes it a text field.
function fakeSheet({ dialog = false, scrolled = 0, field = false } = {}) {
  const sheet = {
    tagName: dialog ? "DIALOG" : "DIV",
    open: true,
    isConnected: true,
    style: {},
    parentElement: null,
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const target = {
    parentElement: sheet,
    scrollTop: scrolled,
    scrollHeight: 1000,
    clientHeight: 400,
    closest: (selector) => (selector === SHEETS ? sheet : field ? target : null),
  };
  return { sheet, target };
}

function touch(target, y, t, x = 100) {
  return { target, touches: [{ clientX: x, clientY: y }], timeStamp: t, preventDefault() { this.prevented = true; } };
}

// A drag from `from` down to `to` over `steps` moves, `ms` apart.
function drag(root, target, from, to, { steps = 6, ms = 16, x = 100 } = {}) {
  root.send("touchstart", touch(target, from, 0, x));
  let last;
  for (let i = 1; i <= steps; i++) {
    last = touch(target, from + ((to - from) * i) / steps, i * ms, x);
    root.send("touchmove", last);
  }
  root.send("touchend", {});
  return last;
}

function setup(sheetOptions, { closes = true } = {}) {
  const root = fakeRoot();
  const time = fakeTime();
  const { sheet, target } = fakeSheet(sheetOptions);
  let open = ["modal"];
  const calls = [];
  const stop = installSwipeToClose(root, {
    close: () => {
      calls.push("close");
      if (closes) {
        open = [];
        if (sheet.tagName === "DIALOG") sheet.open = false;
      }
    },
    snapshot: () => open,
    height: () => 800,
    time,
  });
  return { root, time, sheet, target, calls, stop };
}

test("a long or fast drag closes; a short slow one does not", () => {
  assert.equal(closesAt(CLOSE_PX + 1, 0), true);
  assert.equal(closesAt(60, 0.8), true);
  assert.equal(closesAt(60, 0.2), false);
  assert.equal(closesAt(30, 2), false);
});

test("the slide out follows the finger's speed, within 140 to 260 ms", () => {
  assert.equal(slideOutMs(600, 10), 140);
  assert.equal(slideOutMs(600, 0.1), 260);
});

test("a long drag down slides the sheet out, then closes it", () => {
  const { root, time, sheet, target, calls } = setup();
  const last = drag(root, target, 300, 600);
  assert.equal(last.prevented, true);
  time.run();
  assert.deepEqual(calls, ["close"]);
  assert.equal(sheet.style.transform, "translate3d(0, 100%, 0)");
});

test("a short drag springs back without closing", () => {
  const { root, time, sheet, target, calls } = setup();
  drag(root, target, 300, 330, { ms: 60 });
  time.run();
  assert.deepEqual(calls, []);
  assert.equal(sheet.style.transform, "");
});

test("a sheet that stays open (it asks about edits) springs back", () => {
  const { root, time, sheet, target, calls } = setup({}, { closes: false });
  drag(root, target, 300, 600);
  time.run();
  assert.deepEqual(calls, ["close"]);
  assert.equal(sheet.style.transform, "");
});

test("a closed dialog is put back in place for next time", () => {
  const { root, time, sheet, target } = setup({ dialog: true });
  drag(root, target, 300, 600);
  time.run();
  assert.equal(sheet.open, false);
  assert.equal(sheet.style.transform, "");
});

test("up and sideways drags are left to the page", () => {
  const up = setup();
  const last = drag(up.root, up.target, 600, 300);
  up.time.run();
  assert.notEqual(last.prevented, true);
  assert.deepEqual(up.calls, []);

  const side = setup();
  side.root.send("touchstart", touch(side.target, 300, 0, 100));
  const move = touch(side.target, 310, 16, 200);
  side.root.send("touchmove", move);
  side.root.send("touchend", {});
  assert.notEqual(move.prevented, true);
});

test("scrolled content scrolls back first; the header swipes anyway", () => {
  const body = setup({ scrolled: 120 });
  drag(body.root, body.target, 300, 600);
  body.time.run();
  assert.deepEqual(body.calls, []);

  const header = setup({ scrolled: 120 });
  drag(header.root, header.target, HEADER_PX - 20, 600);
  header.time.run();
  assert.deepEqual(header.calls, ["close"]);
});

test("a drag in a text field selects text; from the header it closes", () => {
  const body = setup({ field: true });
  drag(body.root, body.target, 300, 600);
  body.time.run();
  assert.deepEqual(body.calls, []);

  const header = setup({ field: true });
  drag(header.root, header.target, 10, 600);
  header.time.run();
  assert.deepEqual(header.calls, ["close"]);
});

test("stopping removes every listener", () => {
  const { root, stop } = setup();
  assert.equal(root.listening(), 4);
  stop();
  assert.equal(root.listening(), 0);
});
