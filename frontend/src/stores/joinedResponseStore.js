// The app's shared joined SSE response loader and byte-bounded cache over
// the service client. Used by the Ledger drawer, Launchpad workspace, Armory
// drawer, and Logbook linked traffic previews.
import { service } from "../lib/service/index.js";
import { createJoinedResponseStore } from "./createJoinedResponseStore.js";
import { projectData } from "./projectData.js";
import { NO_BODIES, pairQuery, STREAMED_PAIR_EVENTS } from "./trafficApi.js";

const api = {
  bind: () => service.bind(),
  readJoinedResponse: (id, link = service) =>
    link.request("GET", `/traffic/${id}/response/joined`, { as: "bytes" }),
  readPairStreamed: async (id, link = service) => {
    const pair = await link.get(`/traffic/${id}`, pairQuery(NO_BODIES));
    return pair?.streamed ?? pair?.metadata?.streamed ?? null;
  },
};

export const joinedResponseStore = createJoinedResponseStore(api);

projectData.register("joined-responses", {
  clear: joinedResponseStore.clear,
  load: () => {},
  resync: joinedResponseStore.resync,
});

for (const name of STREAMED_PAIR_EVENTS) {
  service.on(name, (data) => joinedResponseStore.onStreamedPair(data));
}
service.on("traffic.response", (data) => joinedResponseStore.onTrafficResponse(data));
