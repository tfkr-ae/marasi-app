// Sizing rules for a side dock (the Launchpad's launchpads, the Ledger's
// sitemap): drag to resize, snap to a strip. Each dock has its own limits.

/** The Launchpad dock's limits, in px. */
export const DOCK = { default: 400, min: 260, max: 640, snap: 170 };

/** The Ledger dock's limits, in px. */
export const LEDGER_DOCK = { default: 320, min: 240, max: 560, snap: 170 };

/** The Checkpoint dock's limits, in px. */
export const CHECKPOINT_DOCK = { default: 360, min: 260, max: 560, snap: 170 };

/** The Armory dock's limits, in px. */
export const ARMORY_DOCK = { default: 300, min: 240, max: 520, snap: 170 };

/** The live width while dragging `delta` px from `startWidth`. */
export function dragWidth(startWidth, delta, limits = DOCK) {
  return Math.min(limits.max, Math.max(0, startWidth + delta));
}

/**
 * Where the dock settles when the drag ends at `width`. Below the snap point
 * it collapses and keeps `previousWidth` for the next expand.
 */
export function settleDrag(width, previousWidth, limits = DOCK) {
  if (width < limits.snap) return { collapsed: true, width: previousWidth };
  return { collapsed: false, width: Math.max(limits.min, width) };
}

/** The dock after ⌘\: collapsed when open, open at its width when collapsed. */
export function toggleDock(dock) {
  return { ...dock, collapsed: !dock.collapsed };
}
