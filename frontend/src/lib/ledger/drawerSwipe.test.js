import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AXIS_LOCK,
  DISTANCE,
  EDGE_ZONE,
  FLICK_MIN,
  FLICK_V,
  SWIPE_PANES,
  SWIPE_PANEL_WIDTH,
  beginGesture,
  cancelGesture,
  computeTransforms,
  createSwipeState,
  endGesture,
  moveGesture,
  selectPane,
  setSidebars,
  toggleLeftSidebar,
  toggleRightSidebar,
} from "./drawerSwipe.js";

/** Runs a simple linear horizontal touch gesture from startX to endX across steps. */
function runSwipe(initial, { startX, endX, startY = 200, endY = 200, durationMs = 200, steps = 4, stageWidth = 390 }) {
  let state = beginGesture(initial, { x: startX, y: startY, time: 0, stageLeft: 0, stageWidth });
  let lastMove = { state, preventDefault: false, active: false };
  for (let i = 1; i <= steps; i++) {
    const t = (durationMs * i) / steps;
    const x = startX + ((endX - startX) * i) / steps;
    const y = startY + ((endY - startY) * i) / steps;
    lastMove = moveGesture(state, { x, y, time: t });
    state = lastMove.state;
  }
  return { lastMove, result: endGesture(state) };
}

test("exports the settled swipe thresholds and 4-pane sequence", () => {
  assert.deepEqual(SWIPE_PANES, ["request", "response", "note", "metadata"]);
  assert.equal(DISTANCE, 36);
  assert.equal(FLICK_MIN, 14);
  assert.equal(FLICK_V, 0.16);
  assert.equal(EDGE_ZONE, 28);
  assert.equal(AXIS_LOCK, 4);
});

test("enforces mutual exclusion between left and right sidebars", () => {
  let state = createSwipeState({ leftOpen: true, rightOpen: true });
  assert.equal(state.leftOpen, true);
  assert.equal(state.rightOpen, false, "both sidebars cannot be open at once");

  state = toggleRightSidebar(state);
  assert.equal(state.leftOpen, false, "opening right closes left");
  assert.equal(state.rightOpen, true);

  state = toggleLeftSidebar(state);
  assert.equal(state.leftOpen, true);
  assert.equal(state.rightOpen, false, "opening left closes right");

  state = setSidebars(state, { leftOpen: true, rightOpen: true });
  assert.equal(state.leftOpen, true);
  assert.equal(state.rightOpen, false);

  state = toggleLeftSidebar(state);
  assert.equal(state.leftOpen, false);
  assert.equal(state.rightOpen, false);
});

test("selectPane clamps pane index and closes any open sidebar", () => {
  let state = createSwipeState({ paneIndex: 0, leftOpen: true });
  state = selectPane(state, "note");
  assert.equal(state.paneIndex, 2);
  assert.equal(state.leftOpen, false);
  assert.equal(state.rightOpen, false);

  state = selectPane(createSwipeState({ paneIndex: 1, rightOpen: true }), 99);
  assert.equal(state.paneIndex, 3);
  assert.equal(state.rightOpen, false);

  state = selectPane(state, -5);
  assert.equal(state.paneIndex, 0);
});

test("axis lock lets vertical scrolling pass through untouched", () => {
  let state = createSwipeState({ paneIndex: 1 });
  state = beginGesture(state, { x: 200, y: 300, time: 0, stageLeft: 0, stageWidth: 390 });

  // Under AXIS_LOCK (4px), nothing locks yet.
  let step = moveGesture(state, { x: 202, y: 303, time: 16 });
  assert.equal(step.preventDefault, false);
  assert.equal(step.active, false);
  assert.equal(step.state.gesture.axis, null);

  // Moving vertically (>= horizontal delta) locks to "y" and never intercepts.
  step = moveGesture(step.state, { x: 203, y: 306, time: 32 });
  assert.equal(step.preventDefault, false);
  assert.equal(step.active, false);
  assert.equal(step.state.gesture.axis, "y");

  // Even large horizontal drift later stays locked to vertical scroll.
  step = moveGesture(step.state, { x: 280, y: 320, time: 48 });
  assert.equal(step.preventDefault, false);
  assert.equal(step.active, false);
  assert.equal(step.state.gesture.axis, "y");

  const ended = endGesture(step.state);
  assert.equal(ended.committed, false);
  assert.equal(ended.state.paneIndex, 1);
  assert.equal(ended.state.gesture, null);
});

