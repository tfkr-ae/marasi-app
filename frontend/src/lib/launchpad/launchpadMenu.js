// The Launchpad tree's context menu for a launchpad row, as data in the
// shape of the Ledger's row menu (ledger/rowMenu.js), so RowMenu.svelte
// renders it. It acts on that launchpad, which need not be the open one.
// Plain functions, so they load under node.
//
// Actions: the Finding and Test case ones of entryMenu.js, and
//   { type: "rename" }                 prompt for the launchpad's name
//   { type: "delete" }                 delete the launchpad
import { DELETE_LAUNCHPAD_PENDING_HINT } from "../launchPending.js";
import { recordItems } from "./entryMenu.js";

/**
 * The menu for one launchpad in the tree, over all of its `entries`, with
 * the project's `findings` and `testCases` for the Finding and Test case
 * items. `pending` says whether a launch from that launchpad is pending,
 * which greys Delete launchpad. The page loads a collapsed launchpad's
 * entries before opening it, so the link states are never partial.
 * Rename… and Delete launchpad follow them after a divider.
 */
export function launchpadMenuFor({ entries = [], findings = [], testCases = [], pending = false }) {
  const records = recordItems(entries, { findings, testCases });
  return [
    ...(entries.length ? records : records.map((it) => ({ ...it, disabled: true, hint: "No entries" }))),
    "sep",
    { id: "rename", label: "Rename…", icon: "pen", action: { type: "rename" } },
    {
      id: "delete",
      label: "Delete launchpad",
      icon: "trash",
      danger: true,
      // Marasi refuses while a launch from it is pending (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md).
      ...(pending ? { disabled: true, hint: DELETE_LAUNCHPAD_PENDING_HINT } : {}),
      action: { type: "delete" },
    },
  ];
}
