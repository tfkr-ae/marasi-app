import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRailDragController,
  reorderVisibleRailOrder,
} from "./railDrag.js";

test("only desktop primary non-touch pointerdown starts a rail drag session", () => {
  const drag = createRailDragController();

  assert.equal(
    drag.pointerDown({
      pageId: "ledger",
      fromIndex: 0,
      pointerId: 1,
      clientX: 30,
      clientY: 100,
      button: 0,
      pointerType: "mouse",
      mobile: true,
    }).started,
    false,
  );
  assert.equal(drag.state(), null);

  assert.equal(
    drag.pointerDown({
      pageId: "ledger",
      fromIndex: 0,
      pointerId: 2,
      clientX: 30,
      clientY: 100,
      button: 0,
      pointerType: "touch",
      mobile: false,
    }).started,
    false,
  );
  assert.equal(drag.state(), null);

  assert.equal(
    drag.pointerDown({
      pageId: "ledger",
      fromIndex: 0,
      pointerId: 3,
      clientX: 30,
      clientY: 100,
      button: 2,
      pointerType: "mouse",
      mobile: false,
    }).started,
    false,
  );
  assert.equal(drag.state(), null);

  const started = drag.pointerDown({
    pageId: "ledger",
    fromIndex: 0,
    pointerId: 4,
    clientX: 30,
    clientY: 100,
    button: 0,
    pointerType: "mouse",
    mobile: false,
  });
  assert.equal(started.started, true);
  assert.deepEqual(started.state, {
    pageId: "ledger",
    fromIndex: 0,
    dropSlot: 0,
    active: false,
  });
});

test("movement below 6px stays inactive so normal clicks navigate immediately; >= 6px activates and tracks dropSlot", () => {
  const drag = createRailDragController();
  const midpoints = [40, 100, 160, 220];
  const order = ["ledger", "compass", "checkpoint", "launchpad"];

  drag.pointerDown({
    pageId: "ledger",
    fromIndex: 0,
    pointerId: 10,
    clientX: 30,
    clientY: 40,
  });

  // Tiny jitter (< 6px): stays inactive.
  const jitter = drag.pointerMove({
    pointerId: 10,
    clientX: 33,
    clientY: 44, // hypot(3, 4) = 5 < 6
    midpoints,
  });
  assert.equal(jitter.changed, false);
  assert.equal(jitter.state.active, false);

  // Releasing without reaching threshold is a normal click (no reorder, no click suppression).
  const clickRelease = drag.pointerUp({
    pointerId: 10,
    fullOrder: order,
    visibleIds: order,
  });
  assert.deepEqual(clickRelease, {
    wasActive: false,
    nextOrder: null,
    suppressClick: false,
  });
  assert.equal(drag.state(), null);

  // Start a new drag and ignore events from a different pointerId.
  drag.pointerDown({
    pageId: "ledger",
    fromIndex: 0,
    pointerId: 11,
    clientX: 30,
    clientY: 40,
  });
  const wrongPointer = drag.pointerMove({
    pointerId: 99,
    clientX: 30,
    clientY: 180,
    midpoints,
  });
  assert.equal(wrongPointer.changed, false);
  assert.equal(drag.state().active, false);

  // Cross 6px threshold: activates and computes dropSlot from midpoints.
  const activated = drag.pointerMove({
    pointerId: 11,
    clientX: 30,
    clientY: 130,
    midpoints,
  });
  assert.equal(activated.changed, true);
  assert.equal(activated.activated, true);
  assert.deepEqual(activated.state, {
    pageId: "ledger",
    fromIndex: 0,
    dropSlot: 2,
    active: true,
  });

  // Moving past the last midpoint targets the trailing slot (4).
  const movedToEnd = drag.pointerMove({
    pointerId: 11,
    clientX: 30,
    clientY: 250,
    midpoints,
  });
  assert.equal(movedToEnd.changed, true);
  assert.equal(movedToEnd.activated, false);
  assert.equal(movedToEnd.state.dropSlot, 4);
});

test("dropping an active drag at a new boundary returns nextOrder and suppresses the trailing click once", () => {
  const drag = createRailDragController();
  const midpoints = [40, 100, 160, 220];
  const order = ["ledger", "compass", "checkpoint", "launchpad"];

  // Drag "ledger" (0) past "checkpoint" (slot 3 -> index 2).
  drag.pointerDown({
    pageId: "ledger",
    fromIndex: 0,
    pointerId: 1,
    clientX: 25,
    clientY: 40,
  });
  drag.pointerMove({ pointerId: 1, clientX: 25, clientY: 180, midpoints });
  const result = drag.pointerUp({
    pointerId: 1,
    fullOrder: order,
    visibleIds: order,
  });

  assert.deepEqual(result, {
    wasActive: true,
    nextOrder: ["compass", "checkpoint", "ledger", "launchpad"],
    suppressClick: true,
  });
  assert.deepEqual(order, ["ledger", "compass", "checkpoint", "launchpad"]);
  assert.equal(drag.state(), null);

  // Trailing click is suppressed once, then normal clicks proceed.
  assert.equal(drag.consumeSuppressedClick(), true);
  assert.equal(drag.consumeSuppressedClick(), false);

  // Drag "launchpad" (3) before "ledger" (slot 0 -> index 0), and clear without a click arriving.
  drag.pointerDown({
    pageId: "launchpad",
    fromIndex: 3,
    pointerId: 2,
    clientX: 25,
    clientY: 220,
  });
  drag.pointerMove({ pointerId: 2, clientX: 25, clientY: 10, midpoints });
  const upToTop = drag.pointerUp({
    pointerId: 2,
    fullOrder: order,
    visibleIds: order,
  });
  assert.deepEqual(upToTop, {
    wasActive: true,
    nextOrder: ["launchpad", "ledger", "compass", "checkpoint"],
    suppressClick: true,
  });
  drag.clearSuppressedClick();
  assert.equal(drag.consumeSuppressedClick(), false);
});