test("steps across all four panes Request <-> Response <-> Note <-> Meta and clamps", () => {
  let state = createSwipeState({ paneIndex: 0 });

  // Request -> Response (swipe left from center)
  let { result } = runSwipe(state, { startX: 220, endX: 140, durationMs: 400 });
  assert.equal(result.mode, "pager");
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 1);
  state = result.state;

  // Response -> Note
  ({ result } = runSwipe(state, { startX: 220, endX: 140, durationMs: 400 }));
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 2);
  state = result.state;

  // Note -> Meta
  ({ result } = runSwipe(state, { startX: 220, endX: 140, durationMs: 400 }));
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 3);
  state = result.state;

  // Meta -> Note (swipe right from center)
  ({ result } = runSwipe(state, { startX: 160, endX: 240, durationMs: 400 }));
  assert.equal(result.mode, "pager");
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 2);
  state = result.state;

  // Note -> Response
  ({ result } = runSwipe(state, { startX: 160, endX: 240, durationMs: 400 }));
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 1);
  state = result.state;

  // Response -> Request
  ({ result } = runSwipe(state, { startX: 160, endX: 240, durationMs: 400 }));
  assert.equal(result.committed, true);
  assert.equal(result.state.paneIndex, 0);
});

test("opens left sidebar in one swipe from Request and right sidebar in one swipe from Meta", () => {
  // On Request (pane 0), swiping right from anywhere opens the left details sidebar.
  const left = runSwipe(createSwipeState({ paneIndex: 0 }), { startX: 180, endX: 260, durationMs: 400 });
  assert.equal(left.lastMove.preventDefault, true);
  assert.equal(left.result.mode, "open-left");
  assert.equal(left.result.committed, true);
  assert.equal(left.result.state.leftOpen, true);
  assert.equal(left.result.state.rightOpen, false);
  assert.equal(left.result.state.paneIndex, 0);

  // On Meta (pane 3), swiping left from anywhere opens the right actions sidebar.
  const right = runSwipe(createSwipeState({ paneIndex: 3 }), { startX: 200, endX: 120, durationMs: 400 });
  assert.equal(right.lastMove.preventDefault, true);
  assert.equal(right.result.mode, "open-right");
  assert.equal(right.result.committed, true);
  assert.equal(right.result.state.rightOpen, true);
  assert.equal(right.result.state.leftOpen, false);
  assert.equal(right.result.state.paneIndex, 3);
});

test("opens sidebars from EDGE_ZONE on interior panes while center swipes page", () => {
  // Left edge (x <= 28) on Response (pane 1) pulls open left sidebar instead of paging to Request.
  const fromLeftEdge = runSwipe(createSwipeState({ paneIndex: 1 }), { startX: 20, endX: 100, durationMs: 400 });
  assert.equal(fromLeftEdge.result.mode, "open-left");
  assert.equal(fromLeftEdge.result.committed, true);
  assert.equal(fromLeftEdge.result.state.leftOpen, true);
  assert.equal(fromLeftEdge.result.state.paneIndex, 1);

  // Right edge (x >= 390 - 28 = 362) on Note (pane 2) pulls open right sidebar instead of paging to Meta.
  const fromRightEdge = runSwipe(createSwipeState({ paneIndex: 2 }), {
    startX: 370,
    endX: 290,
    durationMs: 400,
    stageWidth: 390,
  });
  assert.equal(fromRightEdge.result.mode, "open-right");
  assert.equal(fromRightEdge.result.committed, true);
  assert.equal(fromRightEdge.result.state.rightOpen, true);
  assert.equal(fromRightEdge.result.state.paneIndex, 2);

  // Just outside EDGE_ZONE (x = 29 on left, x = 361 on right) pages normally.
  const pastLeftEdge = runSwipe(createSwipeState({ paneIndex: 1 }), { startX: 29, endX: 109, durationMs: 400 });
  assert.equal(pastLeftEdge.result.mode, "pager");
  assert.equal(pastLeftEdge.result.state.paneIndex, 0);
  assert.equal(pastLeftEdge.result.state.leftOpen, false);

  const pastRightEdge = runSwipe(createSwipeState({ paneIndex: 2 }), {
    startX: 361,
    endX: 281,
    durationMs: 400,
    stageWidth: 390,
  });
  assert.equal(pastRightEdge.result.mode, "pager");
  assert.equal(pastRightEdge.result.state.paneIndex, 3);
  assert.equal(pastRightEdge.result.state.rightOpen, false);
});

