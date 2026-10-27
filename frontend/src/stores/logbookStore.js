// The app's Logbook store, bound to the Wails backend. The logic lives in
// createLogbookStore.js, which tests load with a fake API.
import { ListFindings, ListTestCases } from "../lib/wailsjs/go/main/App";
import { createLogbookStore } from "./createLogbookStore.js";
import { findingStore } from "./findingStore";
import { testCaseStore } from "./testCaseStore";

export {
  ITEMS,
  SEVERITIES,
  anyStatusOf,
  categoryOf,
  completenessOf,
  filteredOf,
  groupsOf,
  nextOf,
  openRecordOf,
  severityCountsOf,
  testCaseCountsOf,
} from "./createLogbookStore.js";

export const logbookStore = createLogbookStore({
  listFindings: () => ListFindings(),
  listTestCases: () => ListTestCases(),
});

// Today's finding and test case modals, the Ledger and the request view
// still write through findingStore and testCaseStore; the Logbook follows
// them until its own edit session replaces them.
findingStore.subscribe((findings) => logbookStore.setRecords("finding", findings));
testCaseStore.subscribe((testCases) => logbookStore.setRecords("testCase", testCases));
