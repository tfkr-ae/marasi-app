// Guards for unsaved Launchpad drafts and Logbook edits, which live in
// memory only. The Go side asks before quitting or switching the project, so
// it needs to know how many launchpads would lose a dirty draft and whether
// the Logbook has unsaved edits.
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

/**
 * Calls report with whether the Logbook has unsaved edits (`unsaved(state)`,
 * hasUnsavedEdits), once on subscribe and again whenever that changes.
 * Returns the unsubscribe function.
 */
export function reportUnsavedLogbookEdits(store, report, unsaved) {
  let last;
  return store.subscribe((state) => {
    const value = Boolean(unsaved(state));
    if (value === last) return;
    last = value;
    report(value);
  });
}
