// Home's Overview: everything the page draws, from plain values, so it can
// be tested without the stores (homeOverview.js binds it to them).
//
// A figure's destination is data, never a closure; `openDestination` in
// homeOverview.js turns one into navigation:
//   { page: "ledger", query }            "" is every pair
//   { page: "logbook", kind: "findings" | "testCases", severities?, status? }
//   { page: "checkpoint" | "launchpad" | "armory" | "compass" }
//   { action: "start-listener" }         Pending's listener item

import { STATUS_CLASSES } from "../../stores/homeApi.js";
import { SEVERITIES } from "../../stores/createLogbookStore.js";

// Each status class's bar colour; its Ledger query is its range of codes,
// as homeApi's toStatusClasses counts it ("4xx" is 400 to 499).
const STATUS_COLOURS = { "2xx": "success", "3xx": "tertiary", "4xx": "warning", "5xx": "error" };
const statusQuery = (key) => `status_code >= ${key[0]}00 status_code < ${Number(key[0]) + 1}00`;

/** A count as Home shows it: grouped digits, none as 0. */
export const count = (n) => (n ?? 0).toLocaleString();
// A count that is null until it has been read, so the page draws a ghost.
const readCount = (read, n) => (read ? count(n) : null);

/**
 * The Overview of `state`:
 * - dashboard: { requests, intercepted, interceptedComplete, notes, launchpads }, null until read
 * - scope: { defaultAllow, includeCount, excludeCount }, null until read
 * - held: requests intercepted in Checkpoint; interceptAll: the Intercept all flag
 * - activeRuns: Armory runs in progress
 * - testCases: [{ done }]; findings: [{ severity, done }]
 * - listenerStopped: the researcher stopped the listener
 * - statusClasses: { "2xx", "3xx", "4xx", "5xx" } pairs per class, null until read
 *
 * Returns `pending`: what needs the researcher, in order (listener, held,
 * intercept-all, urgent), each { id, tone, title, detail, action,
 * destination } and present only when it applies.
 *
 * And `figures`: the eight tiles in order, each
 * { id, label, value, sub?, colour, glyph?, destination } (and `floor` on
 * Intercepted). `value` is the text to show, or null for a ghost; `colour`
 * is the theme colour of its border and icon square, `glyph` the icon's
 * shade when it isn't 200.
 *
 * `statusClasses` maps each class, in order, to { count, colour,
 * destination }: `count` is a number, or null until read; `colour` the
 * theme colour of its bar. `findings` is
 * { total, unfinished, summary, bySeverity, destination }, `summary` the
 * heading's text, `bySeverity` listing
 * { severity, count, destination } for each severity, most severe first.
 */
// The Findings heading's count: "None", "N · all done" or "N · M unfinished".
function findingsSummary(total, unfinished) {
  if (!total) return "None";
  return `${count(total)} · ${unfinished ? `${count(unfinished)} unfinished` : "all done"}`;
}

export function overviewOf(state) {
  const { dashboard: d, scope } = state;
  // The intercepted figure is a floor while Marasi's intercepted_count job
  // still counts pairs from before the upgrade.
  const floor = d?.interceptedComplete === false;
  const casesDone = state.testCases.filter((testCase) => testCase.done).length;
  const findingsTotal = state.findings.length;
  const unfinished = state.findings.filter((finding) => !finding.done).length;
  return {
    pending: pendingOf(state),
    statusClasses: Object.fromEntries(
      STATUS_CLASSES.map((key) => [
        key,
        {
          count: state.statusClasses?.[key] ?? null,
          colour: STATUS_COLOURS[key],
          destination: { page: "ledger", query: statusQuery(key) },
        },
      ]),
    ),
    findings: {
      total: findingsTotal,
      unfinished,
      summary: findingsSummary(findingsTotal, unfinished),
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
        label: "In Checkpoint",
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
        value: state.testCases.length ? `${count(casesDone)} / ${count(state.testCases.length)}` : "None",
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

// Findings urgent while unfinished.
const URGENT = ["Critical", "High"];

// What needs the researcher, in order, each only when it applies.
function pendingOf(state) {
  const pending = [];
  if (state.listenerStopped)
    pending.push({
      id: "listener",
      tone: "error",
      title: "Listener is off",
      detail: "Not capturing",
      action: "Start",
      destination: { action: "start-listener" },
    });
  if (state.held)
    pending.push({
      id: "held",
      tone: "warning",
      title: `${count(state.held)} intercepted in Checkpoint`,
      detail: "Forward or drop them",
      action: "Review",
      destination: { page: "checkpoint" },
    });
  if (state.interceptAll)
    pending.push({
      id: "intercept-all",
      tone: "warning",
      title: "Intercept all is on",
      detail: "Every request is intercepted",
      action: "Open",
      destination: { page: "checkpoint" },
    });
  const urgent = state.findings.filter((f) => URGENT.includes(f.severity) && !f.done).length;
  if (urgent)
    pending.push({
      id: "urgent",
      tone: "error",
      title: `${count(urgent)} Critical/High finding${urgent === 1 ? "" : "s"} unfinished`,
      detail: "Missing report details",
      action: "Finish",
      destination: { page: "logbook", kind: "findings", severities: [...URGENT], status: "progress" },
    });
  return pending;
}
