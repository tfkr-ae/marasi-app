// How a single Forward or Drop reports, on the Checkpoint page and in the
// Messages modal's Checkpoint tab: a toast for the outcome the store
// returned, or for why the call failed. Pure, so it loads under node --test.
import { isSuperseded } from "../service/errors.js";

// [message, background] by the store's forward or drop result.
const OUTCOMES = {
  // The edit didn't parse; the workspace shows why.
  unparsed: ["Edit doesn't parse", "variant-filled-warning"],
  // Marasi refused the edit or the drop; the workspace shows its reason.
  refused: ["Refused by Marasi", "variant-filled-warning"],
  // The item had already left; it is removed.
  gone: ["Already gone", "variant-filled-surface"],
};

/**
 * Reports a failed Checkpoint call (`what`, such as "Forward") through
 * `toast(message, background)`. A connection switch stopped it
 * (superseded): nothing to report.
 */
export function reportFailure(what, err, toast) {
  if (isSuperseded(err)) return;
  console.error(`${what} failed:`, err);
  toast(`${what} failed`, "variant-filled-error");
}

/**
 * Runs `run` (the store's forward or drop of one item) and reports its
 * outcome through `toast(message, background)`. Resolves to the result, or
 * undefined when it failed.
 */
export async function settleItem(what, run, toast) {
  try {
    const result = await run();
    const outcome = OUTCOMES[result];
    if (outcome) toast(...outcome);
    return result;
  } catch (err) {
    reportFailure(what, err, toast);
    return undefined;
  }
}
