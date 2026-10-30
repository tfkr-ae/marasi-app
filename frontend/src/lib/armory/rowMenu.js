// Armory's traffic row menu as data: a pared-down Ledger row menu with only
// Send to Launchpad, Finding and Test case, built from the Ledger's own item
// builders (lib/ledger/rowMenu.js), so RowMenu.svelte draws them, and the
// action types are the Ledger's, run by the Armory page against the pairs'
// IDs. Plain functions, so they load under node.

import { addToLaunchpadItem, linkMenu, newLaunchpadItem } from "../ledger/rowMenu.js";

/**
 * The menu for `target`, what it acts on (see pairTarget). `context` holds
 * what the app already knows: { launchpads, findings, testCases }, the last
 * two each with the pair IDs they link as Requests. A query selection can
 * hold pairs not loaded, so New finding and New test case, which list each
 * pair, are disabled for it, as in the Ledger.
 */
export function armoryMenuFor({ pairs, selection, count }, { launchpads = [], findings = [], testCases = [] } = {}) {
  if (!selection || count === 0) return [];
  const partial = !selection.ids;
  const one = count === 1;
  const n = count == null ? "all" : count.toLocaleString();
  return [
    {
      id: "launchpad",
      label: "Send to Launchpad",
      icon: "send",
      sub: [newLaunchpadItem(one, n), addToLaunchpadItem(launchpads)],
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
        one,
        n,
        partial,
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
        one,
        n,
        partial,
        targets: testCases,
        newType: "new-test-case",
        linkType: "link-test-case",
        unlinkType: "unlink-test-case",
      }),
    },
  ];
}

/**
 * What the row menu acts on, in the shape of the Ledger's rowMenuTarget:
 * the loaded pairs, the selection in Marasi's shape (selectionSpec: { ids },
 * or a query with its as_of), and how many pairs it holds. This one is the
 * single pair `pair`.
 */
export function pairTarget(pair) {
  return { pairs: [pair], selection: { ids: [String(pair.ID)] }, count: 1 };
}

// The pair number of `id`: its own, else the Ledger's for a pair that
// arrived live without one.
const numberIn = (target, ledger) => (id) =>
  target.pairs.find((pair) => String(pair.ID) === String(id))?.Number || ledger.pairNumber(id);

/**
 * Runs a row menu action on `target` through the Ledger store's bulk
 * methods (`ledger`), or opens a new record with its pairs (`newRecord`, as
 * lib/logbook/recordEditor.js's). Resolves to what happened, for the page to report;
 * a refusal rejects.
 */
export async function runArmoryAction(action, target, { ledger, newRecord }) {
  switch (action.type) {
    case "new-launchpad": {
      const { launchpadId } = await ledger.sendToNewLaunchpad(target.selection, target.count, {
        numberOf: numberIn(target, ledger),
      });
      return { type: action.type, launchpadId };
    }
    case "add-to-launchpad": {
      const count = await ledger.addToLaunchpad(target.selection, action.id);
      return { type: action.type, launchpadId: action.id, name: action.name, count };
    }
    case "new-finding":
    case "new-test-case":
      newRecord(action.type === "new-finding" ? "finding" : "testCase", {
        requestIds: target.pairs.map((pair) => pair.ID),
      });
      return { type: action.type };
    case "link-finding":
    case "unlink-finding":
    case "link-test-case":
    case "unlink-test-case": {
      const count = await ledger[LINKS[action.type]](target.selection, action.id);
      return { type: action.type, title: action.title, count };
    }
  }
}

// The Ledger store's bulk method for each link action.
const LINKS = {
  "link-finding": "linkToFinding",
  "unlink-finding": "unlinkFromFinding",
  "link-test-case": "linkToTestCase",
  "unlink-test-case": "unlinkFromTestCase",
};
