// The floating "End of …" button of the Launchpad tree, like the
// WebSocket table's "Jump to bottom". Pure, so it takes measured geometry.

/** Height of the sticky launchpad row that covers the top of the tree. */
export const STICKY_HEADER = 34;
/** Sub-pixel tolerance when deciding the last entry is fully visible. */
const FOLD_SLACK = 1;

/**
 * The list (a launchpad, or one status folder) whose button to show, or null.
 * `rows` are the tree's rows in document order, each
 * `{ list, label, top, bottom, last }` in viewport pixels, with a null `list`
 * for rows outside any list such as a collapsed launchpad or folder header;
 * `view` is the scroll container's `{ top, bottom }`. The target is the list
 * the row at the top of the viewport belongs to, while that list's last entry
 * is not fully visible. A top row outside any list has no target.
 */
export function jumpTarget(rows, view) {
  const top = rows.find((row) => row.bottom > view.top + STICKY_HEADER);
  if (!top?.list) return null;
  const last = rows.find((row) => row.list === top.list && row.last);
  if (!last || last.bottom <= view.bottom + FOLD_SLACK) return null;
  return { list: top.list, label: last.label };
}

/**
 * What ⌘J (Jump to Last Entry) selects: the open launchpad's last Launchpad entry in entry order as
 * `{ launchpadId, entryId }`, or null when there is none to select.
 */
export function lastEntry({ selectedLaunchpadId, entriesByLaunchpad }) {
  const last = entriesByLaunchpad[selectedLaunchpadId]?.at(-1);
  return last ? { launchpadId: selectedLaunchpadId, entryId: last.ID } : null;
}