test("swiping closed dismisses open sidebars while wrong-direction drags are ignored", () => {
  const openLeft = createSwipeState({ paneIndex: 1, leftOpen: true });

  // Dragging right while left is already open does not intercept or change state.
  const wrongLeft = runSwipe(openLeft, { startX: 100, endX: 200, durationMs: 200 });
  assert.equal(wrongLeft.lastMove.active, false);
  assert.equal(wrongLeft.lastMove.preventDefault, false);
  assert.equal(wrongLeft.result.committed, false);
  assert.equal(wrongLeft.result.state.leftOpen, true);

  // Swiping left closes the left sidebar.
  const closeLeft = runSwipe(openLeft, { startX: 200, endX: 120, durationMs: 300 });
  assert.equal(closeLeft.result.mode, "close-left");
  assert.equal(closeLeft.result.committed, true);
  assert.equal(closeLeft.result.state.leftOpen, false);
  assert.equal(closeLeft.result.state.rightOpen, false);
  assert.equal(closeLeft.result.state.paneIndex, 1);

  const openRight = createSwipeState({ paneIndex: 2, rightOpen: true });

  // Dragging left while right is already open does not intercept or change state.
  const wrongRight = runSwipe(openRight, { startX: 260, endX: 160, durationMs: 200 });
  assert.equal(wrongRight.lastMove.active, false);
  assert.equal(wrongRight.lastMove.preventDefault, false);
  assert.equal(wrongRight.result.committed, false);
  assert.equal(wrongRight.result.state.rightOpen, true);

  // Swiping right closes the right sidebar.
  const closeRight = runSwipe(openRight, { startX: 160, endX: 240, durationMs: 300 });
  assert.equal(closeRight.result.mode, "close-right");
  assert.equal(closeRight.result.committed, true);
  assert.equal(closeRight.result.state.rightOpen, false);
  assert.equal(closeRight.result.state.leftOpen, false);
  assert.equal(closeRight.result.state.paneIndex, 2);
});

