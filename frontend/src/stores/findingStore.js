// The project's findings for the pages outside the Logbook (Home, the
// Ledger, the Armory, the Launchpad): a view of the Logbook store, which
// reads and writes them over the service.
import { derived } from "svelte/store";
import { logbookStore } from "./logbookStore.js";

const findings = derived(logbookStore, (state) => state.findings);

export const findingStore = {
  subscribe: findings.subscribe,
  /** Reads the findings and test cases again. */
  populate: () => logbookStore.populate(),
  /** Links the request to the finding at once. */
  linkRequest: (findingId, requestId) => logbookStore.linkNow("finding", findingId, requestId),
  /** Unlinks the request from the finding at once. */
  unlinkRequest: (findingId, requestId) => logbookStore.unlinkNow("finding", findingId, requestId),
};
