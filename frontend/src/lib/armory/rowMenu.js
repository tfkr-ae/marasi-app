// Armory's traffic row menu as data: a pared-down Ledger row menu with only
// Send to Launchpad, Finding and Test case. The items have the shape of the
// Ledger's rowMenu.js, so RowMenu.svelte draws them, and the action types
// are the Ledger's, run by the Armory page against the pairs' IDs. Plain
// functions, so they load under node.

import { UNTITLED_LAUNCHPAD } from "../launchpad/format.js";

// Link state of a finding or test case over the pairs: true when every pair
// is linked, "mixed" when some are, false when none are.
function linkState(target, pairs) {
  const linked = new Set((target.Requests ?? []).map(String));
  const count = pairs.filter((pair) => linked.has(String(pair.ID))).length;
  return count === 0 ? false : count === pairs.length ? true : "mixed";
}

// The Finding and Test case submenus share a shape.
function linkMenu({ key, noun, pairs, targets, newType, linkType, unlinkType }) {
  const states = targets.map((target) => [target, linkState(target, pairs)]);
  const linked = states.filter(([, state]) => state);
  const title = (target) => target.Title || `Untitled ${noun}`;
  return {
    badge: linked.length || null,
    sub: [
      {
        id: `${key}-new`,
        label: pairs.length === 1 ? `New ${noun} from this request` : `New ${noun} with ${pairs.length} requests`,
        icon: "plus",
        action: { type: newType },
      },
      {
        id: `${key}-link`,
        label: `Link to ${noun}`,
        icon: "link",
        disabled: !targets.length,
        hint: `No ${noun}s yet`,
        sub: states.map(([target, checked]) => ({
          id: `${key}-${target.ID}`,
          label: title(target),
          severity: target.Severity,
          checked,
          // Linking pairs that are all linked already changes nothing.
          disabled: checked === true,
          hint: "Already linked",
          action: { type: linkType, id: target.ID, title: title(target) },
        })),
      },
      ...(linked.length
        ? [
            {
              id: `${key}-unlink`,
              label: `Unlink from ${noun}`,
              icon: "unlink",
              sub: linked.map(([target]) => ({
                id: `${key}u-${target.ID}`,
                label: title(target),
                action: { type: unlinkType, id: target.ID, title: title(target) },
              })),
            },
          ]
        : []),
    ],
  };
}

/**
 * The menu for `pairs`, the traffic pairs it acts on. `context` holds what
 * the app already knows: { launchpads, findings, testCases }, the last two
 * each with the pair IDs they link as Requests.
 */
export function armoryMenuFor(pairs, { launchpads = [], findings = [], testCases = [] } = {}) {
  if (pairs.length === 0) return [];
  const one = pairs.length === 1;
  return [
    {
      id: "launchpad",
      label: "Send to Launchpad",
      icon: "send",
      sub: [
        {
          id: "lp-new",
          label: one ? "New launchpad" : `New launchpad with ${pairs.length} entries`,
          icon: "plus",
          action: { type: "new-launchpad" },
        },
        {
          id: "lp-add",
          label: "Add to launchpad",
          icon: "link",
          disabled: !launchpads.length,
          hint: "No launchpads yet",
          sub: launchpads.map((launchpad) => ({
            id: `lp-${launchpad.ID}`,
            label: launchpad.Name || UNTITLED_LAUNCHPAD,
            action: { type: "add-to-launchpad", id: launchpad.ID, name: launchpad.Name },
          })),
        },
      ],
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
