// The service events after which a menu's match counts may have changed:
// traffic arriving or changing (here or from another client), highlights
// (traffic metadata), notes, and links to findings, test cases and
// launchpads. A stream reset's resync reaches the counts through
// projectData instead.
export const COUNT_CHANGE_EVENTS = Object.freeze([
  "traffic.request",
  "traffic.response",
  "traffic.changed",
  "metadata.updated",
  "note.updated",
  "note.deleted",
  "finding.linked",
  "finding.unlinked",
  "finding.deleted",
  "launchpad.linked",
  "launchpad.unlinked",
  "launchpad.deleted",
]);

/** Calls `schedule` after each of COUNT_CHANGE_EVENTS from `service`. */
export function followCountChanges(service, schedule) {
  for (const event of COUNT_CHANGE_EVENTS) service.on(event, () => schedule());
}
