// The window's Marasi events: which store's on* method each event goes to,
// and the stores that reload when the event stream reopens. Each ticket
// that ports a store adds its events here.
import { createEventStream } from "./eventStream.js";
import { followConnection, reloadStores } from "./followConnection.js";
import { handshakeEndedEvent, requestEvent, responseEvent } from "./bindings/traffic.js";
import { launchOf, launchpadOf } from "./bindings/launchpads.js";
import { armoryRun, armoryTemplate, wordlistInfos } from "./bindings/armory.js";
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

const checkpointResolved = (event) =>
  Promise.resolve(checkpointStore.onResolved(event)).catch((err) =>
    console.error("Reading Checkpoint items failed:", err),
  );

// Logs a failed reread after a launchpad event.
const followLaunchpads = (reading) =>
  reading.catch((err) => console.error("Reading launchpads failed:", err));

// Each Marasi event's handler, by event name.
const handlers = {
  "log.added": (log) => logStore.onLogAdded(log),
  // Captured traffic, in v1's request and response shapes.
  "traffic.request": (event) => {
    const request = requestEvent(event);
    ledgerStore.onRequest(request);
    sitemapStore.onRequest(request);
    recentTraffic.onRequest(request);
    followLaunchpads(launchpadStore.onRequest(request));
    armoryStore.onRequest(request);
  },
  "traffic.response": (event) => {
    const response = responseEvent(event);
    ledgerStore.onResponse(response);
    sitemapStore.onResponse(response);
    recentTraffic.onResponse(response);
    armoryStore.onResponse(response);
    followLaunchpads(launchpadStore.onResponse(response));
  },
  // A bulk change names no launchpad, so a link, unlink or delete rereads
  // them all.
  "traffic.changed": ({ change }) => {
    if (["link", "unlink", "delete"].includes(change)) followLaunchpads(launchpadStore.onEntriesChanged());
  },
  // Launchpads and their entries, changed by any client.
  "launchpad.created": (event) => launchpadStore.onLaunchpadCreated(launchpadOf(event)),
  "launchpad.updated": (event) => launchpadStore.onLaunchpadUpdated(launchpadOf(event)),
  "launchpad.deleted": ({ id }) => followLaunchpads(launchpadStore.onLaunchpadDeleted(id)),
  "launchpad.linked": ({ launchpad_id }) => followLaunchpads(launchpadStore.onEntriesChanged([launchpad_id])),
  "launchpad.unlinked": ({ launchpad_id }) => followLaunchpads(launchpadStore.onEntriesChanged([launchpad_id])),
  "launchpad.entries_moved": (moved) =>
    followLaunchpads(
      launchpadStore.onEntriesChanged([...new Set([moved.source_launchpad_id, moved.target_launchpad_id])]),
    ),
  // Launches by any client: pending, then how each ended.
  "launch.started": (event) => launchpadStore.onLaunchStarted(launchOf(event)),
  "launch.completed": (event) => followLaunchpads(launchpadStore.onLaunchFinished(launchOf(event))),
  "launch.cancelled": (event) => followLaunchpads(launchpadStore.onLaunchFinished(launchOf(event))),
  "launch.failed": (event) => followLaunchpads(launchpadStore.onLaunchFinished(launchOf(event))),
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
  // whose client left arrives as checkpoint.dropped, reason abandoned.
  "checkpoint.held": () =>
    checkpointStore.onHeld().catch((err) => console.error("Reading Checkpoint items failed:", err)),
  "checkpoint.forwarded": (event) => checkpointResolved(event),
  "checkpoint.dropped": (event) => checkpointResolved(event),
  "checkpoint.updated": (flags) => checkpointStore.onUpdated(flags),
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
