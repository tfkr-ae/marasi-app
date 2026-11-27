// Canonical built-in page definitions for the app rail (GLOSSARY "App rail"
// and "Rail order"), plus pure resolution, reordering, drag-target math, and
// narrow mobile bottom-bar projection.

export const HOME_RAIL_PAGE = Object.freeze({
  id: "home",
  label: "Home",
  route: "/",
  actionId: "global.go-home",
});

// The 10 reorderable built-in pages below Home, in canonical factory order.
export const BUILTIN_RAIL_PAGES = Object.freeze([
  Object.freeze({ id: "ledger", label: "Ledger", route: "/ledger", actionId: "global.go-ledger" }),
  Object.freeze({ id: "compass", label: "Compass", route: "/compass", actionId: "global.go-compass" }),
  Object.freeze({ id: "checkpoint", label: "Checkpoint", route: "/checkpoint", actionId: "global.go-checkpoint" }),
  Object.freeze({ id: "launchpad", label: "Launchpad", route: "/launchpad", actionId: "global.go-launchpad" }),
  Object.freeze({ id: "armory", label: "Armory", route: "/armory", actionId: "global.go-armory" }),
  Object.freeze({ id: "logbook", label: "Logbook", route: "/logbook", actionId: "global.go-logbook" }),
  Object.freeze({ id: "workshop", label: "Workshop", route: "/workshop", actionId: "global.go-workshop" }),
  Object.freeze({
    id: "cyberchef",
    label: "CyberChef",
    route: "/cyberchef",
    actionId: "global.go-cyberchef",
    fallbackShortcut: "shift+y",
  }),
  Object.freeze({
    id: "excalidraw",
    label: "Excalidraw",
    route: "/excalidraw",
    actionId: "global.go-excalidraw",
    fallbackShortcut: "shift+j",
  }),
  Object.freeze({ id: "interact", label: "Interactsh", route: "/interact", actionId: "global.go-interact" }),
]);

export const DEFAULT_RAIL_ORDER = Object.freeze(BUILTIN_RAIL_PAGES.map((page) => page.id));

const PAGES_BY_ID = Object.freeze(
  Object.fromEntries(BUILTIN_RAIL_PAGES.map((page) => [page.id, page])),
);

/**
 * Resolves a saved list of rail page ids against the canonical built-in list:
 * - Empty/null input returns the canonical default order.
 * - Normalizes (trims, lowercases), ignores unknown/removed ids, and
 *   deduplicates keeping first occurrence.
 * - Any canonical page missing from the saved list is inserted at its
 *   canonical default index (clamped to the current length), so future
 *   releases can place newly added pages at their intended default slot.
 */
export function resolveRailOrder(savedIds, canonical = BUILTIN_RAIL_PAGES) {
  const canonicalIds = canonical.map((page) => page.id);
  if (!Array.isArray(savedIds) || savedIds.length === 0) {
    return [...canonicalIds];
  }
  const known = new Set(canonicalIds);
  const seen = new Set();
  const resolved = [];
  for (const raw of savedIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  if (resolved.length === 0) {
    return [...canonicalIds];
  }
  for (let i = 0; i < canonicalIds.length; i++) {
    const id = canonicalIds[i];
    if (seen.has(id)) continue;
    const insertAt = Math.min(i, resolved.length);
    resolved.splice(insertAt, 0, id);
    seen.add(id);
  }
  return resolved;
}

/** Resolves a saved list of ids into the ordered built-in page definitions. */
export function resolveRailPages(savedIds, canonical = BUILTIN_RAIL_PAGES) {
  const byId = canonical === BUILTIN_RAIL_PAGES
    ? PAGES_BY_ID
    : Object.fromEntries(canonical.map((page) => [page.id, page]));
  return resolveRailOrder(savedIds, canonical).map((id) => byId[id]);
}

/** Reports whether the resolved rail order matches the canonical default order. */
export function isDefaultRailOrder(ids, canonical = BUILTIN_RAIL_PAGES) {
  const canonicalIds = canonical.map((page) => page.id);
  const resolved = resolveRailOrder(ids, canonical);
  if (resolved.length !== canonicalIds.length) return false;
  for (let i = 0; i < canonicalIds.length; i++) {
    if (resolved[i] !== canonicalIds[i]) return false;
  }
  return true;
}

/** Returns a new array with the item at `fromIndex` moved to `toIndex`. */
export function reorderRailOrder(ids, fromIndex, toIndex) {
  const next = Array.isArray(ids) ? [...ids] : [];
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= next.length ||
    toIndex >= next.length
  ) {
    return next;
  }
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Given the vertical midpoints of rendered rows and a pointer's Y coordinate,
 * returns the insertion boundary index `0..midpoints.length`.
 */
export function dropSlotFromMidpoints(midpoints, clientY) {
  for (let i = 0; i < midpoints.length; i++) {
    if (clientY < midpoints[i]) return i;
  }
  return midpoints.length;
}

/**
 * Maps a drag's `fromIndex` and insertion `dropSlot` (`0..length`) to the
 * destination index for `reorderRailOrder`, or `null` if dropping back into
 * the item's original position.
 */
export function targetIndexFromDropSlot(fromIndex, dropSlot) {
  if (dropSlot === fromIndex || dropSlot === fromIndex + 1) return null;
  return dropSlot > fromIndex ? dropSlot - 1 : dropSlot;
}

/**
 * Projects resolved built-in rail pages into the narrow mobile bottom bar:
 * Home + first 4 visible pages in `primary` (5 tabs total, skipping hidden
 * CyberChef), and the remaining visible pages in `more` in rail order.
 */
export function projectBottomBar(resolvedPages, { chefShown = true } = {}) {
  const visible = (resolvedPages ?? []).filter(
    (page) => chefShown || page.id !== "cyberchef",
  );
  return {
    primary: [HOME_RAIL_PAGE, ...visible.slice(0, 4)],
    more: visible.slice(4),
  };
}
