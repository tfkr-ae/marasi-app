// The app's Ledger store over the service client. The logic is in
// createLedgerStore.js and the API shapes in ledgerApi.js and trafficApi.js;
// this file binds them to the app's client, routes the stream's traffic and
// WebSocket events to the store, and registers it for the project's load
// and resync.
import {
  GetDefaultContentTypeExclusion,
  SetDefaultContentTypeExclusion,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { armoryStore } from "./armoryStore";
import { relinked } from "./relinked.js";
import { createExclusion } from "./contentTypeExclusion.js";
import { createLedgerApi, toUpgradeEvent } from "./ledgerApi.js";
import { toRequestEvent, toResponseEvent } from "./trafficApi.js";
import { createLedgerStore, FLUSH_INTERVAL_MS } from "./createLedgerStore.js";
import { projectData } from "./projectData.js";

export {
  allSelectedLabel,
  isAllSelected,
  selectionSize,
  selectionSpec,
  countLabel,
  drawerKeybindingState,
  focusedPair,
  hiddenByTypeCount,
  indexWarning,
  selectedPairs,
  isLiveNewestFirst,
  isQueryActive,
  newMatchesKind,
  newMatchesLabel,
  rowMenuTarget,
  selectionTarget,
  tableRows,
} from "./createLedgerStore.js";

/**
 * The project's content-type exclusion, which every traffic read leaves
 * out: the Ledger's, the sitemap's and saved-query counts. The app default
 * stays in the app config.
 */
export const contentTypeExclusion = createExclusion(service, {
  getDefaultExclusion: () => GetDefaultContentTypeExclusion(),
  setDefaultExclusion: (types) => SetDefaultContentTypeExclusion(types),
});

const api = createLedgerApi(service, { exclusion: contentTypeExclusion });

export const ledgerStore = createLedgerStore({
  ...api,
  // The finding and test case lists reread their links afterwards.
  linkTraffic: (selection, target) => relinked(api.linkTraffic(selection, target), target.Kind),
  unlinkTraffic: (selection, target) => relinked(api.unlinkTraffic(selection, target), target.Kind),
  // Deleting drops the pairs' links too.
  deleteTraffic: (selection) => relinked(api.deleteTraffic(selection), "all"),
  // Armory templates go through their store, so its list stays current.
  sendToArmory: (requestId) => armoryStore.createTemplateFromRequest(requestId),
});

projectData.register("ledger", {
  signal: loadSignals.traffic,
  clear: ledgerStore.clear,
  load: ledgerStore.populate,
  resync: ledgerStore.resync,
});

service.on("traffic.request", (data) => ledgerStore.onRequest(toRequestEvent(data)));
service.on("traffic.response", (data) => ledgerStore.onResponse(toResponseEvent(data)));
// An upgrade's row follows its connection; a handshake that failed or was
// dropped opens none, so only its row changes.
service.on("websocket.opened", (conn) => ledgerStore.patchWebSocketMetadata(toUpgradeEvent(conn)));
service.on("websocket.closed", (conn) => ledgerStore.patchWebSocketMetadata(toUpgradeEvent(conn)));
service.on("websocket.handshake_ended", (event) => ledgerStore.patchWebSocketMetadata(toUpgradeEvent(event)));
// Changes another client makes (the CLI, another app) show without a resync.
service.on("traffic.changed", ledgerStore.onTrafficChanged);
service.on("metadata.updated", ledgerStore.onMetadataUpdated);
service.on("note.updated", ledgerStore.onNoteUpdated);
service.on("note.deleted", ledgerStore.onNoteDeleted);
service.on("traffic.index_complete", ledgerStore.onIndexComplete);

if (typeof window !== "undefined") {
  setInterval(ledgerStore.flush, FLUSH_INTERVAL_MS);
}
