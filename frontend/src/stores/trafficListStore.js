// The Insert panel's traffic list (createTrafficListStore.js) over the
// service client, with the traffic events that change it.
import { service } from "../lib/service/index.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { createTrafficListStore } from "./createTrafficListStore.js";
import { projectData } from "./projectData.js";
import { loadSignals } from "../lib/openProgress.js";

export const trafficList = createTrafficListStore(createToolTrafficApi(service));

projectData.register("trafficList", { signal: loadSignals.traffic, clear: trafficList.clear, load: trafficList.load });

for (const name of ["traffic.request", "traffic.response", "traffic.changed"]) {
  service.on(name, trafficList.onTraffic);
}
