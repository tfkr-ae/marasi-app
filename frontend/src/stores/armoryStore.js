// The Armory's store over the service client. The logic is in
// createArmoryStore.js and the API shapes in armoryApi.js; this file binds
// them to the app's client, routes the stream's events to the store, and
// keeps Go's quit and switch guard told about the active runs.
import {
  ArmoryRunsCancelled,
  SetActiveArmoryRunCount,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { on } from "../lib/runtime.js";
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createArmoryApi } from "./armoryApi.js";
import { toRequestEvent, toResponseEvent } from "./trafficApi.js";
import { createArmoryStore } from "./createArmoryStore.js";
import { projectData } from "./projectData.js";

export { drawerShareOf } from "./createArmoryStore.js";

/** How often buffered request and response events reach the run's rows. */
const RUN_TRAFFIC_FLUSH_MS = 200;

export const armoryStore = createArmoryStore(createArmoryApi(service));
setInterval(armoryStore.runTraffic.flush, RUN_TRAFFIC_FLUSH_MS);

projectData.register("armory", {
  signal: loadSignals.armory,
  clear: armoryStore.clear,
  load: armoryStore.populate,
  resync: armoryStore.resync,
});

service.on("armory.template.created", armoryStore.onTemplate);
service.on("armory.template.updated", armoryStore.onTemplate);
service.on("armory.template.deleted", armoryStore.onTemplateDeleted);
service.on("armory.run.created", armoryStore.onRun);
service.on("armory.run.updated", armoryStore.onRun);
service.on("armory.run.deleted", armoryStore.onRunDeleted);
service.on("wordlist.added", armoryStore.onWordlists);
service.on("wordlist.removed", armoryStore.onWordlists);
service.on("traffic.request", (req) => armoryStore.onRequest(toRequestEvent(req)));
service.on("traffic.response", (res) => armoryStore.onResponse(toResponseEvent(res)));

// Go asks before quitting or switching the project while runs are active,
// so it needs their number; once the researcher goes ahead, it asks here
// for them to be cancelled (armory_guard.go).
let reportedRuns;
armoryStore.subscribe((state) => {
  const count = state.activeRunIds.length;
  if (count === reportedRuns) return;
  reportedRuns = count;
  SetActiveArmoryRunCount(count).catch((err) => console.error("Reporting active Armory runs failed:", err));
});
on("armory-cancel-runs", () => {
  armoryStore
    .cancelActiveRuns()
    .then(
      () => "",
      (err) => String(err?.message ?? err),
    )
    .then((problem) => ArmoryRunsCancelled(problem))
    .catch((err) => console.error("Answering the Armory cancel failed:", err));
});
