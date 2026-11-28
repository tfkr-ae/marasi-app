// Home's Overview: everything the page draws, from plain values, so it can
// be tested without the stores (homeOverview.js binds it to them).
//
// A figure's destination is data, never a closure; `openDestination` in
// destinations.js turns one into navigation:
//   { page: "ledger", query }            "" is every pair
//   { page: "logbook", kind: "findings" | "testCases", severities?, status? }
//   { page: "checkpoint" | "launchpad" | "armory" | "compass" }

import { STATUS_CLASSES } from "../../stores/homeApi.js";
import { SEVERITIES } from "../../stores/createLogbookStore.js";

// The Ledger query for each status class's range of codes.
const STATUS_QUERIES = {
  "2xx": "status_code >= 200 status_code < 300",
  "3xx": "status_code >= 300 status_code < 400",
  "4xx": "status_code >= 400 status_code < 500",
  "5xx": "status_code >= 500",
};

const count = (n) => (n ?? 0).toLocaleString();
// A count that is null until it has been read, so the page draws a ghost.
const readCount = (read, n) => (read ? count(n) : null);

/**
 * The Overview of `state`:
 * - dashboard: { requests, intercepted, interceptedComplete, notes, launchpads }, null until read
 * - scope: { defaultAllow, includeCount, excludeCount }, null until read
 * - held: requests held in Checkpoint; interceptAll: the Intercept all flag
 * - activeRuns: Armory runs in progress
 * - testCases: [{ done }]
 * - findings: [{ severity, done }]
 * - statusClasses: { "2xx", "3xx", "4xx", "5xx" } pairs per class, null until read
 *
 * Returns `figures`: the eight tiles in order, each
 * { id, label, value, sub?, colour, glyph?, destination } (and `floor` on
 * Intercepted). `value` is the text to show, or null for a ghost; `colour`
 * is the theme colour of its border and icon square, `glyph` the icon's
 * shade when it isn't 200.
 *
 * `statusClasses` maps each class, in order, to { count, destination }:
 * `count` is a number, or null until read. `findings` is
 * { total, unfinished, bySeverity, destination }, `bySeverity` listing
 * { severity, count, destination } for each severity, most severe first.
 */
export function overviewOf(state) {
  const { dashboard: d, scope } = state;
  // The intercepted figure is a floor while Marasi's intercepted_count job
  // still counts pairs from before the upgrade.
  const floor = d?.interceptedComplete === false;
  const casesDone = state.testCases.filter((testCase) => testCase.done).length;
  return {
    statusClasses: Object.fromEntries(
      STATUS_CLASSES.map((key) => [
        key,
        { count: state.statusClasses?.[key] ?? null, destination: { page: "ledger", query: STATUS_QUERIES[key] } },
      ]),
    ),
    findings: {
      total: state.findings.length,
      unfinished: state.findings.filter((finding) => !finding.done).length,
      bySeverity: SEVERITIES.map((severity) => ({
        severity,
        count: state.findings.filter((finding) => finding.severity === severity).length,
        destination: { page: "logbook", kind: "findings", severities: [severity] },
      })),
      destination: { page: "logbook", kind: "findings" },
    },
    figures: [
      {
        id: "pairs",
        label: "Pairs",
        value: readCount(d, d?.requests),
        colour: "primary",
        destination: { page: "ledger", query: "" },
      },
      {
        id: "intercepted",
        label: "Intercepted",
        value: readCount(d, d?.intercepted),
        floor,
        ...(floor && { sub: "counting…" }),
        colour: "warning",
        destination: { page: "ledger", query: "metadata.intercepted = true" },
      },
      {
        id: "notes",
        label: "With a note",
        value: readCount(d, d?.notes),
        colour: "tertiary",
        destination: { page: "ledger", query: "note:*" },
      },
      {
        id: "launchpads",
        label: "Launchpads",
        value: readCount(d, d?.launchpads),
        colour: "surface",
        glyph: 300,
        destination: { page: "launchpad" },
      },
      {
        id: "held",
        label: "Held",
        value: count(state.held),
        sub: `Intercept all ${state.interceptAll ? "on" : "off"}`,
        colour: "warning",
        destination: { page: "checkpoint" },
      },
      {
        id: "armory",
        label: "Armory runs",
        value: count(state.activeRuns),
        sub: "in progress",
        colour: "secondary",
        glyph: 900,
        destination: { page: "armory" },
      },
      {
        id: "test-cases",
        label: "Test cases done",
        value: `${count(casesDone)} / ${count(state.testCases.length)}`,
        colour: "tertiary",
        destination: { page: "logbook", kind: "testCases" },
      },
      {
        id: "scope",
        label: "Scope",
        value: scope ? (scope.defaultAllow ? "Allow" : "Deny") : null,
        sub: `${count(scope?.includeCount)} include · ${count(scope?.excludeCount)} exclude`,
        colour: "success",
        destination: { page: "compass" },
      },
    ],
  };
}
