// Guards for unsaved Launchpad drafts, which live in memory only. The Go
// side asks before quitting or switching the project, so it needs to know
// how many launchpads would lose a dirty draft.
import { unsavedDraftCount } from "./createLaunchpadStore.js";

/**
 * Calls report with the number of unsaved drafts (unsavedDraftCount), once on
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
