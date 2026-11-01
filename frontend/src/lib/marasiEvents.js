// The window's Marasi events: which store's on* method each event goes to,
// and the stores that reload when the event stream reopens. Each ticket
// that ports a store adds its events here.
import { createEventStream } from "./eventStream.js";
import { followConnection, reloadStores } from "./followConnection.js";
import { handshakeEndedEvent, requestEvent, responseEvent } from "./bindings/traffic.js";
import { armoryRun, armoryTemplate, wordlistInfos } from "./bindings/armory.js";
import { webSocketConnection, webSocketMessage, webSocketProgress } from "./bindings/websocket.js";
import { windowConnection } from "../stores/windowConnectionStore.js";
import { logStore } from "../stores/logStore.js";
import { ledgerStore } from "../stores/ledgerStore";
import { sitemapStore } from "../stores/sitemapStore";
import { recentTraffic } from "../stores/recentTrafficStore";
import { jobsStore } from "../stores/jobsStore";
import { checkpointStore } from "../stores/checkpointStore";
import { connectionStore } from "../stores/connectionStore";
import { launchpadStore } from "../stores/launchpadStore";
import { armoryStore } from "../stores/armoryStore";
import { logbookStore } from "../stores/logbookStore";
import { findingStore } from "../stores/findingStore";
import { testCaseStore } from "../stores/testCaseStore";
import { upstreamProxyStore } from "../stores/upstreamProxyStore";
import { chromeStore } from "../stores/chromeStore.js";
import { waypointStore } from "../stores/waypointStore.js";
import { listenerStore } from "../stores/listenerStore.js";
import { dashboardStore } from "../stores/dashboardStore.js";
import { instanceUpdate } from "../stores/instanceUpdateStore.js";
import { projectSwitch } from "../stores/projectSwitchStore.js";
import { extensionsStore } from "../stores/extensionsStore.js";
import { scopeStore } from "../stores/scopeStore.js";

const checkpointResolved = (event) => {
  Promise.resolve(checkpointStore.onResolved(event)).catch((err) =>
    console.error("Reading Checkpoint items failed:", err),
  );
  connectionStore.onResolved(event).catch((err) => console.error("Reading held WebSocket messages failed:", err));
};

// A connection that opened or closed, for the WebSocket modal and its
// upgrade's Ledger row.
const webSocketChanged = (event) => {
  const connection = webSocketConnection(event);
  connectionStore.upsertConnection(connection);
  ledgerStore.patchWebSocketMetadata(connection);
  return connection;
};

