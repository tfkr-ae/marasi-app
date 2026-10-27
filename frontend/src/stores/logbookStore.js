// The app's Logbook store, bound to the Wails backend. The logic lives in
// createLogbookStore.js, which tests load with a fake API.
import {
  CreateDraftFinding,
  CreateDraftTestCase,
  DeleteArtifact,
  DownloadArtifact,
  GetArtifact,
  GetRawDetails,
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
import { findingStore } from "./findingStore";
import { testCaseStore } from "./testCaseStore";

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
  severityCountsOf,
  testCaseCountsOf,
} from "./createLogbookStore.js";

// A File's bytes as the bindings take a Go []byte.
const bytesOf = async (file) => Array.from(new Uint8Array(await file.arrayBuffer()));
const upload = (save) => async (id, file) => save(id, file.name, file.type || "application/octet-stream", file.size, await bytesOf(file));

export const logbookStore = createLogbookStore({
  listFindings: () => ListFindings(),
  listTestCases: () => ListTestCases(),
  getPair: (id) => GetRawDetails(id),
  getArtifact: (id) => GetArtifact(id),
  downloadArtifact: (id) => DownloadArtifact(id),
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

// The Ledger and the request view still write through findingStore and
// testCaseStore; the Logbook follows them until they open the edit
// session instead.
findingStore.subscribe((findings) => logbookStore.setRecords("finding", findings));
testCaseStore.subscribe((testCases) => logbookStore.setRecords("testCase", testCases));
