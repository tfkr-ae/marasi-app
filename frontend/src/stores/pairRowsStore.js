// The rows of the pairs on cards (createPairRowsStore.js) over the service
// client, with the traffic events that change them.
import { service } from "../lib/service/index.js";
import { createToolTrafficApi } from "./toolTrafficApi.js";
import { STREAMED_PAIR_EVENTS, toStreamedEvent } from "./trafficApi.js";
import { createPairRowsStore } from "./createPairRowsStore.js";
import { projectData } from "./projectData.js";

export const pairRows = createPairRowsStore(createToolTrafficApi(service));

projectData.register("pairRows", { clear: pairRows.clear, load: pairRows.load });

service.on("traffic.changed", pairRows.onTrafficChanged);
for (const name of STREAMED_PAIR_EVENTS) {
  service.on(name, (data) => pairRows.onStreamedPair(toStreamedEvent(data)));
}
for (const name of ["traffic.response", "metadata.updated", "note.updated", "note.deleted"]) {
  service.on(name, pairRows.onPairEvent);
}