// Each Marasi event's handler, by event name.
const handlers = {
  "log.added": (log) => logStore.onLogAdded(log),
  // Captured traffic, in v1's request and response shapes.
  "traffic.request": (event) => {
    const request = requestEvent(event);
    ledgerStore.onRequest(request);
    sitemapStore.onRequest(request);
    recentTraffic.onRequest(request);
    armoryStore.onRequest(request);
  },
  "traffic.response": (event) => {
    const response = responseEvent(event);
    ledgerStore.onResponse(response);
    sitemapStore.onResponse(response);
    recentTraffic.onResponse(response);
    armoryStore.onResponse(response);
  },
  // An upgrade whose handshake failed or was dropped opens no connection,
  // so only its Ledger row changes.
  "websocket.handshake_ended": (event) => ledgerStore.patchWebSocketMetadata(handshakeEndedEvent(event)),
  // The Armory's templates and runs, changed by any client, and each run's
  // progress; the deleted events carry the id alone.
  "armory.template.created": (template) => armoryStore.onTemplate(armoryTemplate(template)),
  "armory.template.updated": (template) => armoryStore.onTemplate(armoryTemplate(template)),
  "armory.template.deleted": ({ id }) => armoryStore.onTemplateDeleted({ ID: id }),
  "armory.run.created": (run) => armoryStore.onRun(armoryRun(run)),
  "armory.run.updated": (run) => armoryStore.onRun(armoryRun(run)),
  "armory.run.deleted": ({ id }) => armoryStore.onRunDeleted({ ID: id }),
  // The instance machine's wordlists, all of them.
  "wordlist.added": (list) => armoryStore.onWordlists(wordlistInfos(list)),
  "wordlist.removed": (list) => armoryStore.onWordlists(wordlistInfos(list)),
  // A rebuild or delete moved the sitemap: read its open levels again.
  "sitemap.changed": () => sitemapStore.reload(),
  "listener.started": (status) => listenerStore.onListener(status),
  "listener.updated": (status) => listenerStore.onListener(status),
  "listener.stopped": (status) => listenerStore.onListener(status),
  "job.progress": (job) => jobsStore.onJobProgress(job),
  "job.complete": (job) => {
    jobsStore.onJobComplete(job);
    dashboardStore.onJobComplete(job).catch((err) => console.error("Counting the dashboard failed:", err));
  },
  // Checkpoint, HTTP and WebSocket items alike, by any client. An item
  // whose client left, or whose WebSocket connection closed, arrives as
  // checkpoint.dropped, reason abandoned. The WebSocket modal queues held
  // messages by connection.
  "checkpoint.held": (item) => {
    checkpointStore.onHeld().catch((err) => console.error("Reading Checkpoint items failed:", err));
    connectionStore.onHeld(item);
  },
  "checkpoint.forwarded": (event) => checkpointResolved(event),
  "checkpoint.dropped": (event) => checkpointResolved(event),
  "checkpoint.updated": (flags) => {
    checkpointStore.onUpdated(flags);
    connectionStore.onUpdated(flags);
  },
  // WebSocket connections and their messages, in v1's shapes.
  "websocket.opened": (event) => webSocketChanged(event),
  "websocket.closed": (event) => connectionStore.clearInterceptions(webSocketChanged(event).RequestID),
  "websocket.message": (event) => connectionStore.upsertMessage(webSocketMessage(event)),
  "websocket.progress": (event) => connectionStore.upsertProgress(webSocketProgress(event)),
  "update.available": (update) => instanceUpdate.onAvailable(update),
  "update.progress": (progress) => instanceUpdate.onProgress(progress),
  "update.installed": (installed) => instanceUpdate.onInstalled(installed),
  "update.failed": (failure) => instanceUpdate.onFailed(failure),
  "service.restarting": (restart) => instanceUpdate.onRestarting(restart),
  "service.restart_failed": (failure) => instanceUpdate.onRestartFailed(failure),
  // The machine's Chrome and upstream proxies, and the project's selection
  // and waypoints; each list event carries the whole list.
  "chrome.path.added": (event) => chromeStore.onPaths(event),
  "chrome.path.removed": (event) => chromeStore.onPaths(event),
  "chrome.profile.added": (event) => chromeStore.onProfiles(event),
  "chrome.profile.removed": (event) => chromeStore.onProfiles(event),
  "upstream_proxy.added": (event) => upstreamProxyStore.onList(event),
  "upstream_proxy.updated": (event) => upstreamProxyStore.onList(event),
  "upstream_proxy.removed": (event) => upstreamProxyStore.onList(event),
  "upstream_proxy.selected": (event) => upstreamProxyStore.onSelected(event),
  "waypoint.added": (event) => waypointStore.onWaypoints(event),
  "waypoint.updated": (event) => waypointStore.onWaypoints(event),
  "waypoint.removed": (event) => waypointStore.onWaypoints(event),
  // A switch of the instance's project, by any client; the window reloads
  // every store's project on project.opened.
  "project.opening": (event) => projectSwitch.onOpening(event),
  "project.upgrading": (event) => projectSwitch.onUpgrading(event),
  "project.waiting": (event) => projectSwitch.onWaiting(event),
  "project.opened": (event) =>
    projectSwitch.onOpened(event).catch((err) => console.error("Loading the opened project failed:", err)),
  "project.opening_failed": (event) => projectSwitch.onOpeningFailed(event),
  "extension.enabled": (extension) => extensionsStore.onExtension(extension),
  "extension.updated": (extension) => {
    extensionsStore.onExtension(extension);
    // Compass's code holds the scope rules.
    scopeStore.onExtension(extension).catch((err) => console.error("Reading the scope rules failed:", err));
  },
  "extension.settings.updated": (event) =>
    extensionsStore.onSettingsUpdated(event).catch((err) => console.error("Reading extension settings failed:", err)),
  "extension.gui.rendered": (event) => extensionsStore.onRendered(event),
  "extension.gui.updated": (event) => extensionsStore.onUpdated(event),
  "extension.log": (line) => extensionsStore.onLog(line),
};

// Every store that shows the instance's data. Launchpad drafts live in the
// window, so the Launchpad's reload keeps them.
const stores = [
  logStore,
  listenerStore,
  dashboardStore,
  ledgerStore,
  sitemapStore,
  recentTraffic,
  jobsStore,
  checkpointStore,
  connectionStore,
  launchpadStore,
  armoryStore,
  logbookStore,
  findingStore,
  testCaseStore,
  upstreamProxyStore,
  chromeStore,
  waypointStore,
  instanceUpdate,
  extensionsStore,
  scopeStore,
];

/** Reloads every store, as after the event stream reopens. */
export const reloadAll = () => reloadStores(stores);

/**
 * Follows the window's connected instance's event stream, and reloads every
 * store each time it reopens. Returns a stop.
 */
export function followWindowConnection() {
  return followConnection(windowConnection, (url) =>
    createEventStream({ url, handlers, onReconnect: reloadAll }),
  );
}
