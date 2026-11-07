// The app's Logbook store over the service client. The logic lives in
// createLogbookStore.js and the API shapes in logbookApi.js, which tests
// load with a fake client. It is the one list of findings and test cases;
// findingStore and testCaseStore are views of it for the other pages.
import { SaveFileAs, SetUnsavedLogbookEdits } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createLogbookApi } from "./logbookApi.js";
import { createLogbookStore, hasUnsavedEdits } from "./createLogbookStore.js";
import { reportUnsavedLogbookEdits } from "./draftGuards.js";
import { logbookEvents } from "./logbookEvents.js";
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

for (const [name, handler] of Object.entries(logbookEvents(logbookStore))) service.on(name, handler);

// Keeps the Go side told whether the Logbook has unsaved edits, so quitting,
// switching the project or following another client's switch can ask first.
// Returns the unsubscribe function.
export function reportLogbookEdits() {
  return reportUnsavedLogbookEdits(
    logbookStore,
    (unsaved) =>
      SetUnsavedLogbookEdits(unsaved).catch((err) => console.error("reporting unsaved Logbook edits:", err)),
    hasUnsavedEdits,
  );
}

projectData.register("logbook", {
  signal: loadSignals.findings,
  clear: logbookStore.clear,
  load: logbookStore.populate,
  resync: logbookStore.resync,
});
