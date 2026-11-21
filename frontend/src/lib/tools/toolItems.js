// The project's items as the tool pages take them in and put work back,
// bound to the service client: live rows for pair cards, the Insert panel's
// traffic list, record titles, and Artifacts through the Logbook's API.
// Findings and test cases come from the Logbook store, which follows the
// service's events already.
import { get } from "svelte/store";
import { service } from "../service/index.js";
import { readTraffic } from "../../stores/trafficApi.js";
import { createLogbookApi } from "../../stores/logbookApi.js";
import { logbookStore } from "../../stores/logbookStore.js";
import { createPairRows } from "./pairRows.js";
import { createTrafficList, TRAFFIC_LIST_LIMIT } from "./trafficList.js";
import { createAttachments } from "./attachments.js";

const page = (query, limit) =>
  readTraffic(service, { Query: query, OrderBy: "", Direction: "backward", Cursor: "", AsOf: "", Limit: limit }, null);

export const pairRows = createPairRows({
  read: async (query) => {
    const result = await page(query, 500);
    if (result.QueryError) throw new Error(result.QueryError.Message);
    return result.Items;
  },
  on: (name, handler) => service.on(name, handler),
});

export const trafficList = createTrafficList({
  read: (query) => page(query, TRAFFIC_LIST_LIMIT),
  on: (name, handler) => service.on(name, handler),
});

const logbookApi = createLogbookApi(service, { saveFile: async () => "" });

export const attachments = createAttachments({
  upload: (kind, id, file) =>
    kind === "finding" ? logbookApi.saveArtifactToFinding(id, file) : logbookApi.saveArtifactToTestCase(id, file),
  remove: (id) => logbookApi.deleteArtifact(id),
});

/** A finding's or test case's title, or null once it is gone. */
export function recordTitle(kind, id) {
  const state = get(logbookStore);
  const list = kind === "finding" ? state.findings : state.testCases;
  const record = list.find((r) => String(r.ID) === String(id));
  return record ? record.Title || `Untitled ${kind === "finding" ? "finding" : "test case"}` : null;
}
