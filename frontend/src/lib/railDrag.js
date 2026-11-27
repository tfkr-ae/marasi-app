// Pure desktop app rail pointer drag-and-drop state controller.
// Keeps threshold gating, drop-slot tracking, click suppression, and
// Escape/cancel handling testable without DOM globals.
import {
  dropSlotFromMidpoints,
  reorderRailOrder,
  targetIndexFromDropSlot,
} from "./railOrder.js";

export const RAIL_DRAG_THRESHOLD_PX = 6;

/** Only desktop primary non-touch pointer interactions may start a rail drag. */
export function canStartRailDrag({
  mobile = false,
  button = 0,
  pointerType = "mouse",
} = {}) {
  return !mobile && button === 0 && pointerType !== "touch";
}

/**
 * Reorders `fullOrder` after dragging item `fromVisibleIndex` of `visibleIds`
 * to insertion boundary `dropSlot` (`0..visibleIds.length`). Returns `null`
 * when dropping back into the item's original slot or on invalid indices.
 */
export function reorderVisibleRailOrder(
  fullOrder,
  visibleIds,
  fromVisibleIndex,
  dropSlot,
) {
  if (!Array.isArray(fullOrder) || !Array.isArray(visibleIds)) return null;
  if (fromVisibleIndex < 0 || fromVisibleIndex >= visibleIds.length) return null;
  if (dropSlot < 0 || dropSlot > visibleIds.length) return null;

  const targetVisibleIndex = targetIndexFromDropSlot(fromVisibleIndex, dropSlot);
  if (targetVisibleIndex === null) return null;

  if (
    visibleIds.length === fullOrder.length &&
    visibleIds.every((id, idx) => id === fullOrder[idx])
  ) {
    return reorderRailOrder(fullOrder, fromVisibleIndex, targetVisibleIndex);
  }

  const movedId = visibleIds[fromVisibleIndex];
  const fromFullIndex = fullOrder.indexOf(movedId);
  if (fromFullIndex < 0) return null;

  const without = fullOrder.filter((id) => id !== movedId);
  let insertAt;
  if (dropSlot >= visibleIds.length) {
    const lastVisibleId = visibleIds[visibleIds.length - 1];
    const lastIdx = without.indexOf(lastVisibleId);
    insertAt = lastIdx >= 0 ? lastIdx + 1 : without.length;
  } else {
    const anchorId = visibleIds[dropSlot];
    const anchorIdx = without.indexOf(anchorId);
    insertAt = anchorIdx >= 0 ? anchorIdx : without.length;
  }
  without.splice(insertAt, 0, movedId);
  return without;
}

export function createRailDragController({
  threshold = RAIL_DRAG_THRESHOLD_PX,
} = {}) {
  let session = null;
  let suppressClick = false;
  let cancelledPointerId = null;

  function publicState() {
    if (!session) return null;
    return {
      pageId: session.pageId,
      fromIndex: session.fromIndex,
      dropSlot: session.dropSlot,
      active: session.active,
    };
  }

  function pointerDown({
    pageId,
    fromIndex,
    pointerId,
    clientX,
    clientY,
    button = 0,
    pointerType = "mouse",
    mobile = false,
  }) {
    suppressClick = false;
    cancelledPointerId = null;
    if (!canStartRailDrag({ mobile, button, pointerType })) {
      return { started: false, state: null };
    }
    session = {
      pageId,
      fromIndex,
      pointerId,
      startX: clientX,
      startY: clientY,
      dropSlot: fromIndex,
      active: false,
      threshold,
    };
    return { started: true, state: publicState() };
  }

  function pointerMove({ pointerId, clientX, clientY, midpoints = [] }) {
    if (!session || pointerId !== session.pointerId) {
      return { changed: false, activated: false, state: publicState() };
    }
    let activated = false;
    if (!session.active) {
      const distance = Math.hypot(
        clientX - session.startX,
        clientY - session.startY,
      );
      if (distance < session.threshold) {
        return { changed: false, activated: false, state: publicState() };
      }
      session.active = true;
      activated = true;
    }
    const nextDropSlot = dropSlotFromMidpoints(midpoints, clientY);
    const changed = activated || nextDropSlot !== session.dropSlot;
    session.dropSlot = nextDropSlot;
    return { changed, activated, state: publicState() };
  }

  function pointerUp({ pointerId, fullOrder, visibleIds }) {
    if (
      !session &&
      cancelledPointerId !== null &&
      pointerId === cancelledPointerId
    ) {
      cancelledPointerId = null;
      suppressClick = true;
      return { wasActive: false, nextOrder: null, suppressClick: true };
    }
    if (!session || pointerId !== session.pointerId) {
      return { wasActive: false, nextOrder: null, suppressClick: false };
    }
    const { active, fromIndex, dropSlot } = session;
    session = null;
    if (!active) {
      return { wasActive: false, nextOrder: null, suppressClick: false };
    }
    suppressClick = true;
    const nextOrder = reorderVisibleRailOrder(
      fullOrder,
      visibleIds ?? fullOrder,
      fromIndex,
      dropSlot,
    );
    return { wasActive: true, nextOrder, suppressClick: true };
  }

  function cancel({ pointerId } = {}) {
    if (!session) {
      return { cancelled: false, wasActive: false, suppressClick: false };
    }
    if (pointerId !== undefined && pointerId !== session.pointerId) {
      return { cancelled: false, wasActive: false, suppressClick: false };
    }
    const wasActive = session.active;
    const activePointerId = session.pointerId;
    session = null;
    if (wasActive) {
      suppressClick = true;
      cancelledPointerId = pointerId === undefined ? activePointerId : null;
    }
    return { cancelled: true, wasActive, suppressClick: wasActive };
  }

  function consumeSuppressedClick() {
    if (!suppressClick) return false;
    suppressClick = false;
    cancelledPointerId = null;
    return true;
  }

  function clearSuppressedClick() {
    suppressClick = false;
    cancelledPointerId = null;
  }

  return {
    state: publicState,
    pointerDown,
    pointerMove,
    pointerUp,
    cancel,
    consumeSuppressedClick,
    clearSuppressedClick,
  };
}
