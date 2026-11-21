// The project's findings and test cases as the tool pages put work back on
// them: record titles from the Logbook store, which follows the service's
// events already, and Artifacts through the Logbook's API. Pair rows and the
// Insert panel's traffic list are stores of their own
// (stores/pairRowsStore.js, stores/trafficListStore.js).
import { get } from "svelte/store";
import { service } from "../service/index.js";
import { createLogbookApi } from "../../stores/logbookApi.js";
import { logbookStore } from "../../stores/logbookStore.js";
import { createDocumentArtifacts } from "./documentArtifacts.js";
import { recordName, recordsOf } from "./recordKinds.js";

const logbookApi = createLogbookApi(service, { saveFile: async () => "" });

export const documentArtifacts = createDocumentArtifacts({
  bind: () => logbookApi.bind(),
  upload: (kind, id, file) =>
    kind === "finding" ? logbookApi.saveArtifactToFinding(id, file) : logbookApi.saveArtifactToTestCase(id, file),
  remove: (id) => logbookApi.deleteArtifact(id),
});

/** A finding's or test case's title, or null once it is gone. */
export function recordTitle(kind, id) {
  const record = recordsOf(get(logbookStore), kind).find((r) => String(r.ID) === String(id));
  return record ? recordName(kind, record) : null;
}
