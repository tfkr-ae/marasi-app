// The app's Checkpoint store over the service client. The logic lives in
// createCheckpointStore.js and the API shapes in checkpointApi.js; this file
// binds them to the app's client, routes the stream's checkpoint.* events
// and joins the project load and resync.
import { writable } from "svelte/store";
import { service } from "../lib/service/index.js";
import { createItemContext } from "../lib/checkpoint/itemContext.js";
import { loadSignals } from "../lib/openProgress.js";
import { createCheckpointApi, toSettled } from "./checkpointApi.js";
import { createCheckpointStore } from "./createCheckpointStore.js";
import { createCheckpointRules, createRulesApi } from "./checkpointRules.js";
import { interceptFlag } from "./interceptFlag.js";
import { projectData } from "./projectData.js";
import { createWebSocketApi } from "./webSocketApi.js";

export {
  isChecking,
  isDirty,
  parseErrorOf,
  pickedIds,
  textOf,
} from "./createCheckpointStore.js";

export const checkpointStore = createCheckpointStore(createCheckpointApi(service), { interceptFlag });

// The interception rules: in the editor, and as Checkpoint runs them.
export const checkpointCode = writable("");
export const checkpointCodeApplied = writable("");
export const checkpointRules = createCheckpointRules(createRulesApi(service), {
  code: checkpointCode,
  applied: checkpointCodeApplied,
});

const webSocketApi = createWebSocketApi(service);

// The held items' context (a response's request, a WebSocket message's
// connection), read once per item. The layout loads it for every held item,
// so the page and the abandon toast share it.
export const checkpointItemContext = createItemContext({
  getRow: async (id) => {
    const pair = await service.get(`/traffic/${id}`);
    const request = pair?.request ?? {};
    return { Request: { Number: pair.number, Method: request.method, Host: request.host, Path: request.path } };
  },
  getConnection: (requestId) => webSocketApi.GetWebSocketConnection(requestId),
  getConnectionByID: (connectionId) => webSocketApi.GetWebSocketConnectionByID(connectionId),
});

const logged = (what) => (err) => console.error(`${what} failed:`, err);
const readRules = (resync) =>
  (resync ? checkpointRules.resync() : checkpointRules.load()).catch(logged("Reading the Checkpoint rules"));

projectData.register("checkpoint", {
  signal: loadSignals.checkpoint,
  clear: () => {
    checkpointStore.clear();
    checkpointCode.set("");
    checkpointCodeApplied.set("");
    interceptFlag.set(false);
  },
  load: () => Promise.all([checkpointStore.populate(), readRules(false)]),
  resync: () => Promise.all([checkpointStore.resync(), readRules(true)]),
});

// The rail badge shows the count; no toast.
service.on("checkpoint.held", () => checkpointStore.onIntercepted().catch(logged("Reading Checkpoint items")));

// An item left: forwarded or dropped here or by another client, or dropped
// by Marasi because its client left (the layout toasts that) or it stopped.
function onLeft(event) {
  const item = toSettled(event);
  if (item.Reason === "abandoned") checkpointStore.onAbandoned(item);
  else checkpointStore.onSettled(item).catch(logged("Reading Checkpoint items"));
}
service.on("checkpoint.forwarded", onLeft);
service.on("checkpoint.dropped", onLeft);
service.on("checkpoint.updated", checkpointStore.onUpdated);
