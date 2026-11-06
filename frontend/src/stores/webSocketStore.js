// The app's WebSocket store over the service client. The logic lives in
// createWebSocketStore.js and the API shapes in webSocketApi.js; this file
// binds them to the app's client and routes the stream's websocket.* and
// WebSocket checkpoint.* events.
import { writable } from "svelte/store";
import { service } from "../lib/service/index.js";
import { toSettled } from "./checkpointApi.js";
import { createWebSocketStore } from "./createWebSocketStore.js";
import { ledgerStore } from "./ledgerStore";
import { projectData } from "./projectData.js";
import { createWebSocketApi, toConnection, toHeldMessage, toMessage, toProgress } from "./webSocketApi.js";

// Draft payload for the Inject tab (set via "Copy to Inject").
export const wsInjectDraft = writable(null);

export const webSocketStore = createWebSocketStore(createWebSocketApi(service));

projectData.register("websocket", {
  clear: webSocketStore.clear,
  load: webSocketStore.populateInterceptFlag,
  resync: webSocketStore.resync,
});

const logged = (what) => (err) => console.error(`${what} failed:`, err);

service.on("websocket.message", (msg) => webSocketStore.upsertMessage(toMessage(msg)));
service.on("websocket.progress", (progress) => webSocketStore.upsertProgress(toProgress(progress)));
service.on("websocket.opened", (event) => {
  const conn = toConnection(event);
  webSocketStore.upsertConnection(conn);
  ledgerStore.patchWebSocketMetadata(conn);
});
service.on("websocket.closed", (event) => {
  const conn = toConnection(event);
  webSocketStore.upsertConnection(conn);
  webSocketStore.clearInterceptions(conn.RequestID);
  ledgerStore.patchWebSocketMetadata(conn);
});
// An upgrade whose handshake failed or was dropped opens no connection, so
// only its Ledger row changes.
service.on("websocket.handshake_ended", ({ request_id, state }) =>
  ledgerStore.patchWebSocketMetadata({ RequestID: request_id, State: state }),
);

// The modal's Checkpoint tab: a held message joins its connection's queue,
// and leaves it wherever it was forwarded or dropped.
service.on("checkpoint.held", (item) => {
  if (item?.type === "websocket") webSocketStore.upsertInterception(toHeldMessage(item));
});
const onLeft = (event) => webSocketStore.onSettled(toSettled(event)).catch(logged("Reading WebSocket Checkpoint"));
service.on("checkpoint.forwarded", onLeft);
service.on("checkpoint.dropped", onLeft);
service.on("checkpoint.updated", ({ websocket_intercept }) => {
  if (typeof websocket_intercept === "boolean") webSocketStore.setInterceptFlag(websocket_intercept);
});
