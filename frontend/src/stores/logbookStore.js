// The app's Logbook store over the service client. The logic lives in
// createLogbookStore.js and the API shapes in logbookApi.js, which tests
// load with a fake client. It is the one list of findings and test cases;
// findingStore and testCaseStore are views of it for the other pages.
import { SaveFileAs } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createLogbookApi } from "./logbookApi.js";
import { createLogbookStore } from "./createLogbookStore.js";
import { projectData } from "./projectData.js";

export {
  ITEMS,
  SEVERITIES,
  anyStatusOf,
  categoryOf,
  changesOf,
  completenessOf,
  filteredOf,
  groupsOf,
  isDirty,
  linkedOf,
  nextOf,
  openRecordOf,
  reportOf,
  severityCountsOf,
  testCaseCountsOf,
} from "./createLogbookStore.js";

export const logbookStore = createLogbookStore(createLogbookApi(service, { saveFile: SaveFileAs }));

projectData.register("logbook", {
  signal: loadSignals.findings,
  clear: logbookStore.clear,
  load: logbookStore.populate,
  resync: logbookStore.resync,
});
