// The app's Logbook store, bound to the Wails backend. The logic lives in
// createLogbookStore.js, which tests load with a fake API.
import { ListFindings, ListTestCases } from "../lib/wailsjs/go/main/App";
import { createLogbookStore } from "./createLogbookStore.js";

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
} from "./createLogbookStore.js";

export const logbookStore = createLogbookStore({
  listFindings: () => ListFindings(),
  listTestCases: () => ListTestCases(),
});
