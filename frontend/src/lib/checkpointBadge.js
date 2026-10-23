// The Checkpoint rail icon's badge: the count of intercepted items, in place
// of the old "Request Intercepted · Jump" toasts. No items, no badge.

/** The badge label (null for none) and the rail icon's title for `count` items. */
export function checkpointBadge(count) {
  if (!count) return { label: null, title: "Checkpoint" };
  return {
    label: count > 99 ? "99+" : String(count),
    title: `Checkpoint · ${count} intercepted`,
  };
}
