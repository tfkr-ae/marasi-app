// Armory's traffic row menu as data: a pared-down Ledger row menu with only
// Send to Launchpad, Finding and Test case, built from the Ledger's own item
// builders (lib/ledger/rowMenu.js), so RowMenu.svelte draws them, and the
// action types are the Ledger's, run by the Armory page against the pairs'
// IDs. Plain functions, so they load under node.

import { addToLaunchpadItem, linkMenu, newLaunchpadItem } from "../ledger/rowMenu.js";

/**
 * The menu for `pairs`, the traffic pairs it acts on. `context` holds what
 * the app already knows: { launchpads, findings, testCases }, the last two
 * each with the pair IDs they link as Requests.
 */
export function armoryMenuFor(pairs, { launchpads = [], findings = [], testCases = [] } = {}) {
  if (pairs.length === 0) return [];
  return [
    {
      id: "launchpad",
      label: "Send to Launchpad",
      icon: "send",
      sub: [newLaunchpadItem(pairs.length === 1, pairs.length), addToLaunchpadItem(launchpads)],
    },
    "sep",
    {
      id: "finding",
      label: "Finding",
      icon: "finding",
      ...linkMenu({
        key: "f",
        noun: "finding",
        pairs,
        targets: findings,
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
        pairs,
        targets: testCases,
        newType: "new-test-case",
        linkType: "link-test-case",
        unlinkType: "unlink-test-case",
      }),
    },
  ];
}
