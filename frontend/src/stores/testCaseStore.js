// The project's test cases for the pages outside the Logbook (Home, the
// Ledger, the Armory, the Launchpad): a view of the Logbook store, which
// reads and writes them over the service.
import { derived } from "svelte/store";
import { logbookStore } from "./logbookStore.js";

const testCases = derived(logbookStore, (state) => state.testCases);

export const testCaseStore = {
  subscribe: testCases.subscribe,
  /** Reads the findings and test cases again. */
  populate: () => logbookStore.populate(),
  /** Links the request to the test case at once. */
  linkRequest: (testCaseId, requestId) => logbookStore.linkNow("testCase", testCaseId, requestId),
  /** Unlinks the request from the test case at once. */
  unlinkRequest: (testCaseId, requestId) => logbookStore.unlinkNow("testCase", testCaseId, requestId),
};
