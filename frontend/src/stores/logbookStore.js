// The app's Logbook store, bound to the Wails backend. The logic lives in
// createLogbookStore.js, which tests load with a fake API.
import {
  CreateDraftFinding,
  CreateDraftTestCase,
  DeleteArtifact,
  LinkRequestToFinding,
  LinkRequestToTestCase,
  ListFindings,
  ListTestCases,
  SaveArtifactToFinding,
  SaveArtifactToTestCase,
  SaveFinding,
  SaveTestCase,
  UnlinkRequestFromFinding,
  UnlinkRequestFromTestCase,
} from "../lib/wailsjs/go/main/App";
import { createLogbookStore } from "./createLogbookStore.js";

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
  nextOf,
  openRecordOf,
} from "./createLogbookStore.js";

// A File's bytes as the bindings take a Go []byte.
const bytesOf = async (file) => Array.from(new Uint8Array(await file.arrayBuffer()));
const upload = (save) => async (id, file) => save(id, file.name, file.type || "application/octet-stream", file.size, await bytesOf(file));

export const logbookStore = createLogbookStore({
  listFindings: () => ListFindings(),
  listTestCases: () => ListTestCases(),
  createDraftFinding: (requestIds, testCaseId) => CreateDraftFinding(requestIds, testCaseId),
  createDraftTestCase: (requestIds) => CreateDraftTestCase(requestIds),
  saveFinding: (finding) => SaveFinding(finding),
  saveTestCase: (testCase) => SaveTestCase(testCase),
  linkRequestToFinding: (id, request) => LinkRequestToFinding(id, request),
  unlinkRequestFromFinding: (id, request) => UnlinkRequestFromFinding(id, request),
  linkRequestToTestCase: (id, request) => LinkRequestToTestCase(id, request),
  unlinkRequestFromTestCase: (id, request) => UnlinkRequestFromTestCase(id, request),
  saveArtifactToFinding: upload(SaveArtifactToFinding),
  saveArtifactToTestCase: upload(SaveArtifactToTestCase),
  deleteArtifact: (id) => DeleteArtifact(id),
});
