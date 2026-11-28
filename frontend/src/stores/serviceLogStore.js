// The Service log's store over the service client. The logic is in
// createServiceLogStore.js and the API shapes in serviceLogApi.js; this file
// binds them to the app's client and routes log.added to the store.
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createServiceLogApi } from "./serviceLogApi.js";
import { createServiceLogStore } from "./createServiceLogStore.js";
import { projectData } from "./projectData.js";

export const serviceLogStore = createServiceLogStore(createServiceLogApi(service));

projectData.register("serviceLog", {
  signal: loadSignals.logs,
  clear: serviceLogStore.clear,
  load: serviceLogStore.populate,
  resync: serviceLogStore.resync,
});

service.on("log.added", serviceLogStore.onLog);
