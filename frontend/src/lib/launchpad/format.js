// Display helpers for the Launchpad page.

/** What a launchpad without a name is called, here and in the Ledger. */
export const UNTITLED_LAUNCHPAD = "Untitled launchpad";

/** Marasi's primary variant: ghost in light mode, filled in dark. */
export const primaryVariant = (lightMode) =>
  lightMode ? "variant-ghost-primary ring-0 shadow-none" : "variant-filled-primary";

/** Marasi's neutral variant, as Home's Open Project: ghost in light mode, filled in dark. */
export const neutralVariant = (lightMode) =>
  lightMode ? "variant-ghost border-0 ring-0" : "variant-filled";

/** Text colour class for an HTTP status code; pending (0, or -1 as stored) is dimmed. */
export function statusClass(code) {
  if (!(code > 0)) return "opacity-50";
  if (code < 300) return "text-success-500";
  // warning-500 is unreadable on a light surface.
  if (code < 400) return "text-warning-800 dark:text-warning-500";
  return "text-error-500";
}

/** Text colour class by HTTP method; methods not listed take none. */
export const METHOD_CLASS = {
  POST: "text-tertiary-700 dark:text-tertiary-500",
  // warning-500 is unreadable on a light surface.
  PUT: "text-warning-800 dark:text-warning-500",
  PATCH: "text-warning-800 dark:text-warning-500",
  DELETE: "text-error-500",
};

/**
 * How a launch that did not complete ended, for the tree and the response
 * pane: "Cancelled", "Failed: upstream_error", or null when it is pending,
 * completed, or not a launch.
 */
export function launchEndText(launch) {
  if (launch?.Status === "cancelled") return "Cancelled";
  if (launch?.Status === "failed") return launch.Reason ? `Failed: ${launch.Reason}` : "Failed";
  return null;
}

export function shortTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

/**
 * The entry row's length column: the response length once the entry has a
 * response, else blank. Marasi reports an unanswered pair's length as "0"
 * (status code 0 while pending, -1 when its launch ended without one).
 */
export function entryLengthText(entry) {
  return entry?.StatusCode > 0 ? String(entry.Length ?? "") : "";
}