test("enforces exact DISTANCE (36px) vs FLICK_MIN (14px) + FLICK_V (0.16 px/ms) thresholds", () => {
  // Anchor happens on the first move past AXIS_LOCK (4px), so test explicitly with two moves:
  // 1) lock at +5px (anchorX = 105), 2) drag from anchorX by exact delta.
  function twoStep(initial, lockDx, dragDx, dtMs) {
    let state = beginGesture(initial, { x: 100, y: 200, time: 0, stageLeft: 0, stageWidth: 390 });
    state = moveGesture(state, { x: 100 + lockDx, y: 200, time: 100 }).state;
    state = moveGesture(state, { x: 100 + lockDx + dragDx, y: 200, time: 100 + dtMs }).state;
    return endGesture(state);
  }

  // Slow drag of 35px (< DISTANCE) does not commit.
  let res = twoStep(createSwipeState({ paneIndex: 0 }), 5, 35, 1000);
  assert.equal(res.committed, false);
  assert.equal(res.state.leftOpen, false);

  // Slow drag of exactly 36px (== DISTANCE) commits even at near-zero velocity.
  res = twoStep(createSwipeState({ paneIndex: 0 }), 5, 36, 1000);
  assert.equal(res.committed, true);
  assert.equal(res.state.leftOpen, true);

  // Fast flick of 13px (< FLICK_MIN) does not commit even at high velocity.
  res = twoStep(createSwipeState({ paneIndex: 0 }), 5, 13, 10);
  assert.equal(res.committed, false);
  assert.equal(res.state.leftOpen, false);

  // Slow drag of 20px (>= FLICK_MIN, velocity ~0.02 < FLICK_V) does not commit.
  res = twoStep(createSwipeState({ paneIndex: 0 }), 5, 20, 1000);
  assert.equal(res.committed, false);
  assert.equal(res.state.leftOpen, false);

  // Fast flick of 14px (== FLICK_MIN, velocity > FLICK_V) commits for both sidebar and pager!
  res = twoStep(createSwipeState({ paneIndex: 0 }), 5, 14, 20);
  assert.equal(res.committed, true);
  assert.equal(res.state.leftOpen, true);

  res = twoStep(createSwipeState({ paneIndex: 1 }), -5, -14, 20);
  assert.equal(res.mode, "pager");
  assert.equal(res.committed, true);
  assert.equal(res.state.paneIndex, 2);
});

test("cancelGesture clears an active drag without committing state changes", () => {
  let state = beginGesture(createSwipeState({ paneIndex: 0 }), { x: 100, y: 200, time: 0, stageWidth: 390 });
  state = moveGesture(state, { x: 180, y: 200, time: 50 }).state;
  assert.equal(state.gesture.mode, "open-left");

  const cancelled = cancelGesture(state);
  assert.equal(cancelled.gesture, null);
  assert.equal(cancelled.leftOpen, false);
  assert.equal(cancelled.paneIndex, 0);
});

test("computeTransforms calculates resting and live-drag GPU coordinates", () => {
  // Resting on Response (pane 1) with both sidebars closed.
  assert.deepEqual(computeTransforms(createSwipeState({ paneIndex: 1 }), { stageWidth: 390 }), {
    trackX: -390,
    leftX: -SWIPE_PANEL_WIDTH,
    rightX: SWIPE_PANEL_WIDTH,
    scrimOpacity: 0,
  });

  // Resting with left sidebar open.
  assert.deepEqual(computeTransforms(createSwipeState({ paneIndex: 2, leftOpen: true }), { stageWidth: 390 }), {
    trackX: -780,
    leftX: 0,
    rightX: SWIPE_PANEL_WIDTH,
    scrimOpacity: 1,
  });

  // Mid-drag open-left halfway (132px of 264px).
  let state = beginGesture(createSwipeState({ paneIndex: 0 }), { x: 50, y: 200, time: 0, stageWidth: 390 });
  state = moveGesture(state, { x: 56, y: 200, time: 16 }).state; // anchorX = 56
  state = moveGesture(state, { x: 188, y: 200, time: 32 }).state; // currentDx = 132
  assert.deepEqual(computeTransforms(state, { stageWidth: 390 }), {
    trackX: 0,
    leftX: -132,
    rightX: SWIPE_PANEL_WIDTH,
    scrimOpacity: 0.5,
  });

  // Mid-drag pager clamped cleanly at stage bounds.
  let pager = beginGesture(createSwipeState({ paneIndex: 1 }), { x: 200, y: 200, time: 0, stageWidth: 390 });
  pager = moveGesture(pager, { x: 194, y: 200, time: 16 }).state; // anchorX = 194
  pager = moveGesture(pager, { x: 144, y: 200, time: 32 }).state; // currentDx = -50
  assert.deepEqual(computeTransforms(pager, { stageWidth: 390 }), {
    trackX: -440,
    leftX: -SWIPE_PANEL_WIDTH,
    rightX: SWIPE_PANEL_WIDTH,
    scrimOpacity: 0,
  });
});
