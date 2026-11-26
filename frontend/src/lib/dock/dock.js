// Sizing rules for a side dock (the Launchpad's launchpads, the Ledger's
// sitemap): drag to any width, collapse to the strip only when a drag ends
// about as narrow as the strip. Each dock has its own default and maximum.

/** The collapsed strip's width, in px (Tailwind's w-11). */
export const DOCK_STRIP = 44;

/** Every dock collapses when a drag ends narrower than this, in px. */
export const DOCK_SNAP = 64;

/** The Launchpad dock's limits, in px. */
export const DOCK = { default: 400, max: 640, snap: DOCK_SNAP };

/** The Ledger dock's limits, in px. */
export const LEDGER_DOCK = { default: 320, max: 560, snap: DOCK_SNAP };

/** The Checkpoint dock's limits, in px. */
export const CHECKPOINT_DOCK = { default: 360, max: 560, snap: DOCK_SNAP };

/** The Armory dock's limits, in px. */
export const ARMORY_DOCK = { default: 300, max: 520, snap: DOCK_SNAP };

/** The live width while dragging `delta` px from `startWidth`. */
export function dragWidth(startWidth, delta, limits = DOCK) {
  return Math.min(limits.max, Math.max(0, startWidth + delta));
}

/**
 * Where the dock settles when the drag ends at `width`: open at that width,
 * or, below the snap point, collapsed, keeping `previousWidth` for the next
 * expand.
 */
export function settleDrag(width, previousWidth, limits = DOCK) {
  if (width < limits.snap) return { collapsed: true, width: previousWidth };
  return { collapsed: false, width: Math.min(limits.max, Math.round(width)) };
}

/** The dock after ⌘\: collapsed when open, open at its width when collapsed. */
export function toggleDock(dock) {
  return { ...dock, collapsed: !dock.collapsed };
}
