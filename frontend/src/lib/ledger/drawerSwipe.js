// Pure horizontal gesture state machine for the narrow-mobile Ledger drawer:
// one unified gesture drives both the 4-pane carousel (Request <-> Response <->
// Note <-> Meta) and opening/closing the left Details and right Actions
// slide-over sidebars with identical thresholds. Plain JS for node --test.

export const SWIPE_PANES = ["request", "response", "note", "metadata"];
export const SWIPE_PANE_LABELS = {
  request: "Request",
  response: "Response",
  note: "Note",
  metadata: "Meta",
};

export const SWIPE_PANEL_WIDTH = 264;
/** Horizontal drag distance in px to commit a pane or sidebar transition. */
export const DISTANCE = 36;
/** Minimum horizontal drag distance in px before velocity flick counts. */
export const FLICK_MIN = 14;
/** Exponentially smoothed horizontal velocity threshold in px/ms. */
export const FLICK_V = 0.16;
/** Width in px from the stage's left or right edge that pulls a sidebar from any pane. */
export const EDGE_ZONE = 28;
/** Minimum movement in px to lock the gesture to horizontal ("x") vs native vertical ("y"). */
export const AXIS_LOCK = 4;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampPaneIndex(index) {
  return clamp(Number(index) || 0, 0, SWIPE_PANES.length - 1);
}

export function paneIndexFor(paneId) {
  const idx = SWIPE_PANES.indexOf(paneId);
  return idx >= 0 ? idx : 0;
}

/** Creates a normalized narrow-drawer state with mutually exclusive sidebars. */
export function createSwipeState({ paneIndex = 0, leftOpen = false, rightOpen = false } = {}) {
  const left = Boolean(leftOpen);
  const right = left ? false : Boolean(rightOpen);
  return {
    paneIndex: clampPaneIndex(paneIndex),
    leftOpen: left,
    rightOpen: right,
    gesture: null,
  };
}

export function setSidebars(state, { leftOpen = false, rightOpen = false } = {}) {
  const left = Boolean(leftOpen);
  const right = left ? false : Boolean(rightOpen);
  return { ...state, leftOpen: left, rightOpen: right, gesture: null };
}

export function toggleLeftSidebar(state) {
  return { ...state, leftOpen: !state.leftOpen, rightOpen: false, gesture: null };
}

export function toggleRightSidebar(state) {
  return { ...state, leftOpen: false, rightOpen: !state.rightOpen, gesture: null };
}

export function selectPane(state, indexOrId) {
  const idx = typeof indexOrId === "string" ? paneIndexFor(indexOrId) : clampPaneIndex(indexOrId);
  return { ...state, paneIndex: idx, leftOpen: false, rightOpen: false, gesture: null };
}

export function beginGesture(state, { x, y, time = 0, stageLeft = 0, stageWidth = 390 }) {
  const localX = x - stageLeft;
  return {
    ...state,
    gesture: {
      axis: null,
      mode: null,
      startX: x,
      startY: y,
      anchorX: x,
      lastX: x,
      lastTime: time,
      velocityX: 0,
      currentDx: 0,
      startedNearLeftEdge: localX <= EDGE_ZONE,
      startedNearRightEdge: localX >= stageWidth - EDGE_ZONE,
    },
  };
}

export function moveGesture(state, { x, y, time = 0 }) {
  const gesture = state.gesture;
  if (!gesture || gesture.axis === "y") {
    return { state, preventDefault: false, active: false };
  }

  let { velocityX, lastX, lastTime, axis, anchorX, mode } = gesture;
  const dt = time - lastTime;
  if (dt > 0) {
    const instant = (x - lastX) / dt;
    velocityX = velocityX * 0.3 + instant * 0.7;
    lastX = x;
    lastTime = time;
  }

  const rawDx = x - gesture.startX;
  const rawDy = y - gesture.startY;

  if (!axis) {
    if (Math.abs(rawDx) < AXIS_LOCK && Math.abs(rawDy) < AXIS_LOCK) {
      return {
        state: { ...state, gesture: { ...gesture, velocityX, lastX, lastTime } },
        preventDefault: false,
        active: false,
      };
    }
    if (Math.abs(rawDy) >= Math.abs(rawDx)) {
      return {
        state: { ...state, gesture: { ...gesture, axis: "y", velocityX, lastX, lastTime } },
        preventDefault: false,
        active: false,
      };
    }
    axis = "x";
    anchorX = x;

    if (state.leftOpen) {
      mode = rawDx < 0 ? "close-left" : null;
    } else if (state.rightOpen) {
      mode = rawDx > 0 ? "close-right" : null;
    } else if (rawDx > 0 && (gesture.startedNearLeftEdge || state.paneIndex === 0)) {
      mode = "open-left";
    } else if (rawDx < 0 && (gesture.startedNearRightEdge || state.paneIndex === SWIPE_PANES.length - 1)) {
      mode = "open-right";
    } else {
      mode = "pager";
    }
  }

  if (!mode) {
    return {
      state: { ...state, gesture: { ...gesture, axis, anchorX, mode, velocityX, lastX, lastTime } },
      preventDefault: false,
      active: false,
    };
  }

  const currentDx = x - anchorX;
  return {
    state: {
      ...state,
      gesture: { ...gesture, axis, anchorX, mode, currentDx, velocityX, lastX, lastTime },
    },
    preventDefault: true,
    active: true,
  };
}

