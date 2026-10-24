// The Ledger's row context menu as data: what it offers for the selected
// pairs, and the text its Copy and Narrow query actions produce. Everything
// is computed from the pairs and the lists the app already holds, never
// fetched, so the menu opens at once. Plain functions, so they load under
// node; RowMenu.svelte renders the items and the Ledger page runs their
// actions.
//
// An item is one of:
//   "sep"                              a divider
//   { heading }                        a submenu heading
//   { id, label, icon, action?, sub?, actionId?, kbd?, disabled?, hint?,
//     checked?, badge?, severity?, danger? }
// `action` is { type, ...arguments } for the page to run on the selection.
// `actionId` names the keybinding catalog action whose keys the item shows.
// `icon` is a key into RowMenu.svelte's icon map.
// The highlight item has `swatches` instead of `sub`: one action item per
// highlight, then None, each with a `color` (null for None) and `checked`.
import { upgradeFromLedgerRow, upgradePresentation } from "../websocket/presentation.js";
import { shortType } from "./table.js";
import { effectivePalette } from "./highlights.js";
import { LAUNCHPADS_EACH_MAX } from "./pairs.js";
import { launchingIds, unlessLaunching } from "../launchPending.js";
import { UNTITLED_LAUNCHPAD } from "../launchpad/format.js";
import { browserViewRefusal } from "../browserView.js";

const unique = (values) => [...new Set(values)];

/** The pair's URL: scheme, host and path. */
export function pairURL(pair) {
  return `${pair.Scheme ?? "https"}://${pair.Host ?? ""}${pair.Path ?? ""}`;
}

// The path without its query string.
const pathOnly = (path) => String(path ?? "").split("?")[0];

// The folder a path sits in, as a wildcard: /v1/users/7 → /v1/users/*.
function pathFolder(path) {
  const clean = pathOnly(path);
  return clean.replace(/\/[^/]+$/, "/*") || "/*";
}

// A pair's highlight number, or null.
const highlightOf = (pair) => (pair?.Highlight >= 1 ? pair.Highlight : null);

// true when every pair has `number` (null: no highlight), "mixed" when some do.
function shareOf(pairs, number) {
  const count = pairs.filter((pair) => highlightOf(pair) === number).length;
  return count === 0 ? false : count === pairs.length ? true : "mixed";
}

// The context menu's highlight swatches: the palette's 8, then None.
function highlightSwatches(pairs, palette) {
  return [
    ...palette.map((h) => ({
      id: `h-${h.number}`,
      label: h.label,
      color: h.color,
      checked: shareOf(pairs, h.number),
      action: { type: "highlight", number: h.number },
    })),
    {
      id: "h-none",
      label: "None",
      color: null,
      checked: shareOf(pairs, null),
      action: { type: "highlight", number: null },
    },
  ];
}

const hasResponse = (pair) => Number(pair?.StatusCode) > 0;
const hasNote = (pair) => pair?.Metadata?.has_note == 1 || Boolean(pair?.Note);

const quote = (value) => JSON.stringify(String(value));

/**
 * Adds `term` to the query. A query with OR is grouped first, so the term
 * narrows all of it.
 */
export function narrowQuery(text, term) {
  const query = String(text ?? "").trim();
  if (!query) return term;
  const grouped = /\bOR\b/.test(query) ? `(${query})` : query;
  return `${grouped} AND ${term}`;
}