test("dropping back in the original slot or cancelling via Escape cancels without saving or navigating", () => {
  const drag = createRailDragController();
  const midpoints = [40, 100, 160, 220];
  const order = ["ledger", "compass", "checkpoint", "launchpad"];

  // Drag "compass" (1) down past "checkpoint", then back onto its own lower half (slot 2 -> no-op).
  drag.pointerDown({
    pageId: "compass",
    fromIndex: 1,
    pointerId: 20,
    clientX: 25,
    clientY: 100,
  });
  drag.pointerMove({ pointerId: 20, clientX: 25, clientY: 180, midpoints });
  drag.pointerMove({ pointerId: 20, clientX: 25, clientY: 115, midpoints });
  const sameSlot = drag.pointerUp({
    pointerId: 20,
    fullOrder: order,
    visibleIds: order,
  });
  assert.deepEqual(sameSlot, {
    wasActive: true,
    nextOrder: null,
    suppressClick: true,
  });
  assert.equal(drag.consumeSuppressedClick(), true);

  // Escape during an active drag cancels immediately and still suppresses the trailing click when released.
  drag.pointerDown({
    pageId: "compass",
    fromIndex: 1,
    pointerId: 21,
    clientX: 25,
    clientY: 100,
  });
  drag.pointerMove({ pointerId: 21, clientX: 25, clientY: 200, midpoints });
  const escaped = drag.cancel();
  assert.deepEqual(escaped, {
    cancelled: true,
    wasActive: true,
    suppressClick: true,
  });
  assert.equal(drag.state(), null);

  // Eventual pointerup for the Escape-cancelled pointer yields no reorder and keeps click suppression armed.
  const lateUp = drag.pointerUp({
    pointerId: 21,
    fullOrder: order,
    visibleIds: order,
  });
  assert.deepEqual(lateUp, {
    wasActive: false,
    nextOrder: null,
    suppressClick: true,
  });
  assert.equal(drag.consumeSuppressedClick(), true);
  assert.equal(drag.consumeSuppressedClick(), false);

  // Escape before threshold is crossed cancels cleanly without suppressing clicks.
  drag.pointerDown({
    pageId: "compass",
    fromIndex: 1,
    pointerId: 22,
    clientX: 25,
    clientY: 100,
  });
  const pendingEsc = drag.cancel();
  assert.deepEqual(pendingEsc, {
    cancelled: true,
    wasActive: false,
    suppressClick: false,
  });
  assert.equal(drag.consumeSuppressedClick(), false);

  // pointercancel with wrong pointerId is ignored; matching pointerId cancels.
  drag.pointerDown({
    pageId: "compass",
    fromIndex: 1,
    pointerId: 23,
    clientX: 25,
    clientY: 100,
  });
  drag.pointerMove({ pointerId: 23, clientX: 25, clientY: 190, midpoints });
  assert.deepEqual(drag.cancel({ pointerId: 999 }), {
    cancelled: false,
    wasActive: false,
    suppressClick: false,
  });
  assert.equal(drag.state().active, true);
  assert.deepEqual(drag.cancel({ pointerId: 23 }), {
    cancelled: true,
    wasActive: true,
    suppressClick: true,
  });
  // Starting a fresh pointerDown clears any unconsumed suppression from an abandoned drag.
  drag.pointerDown({
    pageId: "ledger",
    fromIndex: 0,
    pointerId: 24,
    clientX: 25,
    clientY: 40,
  });
  assert.equal(drag.consumeSuppressedClick(), false);
});

test("reorderVisibleRailOrder preserves hidden pages in fullOrder when dragging visible tiles", () => {
  const full = ["ledger", "cyberchef", "compass", "checkpoint", "launchpad"];
  const visible = ["ledger", "compass", "checkpoint", "launchpad"];

  // Drag "launchpad" (visible 3) before "ledger" (dropSlot 0).
  assert.deepEqual(reorderVisibleRailOrder(full, visible, 3, 0), [
    "launchpad",
    "ledger",
    "cyberchef",
    "compass",
    "checkpoint",
  ]);

  // Drag "ledger" (visible 0) before "checkpoint" (dropSlot 2).
  assert.deepEqual(reorderVisibleRailOrder(full, visible, 0, 2), [
    "cyberchef",
    "compass",
    "ledger",
    "checkpoint",
    "launchpad",
  ]);

  // Drag "ledger" (visible 0) after last visible item (dropSlot 4).
  assert.deepEqual(reorderVisibleRailOrder(full, visible, 0, 4), [
    "cyberchef",
    "compass",
    "checkpoint",
    "launchpad",
    "ledger",
  ]);
});