function commitsRight(dx, vx) {
  return dx >= DISTANCE || (dx >= FLICK_MIN && vx > FLICK_V);
}

function commitsLeft(dx, vx) {
  return -dx >= DISTANCE || (-dx >= FLICK_MIN && vx < -FLICK_V);
}

export function endGesture(state) {
  const gesture = state.gesture;
  const cleared = { ...state, gesture: null };
  if (!gesture || !gesture.mode) {
    return { state: cleared, committed: false, mode: null };
  }

  const { mode, currentDx: dx, velocityX: vx } = gesture;

  if (mode === "pager") {
    let nextIdx = state.paneIndex;
    if (commitsLeft(dx, vx)) {
      nextIdx = Math.min(SWIPE_PANES.length - 1, state.paneIndex + 1);
    } else if (commitsRight(dx, vx)) {
      nextIdx = Math.max(0, state.paneIndex - 1);
    }
    return {
      state: { ...cleared, paneIndex: nextIdx, leftOpen: false, rightOpen: false },
      committed: nextIdx !== state.paneIndex,
      mode,
    };
  }

  if (mode === "open-left") {
    const committed = commitsRight(dx, vx);
    return {
      state: committed ? { ...cleared, leftOpen: true, rightOpen: false } : cleared,
      committed,
      mode,
    };
  }

  if (mode === "open-right") {
    const committed = commitsLeft(dx, vx);
    return {
      state: committed ? { ...cleared, leftOpen: false, rightOpen: true } : cleared,
      committed,
      mode,
    };
  }

  if (mode === "close-left") {
    const committed = commitsLeft(dx, vx);
    return {
      state: committed ? { ...cleared, leftOpen: false, rightOpen: false } : cleared,
      committed,
      mode,
    };
  }

  if (mode === "close-right") {
    const committed = commitsRight(dx, vx);
    return {
      state: committed ? { ...cleared, leftOpen: false, rightOpen: false } : cleared,
      committed,
      mode,
    };
  }

  return { state: cleared, committed: false, mode: null };
}

export function cancelGesture(state) {
  return state.gesture ? { ...state, gesture: null } : state;
}

/**
 * Computes the GPU translate3d X offsets (px) and scrim opacity (0..1) for the
 * 4-pane track and both slide-over sidebars, whether resting or mid-drag.
 */
export function computeTransforms(state, { stageWidth = 390, panelWidth = SWIPE_PANEL_WIDTH } = {}) {
  const width = stageWidth > 0 ? stageWidth : 390;
  const panel = panelWidth > 0 ? panelWidth : SWIPE_PANEL_WIDTH;
  const resting = {
    trackX: state.paneIndex === 0 ? 0 : -state.paneIndex * width,
    leftX: state.leftOpen ? 0 : -panel,
    rightX: state.rightOpen ? 0 : panel,
    scrimOpacity: state.leftOpen || state.rightOpen ? 1 : 0,
  };

  const gesture = state.gesture;
  if (!gesture || !gesture.mode) return resting;

  const dx = gesture.currentDx;
  if (gesture.mode === "pager") {
    const minX = -(SWIPE_PANES.length - 1) * width;
    return { ...resting, trackX: clamp(resting.trackX + dx, minX, 0) };
  }
  if (gesture.mode === "open-left") {
    const off = clamp(dx, 0, panel);
    return { ...resting, leftX: off - panel, scrimOpacity: off / panel };
  }
  if (gesture.mode === "open-right") {
    const off = clamp(-dx, 0, panel);
    return { ...resting, rightX: panel - off, scrimOpacity: off / panel };
  }
  if (gesture.mode === "close-left") {
    const off = clamp(panel + dx, 0, panel);
    return { ...resting, leftX: off - panel, scrimOpacity: off / panel };
  }
  if (gesture.mode === "close-right") {
    const off = clamp(panel - dx, 0, panel);
    return { ...resting, rightX: panel - off, scrimOpacity: off / panel };
  }
  return resting;
}
