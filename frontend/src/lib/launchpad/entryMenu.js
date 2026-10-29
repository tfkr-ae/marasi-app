// The Launchpad tree's context menu for an Entry selection, as data in the
// shape of the Ledger's row menu (ledger/rowMenu.js), so RowMenu.svelte
// renders it and menuAction runs its shortcuts. Every item is a Move, to the
// end of another launchpad or to a new place in this one, a removal,
// copying one entry's browser view URL, or a Finding or Test case item.
// Plain functions, so they load under node.
//
// Actions:
//   { type: "move", targetId, name }   to the end of another launchpad
//   { type: "reorder", before }        within the launchpad; before null is the end
//   { type: "remove" }                 unlink from the launchpad
//   { type: "browser-view", id }       copy the entry's browser view URL
//   { type: "new-finding" }            a new finding with the entries' pairs
//   { type: "new-test-case" }          a new test case with the entries' pairs
//   { type: "link-finding", id, title }      also unlink-finding,
//   { type: "link-test-case", id, title }    unlink-test-case
import { unlessLaunching } from "../launchPending.js";
import { UNTITLED_LAUNCHPAD } from "./format.js";
import { moveRefusal } from "./entryMove.js";
import { browserViewRefusal } from "../browserView.js";
import { linkMenu } from "../ledger/rowMenu.js";

const entriesLabel = (n) => (n === 1 ? "" : ` ${n.toLocaleString()}`);

// Where each Order item puts the picked block, as the `before` a Move takes
// (null for the end), or undefined when the block is already there. The
// block keeps its order; up and down hop it over the nearest unpicked entry.
function reorderBefore(order, picked) {
  const rest = order.filter((id) => !picked.has(id));
  const first = order.findIndex((id) => picked.has(id));
  const last = order.findLastIndex((id) => picked.has(id));
  const atTop = order.slice(0, picked.size).every((id) => picked.has(id));
  const atBottom = order.slice(-picked.size).every((id) => picked.has(id));
  const above = order.slice(0, first).filter((id) => !picked.has(id)).at(-1);
  const below = order.slice(last + 1).find((id) => !picked.has(id));
  return {
    top: atTop ? undefined : rest[0],
    up: above,
    down: below ? rest[rest.indexOf(below) + 1] ?? null : undefined,
    bottom: atBottom ? undefined : null,
  };
}

/**
 * The Finding and Test case items over `entries`, through the Ledger's
 * `linkMenu`: an entry's ID is its pair's. `findings` and `testCases` each
 * hold the pair IDs they link as Requests. A link only points a record at a
 * pair that already exists, so pending launches disable none of them.
 * `newActionIds` names the New items' keybindings, if any.
 */
export function recordItems(entries, { findings = [], testCases = [], newActionIds = {} } = {}) {
  return [
    {
      id: "finding",
      label: "Finding",
      icon: "finding",
      ...linkMenu({
        key: "f",
        noun: "finding",
        pairs: entries,
        targets: findings,
        newActionId: newActionIds.finding,
        newType: "new-finding",
        linkType: "link-finding",
        unlinkType: "unlink-finding",
      }),
    },
    {
      id: "testcase",
      label: "Test case",
      icon: "testcase",
      ...linkMenu({
        key: "t",
        noun: "test case",
        pairs: entries,
        targets: testCases,
        newActionId: newActionIds.testCase,
        newType: "new-test-case",
        linkType: "link-test-case",
        unlinkType: "unlink-test-case",
      }),
    },
  ];
}

const ORDER_ITEMS = [
  ["top", "Move to top", "Already first"],
  ["up", "Move up", "Already first"],
  ["down", "Move down", "Already last"],
  ["bottom", "Move to bottom", "Already last"],
];

/**
 * The menu for the Entry selection `ids` in launchpad `launchpadId`, whose
 * `entries` are in entry order. `launchpads` is the launchpad list,
 * `entriesByLaunchpad` the entry lists loaded so far, `pendingIds` the
 * entries whose launch is pending, and `findings` and `testCases` the
 * project's records for the Finding and Test case items. Reordering is off
 * while the tree is `grouped` by status or `searching`; moving to another
 * launchpad's end is not.
 */
export function entryMenuFor({
  launchpadId,
  entries = [],
  ids = [],
  launchpads = [],
  entriesByLaunchpad = {},
  pendingIds = [],
  findings = [],
  testCases = [],
  grouped = false,
  searching = false,
}) {
  const order = entries.map((entry) => entry.ID);
  const picked = order.filter((id) => ids.includes(id));
  const n = picked.length;
  const launching = picked.filter((id) => pendingIds.includes(id)).length;
  const targets = launchpads
    .filter((launchpad) => launchpad.ID !== launchpadId)
    .map((launchpad) => {
      const name = launchpad.Name || UNTITLED_LAUNCHPAD;
      const refused = moveRefusal({
        sourceId: launchpadId,
        ids: picked,
        target: { launchpadId: launchpad.ID, via: "launchpad" },
        targetName: name,
        targetIds: entriesByLaunchpad[launchpad.ID]?.map((entry) => entry.ID) ?? null,
        pendingIds,
        grouped,
        searching,
      });
      return {
        id: `mv-${launchpad.ID}`,
        label: name,
        count: launchpad.EntryCount ?? 0,
        ...(refused ? { disabled: true, hint: refused } : {}),
        action: { type: "move", targetId: launchpad.ID, name },
      };
    });
  // A pending entry refuses every target alike, so the submenu is shut.
  const moveOff = !targets.length ? "No other launchpads" : launching ? targets[0].hint : null;
  const reorderOff = grouped ? "Grouped by status" : searching ? "Searching" : null;
  const before = reorderBefore(order, new Set(picked));
  const one = n === 1 ? entries.find((entry) => entry.ID === picked[0]) : null;
  const viewOff = one ? browserViewRefusal(one) : "One entry at a time";
  return [
    {
      id: "move",
      label: `Move${entriesLabel(n)} to launchpad`,
      icon: "move",
      ...(moveOff ? { disabled: true, hint: moveOff } : {}),
      sub: [{ heading: "Adds at the end" }, ...targets],
    },
    { heading: "Order" },
    ...ORDER_ITEMS.map(([key, label, already]) => ({
      id: key,
      label,
      icon: key,
      actionId: `launchpad.tree.move-entries-${key}`,
      ...(reorderOff || before[key] === undefined ? { disabled: true, hint: reorderOff ?? already } : {}),
      action: { type: "reorder", before: before[key] ?? null },
    })),
    "sep",
    {
      id: "browser-view",
      label: "Copy browser view URL",
      icon: "globe",
      ...(viewOff ? { disabled: true, hint: viewOff } : {}),
      action: { type: "browser-view", id: picked[0] },
    },
    "sep",
    ...recordItems(
      entries.filter((entry) => picked.includes(entry.ID)),
      {
        findings,
        testCases,
        newActionIds: { finding: "launchpad.tree.create-finding", testCase: "launchpad.tree.create-test-case" },
      },
    ),
    "sep",
    {
      id: "remove",
      label: `Remove${entriesLabel(n)} from launchpad`,
      icon: "unlink",
      danger: true,
      // Marasi keeps a pending launch's pair in its launchpad (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md).
      ...unlessLaunching(launching),
      action: { type: "remove" },
    },
  ];
}
