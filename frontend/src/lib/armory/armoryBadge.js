// The Armory rail icon's badge: the count of runs in progress across every
// template (the store's active set). None, no badge.

/** The badge label (null for none) and the rail icon's title for `count` runs. */
export function armoryBadge(count) {
  if (!count) return { label: null, title: "Armory" };
  return { label: count > 99 ? "99+" : String(count), title: `Armory · ${count} running` };
}