/** The header's summary: count, hosts, methods and status classes with counts. */
export function selectionSummary(pairs) {
  const methods = new Map();
  const classes = new Map();
  for (const pair of pairs) {
    methods.set(pair.Method, (methods.get(pair.Method) ?? 0) + 1);
    const status = Number(pair.StatusCode);
    if (status >= 100) {
      const key = `${Math.floor(status / 100)}xx`;
      classes.set(key, (classes.get(key) ?? 0) + 1);
    }
  }
  return {
    count: pairs.length,
    hosts: unique(pairs.map((pair) => pair.Host)),
    methods: [...methods],
    classes: [...classes].sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}

/**
 * The IDs of `rows` that are like the chosen pairs: "host" (from their
 * hosts), "endpoint" (same method, host and path), "status", "highlight"
 * (highlight `number`, or any of theirs), or "invert" (every row not
 * chosen).
 */
export function similarIDs(kind, rows, chosen, number = null) {
  const hosts = new Set(chosen.map((pair) => pair.Host));
  const endpoints = new Set(chosen.map((pair) => `${pair.Method} ${pair.Host}${pathOnly(pair.Path)}`));
  const statuses = new Set(chosen.map((pair) => Number(pair.StatusCode) || 0));
  const highlights = new Set(number != null ? [number] : chosen.map(highlightOf).filter(Boolean));
  const chosenIDs = new Set(chosen.map((pair) => String(pair.ID)));
  const test = {
    host: (row) => hosts.has(row.Host),
    endpoint: (row) => endpoints.has(`${row.Method} ${row.Host}${pathOnly(row.Path)}`),
    status: (row) => statuses.has(Number(row.StatusCode) || 0),
    highlight: (row) => highlights.has(highlightOf(row)),
    invert: (row) => !chosenIDs.has(String(row.ID)),
  }[kind];
  return test ? rows.filter(test).map((row) => String(row.ID)) : [];
}

/** A Markdown table of the pairs: number, method, URL and status. */
export function markdownTable(pairs, numberOf) {
  return [
    "| # | Method | URL | Status |",
    "|---|---|---|---|",
    ...pairs.map(
      (pair) =>
        `| ${numberOf(pair)} | ${pair.Method} | ${pairURL(pair)} | ${hasResponse(pair) ? pair.StatusCode : "—"} |`,
    ),
  ].join("\n");
}

const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

/** A cURL command for the pair from its raw request. Host comes from the URL. */
export function curlCommand(pair, raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? "" : text.slice(split + 2);
  const headers = head
    .split("\n")
    .slice(1)
    .filter((line) => line && !/^host:/i.test(line) && !/^content-length:/i.test(line));
  return [
    `curl -X ${pair.Method} ${shellQuote(pairURL(pair))}`,
    ...headers.map((line) => `  -H ${shellQuote(line)}`),
    ...(body ? [`  --data-raw ${shellQuote(body)}`] : []),
  ].join(" \\\n");
}

// Link state of a finding or test case over the pairs: true when every pair
// is linked, "mixed" when some are, false when none are; undefined when the
// selection holds pairs the table hasn't loaded, so the state is unknown.
function linkState(target, pairs, partial) {
  if (partial) return undefined;
  const linked = new Set((target.Requests ?? []).map(String));
  const count = pairs.filter((pair) => linked.has(String(pair.ID))).length;
  return count === 0 ? false : count === pairs.length ? true : "mixed";
}

/**
 * A Finding or Test case submenu's `badge` and `sub` over `pairs` and the
 * `targets` (each with the pair IDs it links as Requests). `one` and `n`
 * word the New item (one pair, else "with n requests"); `partial` marks a
 * selection holding pairs not loaded; `newActionId` names the New item's
 * keybinding. Armory's row menu (lib/armory/rowMenu.js) uses it too.
 */
export function linkMenu({
  key,
  noun,
  pairs,
  one = pairs.length === 1,
  n = pairs.length,
  partial = false,
  targets,
  newActionId,
  newType,
  linkType,
  unlinkType,
}) {
  const states = targets.map((target) => [target, linkState(target, pairs, partial)]);
  // With the state unknown, any of them can be unlinked.
  const linked = partial ? states : states.filter(([, state]) => state);
  const title = (target) => target.Title || `Untitled ${noun}`;
  return {
    badge: partial ? null : linked.length || null,
    sub: [
      {
        id: `${key}-new`,
        label: one ? `New ${noun} from this request` : `New ${noun} with ${n} requests`,
        icon: "plus",
        actionId: newActionId,
        disabled: partial,
        hint: NOT_FOR_ALL,
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
 * Send to Launchpad's New item: for one pair, else "with `many` entries".
 * `actionId` names its keybinding, if any.
 */
export function newLaunchpadItem(one, many, actionId) {
  return {
    id: "lp-new",
    label: one ? "New launchpad" : `New launchpad with ${many} entries`,
    icon: "plus",
    actionId,
    action: { type: "new-launchpad" },
  };
}

/** Send to Launchpad's "Add to launchpad" item, listing `launchpads`. */
export function addToLaunchpadItem(launchpads) {
  return {
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
  };
}

// The hint on actions that need every pair loaded, under a ⌘A selection
// that holds pairs the table hasn't loaded.
const NOT_FOR_ALL = "Not for all matching";

/**
 * True when a ⌘A selection (`all`, with `count` pairs, null until counted)
 * holds pairs beyond `pairs`, the loaded ones.
 */
export function isPartialSelection(pairs, { all = false, count = null } = {}) {
  return all && !(count != null && count <= pairs.length);
}

// How many of `pairs` are still launching, from `launchpadId` when given.
const launchingCount = (pairs, pendingLaunches, launchpadId = null) =>
  launchingIds(pendingLaunches, pairs.map((pair) => pair.ID), launchpadId).length;

/**
 * The menu for `pairs`, the selected pairs the table has loaded, in table
 * order. `context` holds what the app already knows: { launchpads,
 * findings, testCases, palette (the effective highlight
 * palette), pendingLaunches (the launchpad store's, each { ID, LaunchpadID }
 * with its pair's ID), all, count }. `all` marks a ⌘A selection, whose
 * `count` pairs (null until counted) can be more than the loaded ones;
 * actions that need each pair are disabled then, and Delete and Remove from
 * launchpad stay enabled for Marasi to refuse what is still launching.
 */
export function menuFor(
  pairs,
  {
    launchpads = [],
    findings = [],
    testCases = [],
    palette = effectivePalette(),
    pendingLaunches = [],
    all = false,
    count = null,
  } = {},
) {
  if (pairs.length === 0) return [];
  // Some selected pairs aren't loaded: only bulk actions can reach them.
  const partial = isPartialSelection(pairs, { all, count });
  const n = partial ? count : pairs.length;
  const launching = (launchpadId) => (partial ? 0 : launchingCount(pairs, pendingLaunches, launchpadId));
  const many = n == null ? "all" : n.toLocaleString();
  const one = n === 1 ? pairs[0] : null;
  const hosts = unique(pairs.map((pair) => pair.Host));
  const types = unique(pairs.map((pair) => pair.ContentType).filter(Boolean));
  const statuses = unique(pairs.map((pair) => Number(pair.StatusCode) || 0));
  const highlights = unique(pairs.map(highlightOf).filter(Boolean)).sort((a, b) => a - b);
  const websocket = one && upgradePresentation(upgradeFromLedgerRow(one)).canOpen;
  const finding = linkMenu({
    key: "f",
    noun: "finding",
    pairs,
    one,
    n: many,
    partial,
    targets: findings,
    newActionId: "ledger.drawer-open.create-finding",
    newType: "new-finding",
    linkType: "link-finding",
    unlinkType: "unlink-finding",
  });
  const testCase = linkMenu({
    key: "t",
    noun: "test case",
    pairs,
    one,
    n: many,
    partial,
    targets: testCases,
    newActionId: "ledger.drawer-open.create-test-case",
    newType: "new-test-case",
    linkType: "link-test-case",
    unlinkType: "unlink-test-case",
  });

  // No "Open in drawer": a right-click focuses its row, so the drawer
  // already shows it.
  return [
    ...(websocket
      ? [
          {
            id: "websocket",
            label: "Open WebSocket stream",
            icon: "radio",
            actionId: "ledger.drawer-open.websocket.open-stream",
            action: { type: "websocket", id: one.ID },
          },
        ]
      : []),
    ...(websocket ? ["sep"] : []),
    {
      id: "launchpad",
      label: "Send to Launchpad",
      icon: "send",
      sub: [
        newLaunchpadItem(one, many, "ledger.drawer-open.send-to-launchpad"),
        ...(!one
          ? [
              {
                id: "lp-each",
                label: `${many} launchpads, one each`,
                disabled: partial || n > LAUNCHPADS_EACH_MAX,
                hint: `Up to ${LAUNCHPADS_EACH_MAX} at a time`,
                action: { type: "launchpad-each" },
              },
            ]
          : []),
        addToLaunchpadItem(launchpads),
        // The pairs' launchpads aren't loaded with them, so every launchpad
        // is offered; Marasi reports how many were in it.
        ...(launchpads.length
          ? [
              {
                id: "lp-remove",
                label: "Remove from launchpad",
                icon: "unlink",
                sub: launchpads.map((launchpad) => ({
                  id: `lpu-${launchpad.ID}`,
                  label: launchpad.Name || UNTITLED_LAUNCHPAD,
                  ...unlessLaunching(launching(launchpad.ID)),
                  action: { type: "remove-from-launchpad", id: launchpad.ID, name: launchpad.Name },
                })),
              },
            ]
          : []),
      ],
    },
    {
      id: "armory",
      label: one ? "Send to Armory" : `Send ${many} to Armory`,
      icon: "swords",
      actionId: "ledger.drawer-open.send-to-armory",
      disabled: partial,
      hint: NOT_FOR_ALL,
      action: { type: "armory" },
    },
    {
      id: "browser-view",
      label: "Copy browser view URL",
      icon: "globe",
      actionId: "ledger.drawer-open.copy-browser-view-url",
      disabled: !one || Boolean(browserViewRefusal(one)),
      hint: one ? browserViewRefusal(one) : "One request at a time",
      action: { type: "browser-view", id: pairs[0].ID },
    },
    "sep",
    { id: "finding", label: "Finding", icon: "finding", ...finding },
    { id: "testcase", label: "Test case", icon: "testcase", ...testCase },
    ...(one
      ? [
          {
            id: "note",
            label: one.Metadata?.has_note == 1 || one.Note ? "Edit note…" : "Add note…",
            icon: "pen",
            actionId: "ledger.drawer-open.view-note",
            action: { type: "note", id: one.ID },
          },
        ]
      : [
          {
            id: "note",
            label: "Note",
            icon: "pen",
            sub: [
              {
                id: "n-append",
                label: "Append a note…",
                icon: "plus",
                action: { type: "append-note" },
              },
              {
                id: "n-clear",
                label: "Clear notes…",
                icon: "eraser",
                danger: true,
                disabled: !partial && !pairs.some(hasNote),
                hint: "No notes to clear",
                action: { type: "clear-notes" },
              },
            ],
          },
        ]),
    {
      id: "highlight",
      label: "Highlight",
      icon: "highlighter",
      // Under a partly loaded ⌘A selection, the pairs' own highlights are
      // unknown. Otherwise a swatch every pair already has (None, when none
      // has one) would change nothing, so it is disabled.
      swatches: highlightSwatches(pairs, palette).map((swatch) =>
        partial
          ? { ...swatch, checked: undefined, disabled: false }
          : {
              ...swatch,
              disabled: swatch.checked === true,
              hint: swatch.color ? "Already highlighted" : "Nothing to clear",
            },
      ),
    },
    "sep",
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      disabled: partial,
      hint: NOT_FOR_ALL,
      sub: [
        {
          id: "c-url",
          label: one ? "URL" : `${many} URLs`,
          actionId: "ledger.drawer-open.copy-url",
          action: { type: "copy", what: "urls" },
        },
        {
          id: "c-curl",
          label: one ? "As a cURL command" : `${many} requests as cURL commands`,
          action: { type: "copy", what: "curl" },
        },
        {
          id: "c-req",
          label: one ? "Raw request" : `${many} raw requests`,
          actionId: "ledger.drawer-open.copy-raw-request",
          action: { type: "copy", what: "requests" },
        },
        {
          id: "c-res",
          label: one ? "Raw response" : `${many} raw responses`,
          actionId: "ledger.drawer-open.copy-raw-response",
          disabled: !pairs.some(hasResponse),
          hint: "No response yet",
          action: { type: "copy", what: "responses" },
        },
        {
          id: "c-md",
          label: one ? "As a Markdown table" : `${many} requests as a Markdown table`,
          action: { type: "copy", what: "markdown" },
        },
        {
          id: "c-numbers",
          label: one ? "Request number" : `${many} request numbers`,
          action: { type: "copy", what: "numbers" },
        },
      ],
    },
    {
      id: "narrow",
      label: "Narrow query",
      icon: "filter",
      sub: [
        {
          id: "q-host",
          label: hosts.length === 1 ? `host = ${hosts[0]}` : `Only these ${hosts.length} hosts`,
          action: {
            type: "narrow",
            term:
              hosts.length === 1
                ? `host = ${quote(hosts[0])}`
                : `(${hosts.map((host) => `host = ${quote(host)}`).join(" OR ")})`,
          },
        },
        ...hosts.slice(0, 3).map((host) => ({
          id: `q-not-host-${host}`,
          label: `host != ${host}`,
          action: { type: "narrow", term: `host != ${quote(host)}` },
        })),
        ...(one
          ? [
              {
                id: "q-path",
                label: `path = ${pathFolder(one.Path)}`,
                action: { type: "narrow", term: `path = ${quote(pathFolder(one.Path))}` },
              },
            ]
          : []),
        ...(statuses.length === 1 && statuses[0]
          ? [
              {
                id: "q-status",
                label: `status_code = ${statuses[0]}`,
                action: { type: "narrow", term: `status_code = ${statuses[0]}` },
              },
            ]
          : []),
        ...(types.length
          ? [
              {
                id: "q-hide",
                label: "Hide type",
                icon: "eye-off",
                sub: types.slice(0, 3).map((type) => ({
                  id: `x-${type}`,
                  label: `${shortType(type)} (${type})`,
                  action: { type: "hide-type", contentType: type },
                })),
              },
            ]
          : []),
      ],
    },
    {
      id: "select",
      label: "Select",
      icon: "select",
      sub: [
        {
          id: "s-host",
          label: hosts.length === 1 ? `All from ${hosts[0]}` : `All from these ${hosts.length} hosts`,
          action: { type: "select", kind: "host" },
        },
        {
          id: "s-endpoint",
          label: "Same endpoint (method + path)",
          action: { type: "select", kind: "endpoint" },
        },
        {
          id: "s-status",
          label:
            statuses.length === 1 ? `All with status ${statuses[0] || "pending"}` : "Same statuses",
          action: { type: "select", kind: "status" },
        },
        ...highlights.map((number) => ({
          id: `s-highlight-${number}`,
          label:
            highlights.length === 1
              ? "All with this highlight"
              : `All with highlight ${palette[number - 1]?.label ?? number}`,
          action: { type: "select", kind: "highlight", number },
        })),
        { id: "s-invert", label: "Invert selection", action: { type: "select", kind: "invert" } },
      ],
    },
    "sep",
    {
      id: "metadata",
      label: "Metadata…",
      icon: "braces",
      actionId: "ledger.drawer-open.view-metadata",
      disabled: !one,
      hint: "One request at a time",
      action: { type: "metadata", id: pairs[0].ID },
    },
    {
      id: "delete",
      label: one ? "Delete from project…" : `Delete ${many} from project…`,
      icon: "trash",
      danger: true,
      ...unlessLaunching(launching()),
      action: { type: "delete" },
    },
  ];
}

const isAction = (item) => item && item !== "sep" && !item.heading;

// Calls `visit(item, trail)` for every leaf action, with its submenu path
// as `trail`. A leaf under a disabled submenu comes disabled, with the
// submenu's hint.
function eachLeaf(items, visit, trail = [], parent = null) {
  for (const item of items) {
    if (!isAction(item)) continue;
    const children = item.sub ?? item.swatches;
    const blocked = parent ?? (item.disabled ? item : null);
    if (children) eachLeaf(children, visit, [...trail, item.label], blocked);
    else visit(parent ? { ...item, disabled: true, hint: parent.hint } : item, trail);
  }
}

/**
 * Every action whose label or submenu path contains `text`, ignoring case,
 * flattened with its path as `trail`. Blank text returns the menu as is.
 */
export function filterMenu(items, text) {
  const needle = String(text ?? "").trim().toLowerCase();
  if (!needle) return items;
  const out = [];
  eachLeaf(items, (item, trail) => {
    if ([...trail, item.label].join(" ").toLowerCase().includes(needle)) out.push({ ...item, trail });
  });
  return out;
}

/**
 * The menu action a keyboard shortcut runs: the item whose `actionId` is
 * `actionId`, as { action, disabled, hint }, so the shortcut acts exactly
 * as choosing it would, and says why when the menu disables it. null when
 * the menu has no such item.
 */
export function menuAction(items, actionId) {
  let found = null;
  eachLeaf(items, (item) => {
    if (!found && item.actionId === actionId) {
      found = { action: item.action, disabled: Boolean(item.disabled), hint: item.disabled ? item.hint : undefined };
    }
  });
  return found;
}

/** Leaves of `items` that can run: not separators, headings or disabled. */
export function isRunnable(item) {
  return isAction(item) && !item.disabled;
}

/** True for the row of highlight swatches. */
export function isSwatchRow(item) {
  return isAction(item) && Array.isArray(item.swatches);
}
