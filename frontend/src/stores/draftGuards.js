// Guards for unsaved Launchpad drafts, which live in the window's memory
// only. The main process asks before quitting, so it needs to know how many
// dirty drafts would be lost, kept ones included.
import { unsavedDraftCount } from "./createLaunchpadStore.js";

/**
 * Calls report with the number of dirty drafts, once on
 * subscribe and again whenever it changes. Returns the unsubscribe function.
 */
export function reportUnsavedDraftCount(store, report) {
  let last;
  return store.subscribe((state) => {
    const count = unsavedDraftCount(state);
    if (count === last) return;
    last = count;
    report(count);
  });
}
