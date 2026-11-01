// The window's Marasi events: which store's on* method each event goes to,
// and the stores that reload when the event stream reopens. Each ticket
// that ports a store adds its events here.
import { createEventStream } from "./eventStream.js";
import { followConnection, reloadStores } from "./followConnection.js";
import { requestEvent, responseEvent } from "./bindings/traffic.js";
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
import { listenerStore } from "../stores/listenerStore.js";
import { dashboardStore } from "../stores/dashboardStore.js";
import { instanceUpdate } from "../stores/instanceUpdateStore.js";
import { projectSwitch } from "../stores/projectSwitchStore.js";

// Logs a store's failed re-read of what an event changed.
const logged = (what) => (promise) => promise.catch((err) => console.error(`Reading ${what} again failed:`, err));
const finding = logged("a finding");
const testCase = logged("a test case");

// Findings and test cases, by any client: the record an event names is read
// again, or leaves its list.
const recordHandlers = {
  "finding.created": (event) => finding(findingStore.onChanged(event.id)),
  "finding.updated": (event) => finding(findingStore.onChanged(event.id)),
  "finding.linked": (event) => finding(findingStore.onChanged(event.finding_id)),
  "finding.unlinked": (event) => finding(findingStore.onChanged(event.finding_id)),
  "finding.deleted": (event) => findingStore.onDeleted(event.id),
  "test-case.created": (event) => testCase(testCaseStore.onChanged(event.id)),
  "test-case.updated": (event) => testCase(testCaseStore.onChanged(event.id)),
  "test-case.linked": (event) => testCase(testCaseStore.onChanged(event.test_case_id)),
  "test-case.unlinked": (event) => testCase(testCaseStore.onChanged(event.test_case_id)),
  "test-case.deleted": (event) => {
    testCaseStore.onDeleted(event.id);
    findingStore.onTestCaseDeleted(event.id);
  },
  "artifact.created": (event) =>
    event.finding_id
      ? finding(findingStore.onChanged(event.finding_id))
      : testCase(testCaseStore.onChanged(event.test_case_id)),
  "artifact.deleted": (event) => {
    findingStore.onArtifactDeleted(event.id);
    testCaseStore.onArtifactDeleted(event.id);
  },
};

// The bulk changes that link, unlink or delete pairs. Their event doesn't
// name the finding or test case, so both lists are read again.
const relinkingChanges = new Set(["link", "unlink", "delete"]);

// Each Marasi event's handler, by event name.
const handlers = {
  ...recordHandlers,
  "traffic.changed": (event) => {
    if (!relinkingChanges.has(event.change)) return;
    finding(findingStore.reload());
    testCase(testCaseStore.reload());
  },
  "log.added": (log) => logStore.onLogAdded(log),
  // Captured traffic, in v1's request and response shapes.
  "traffic.request": (event) => {
    const request = requestEvent(event);
    ledgerStore.onRequest(request);
    recentTraffic.onRequest(request);
  },
  "traffic.response": (event) => {
    const response = responseEvent(event);
    ledgerStore.onResponse(response);
    recentTraffic.onResponse(response);
  },
  "listener.started": (status) => listenerStore.onListener(status),
  "listener.updated": (status) => listenerStore.onListener(status),
  "listener.stopped": (status) => listenerStore.onListener(status),
  "job.progress": (job) => jobsStore.onJobProgress(job),
  "job.complete": (job) => {
    jobsStore.onJobComplete(job);
    dashboardStore.onJobComplete(job).catch((err) => console.error("Counting the dashboard failed:", err));
  },
  "update.available": (update) => instanceUpdate.onAvailable(update),
  "update.progress": (progress) => instanceUpdate.onProgress(progress),
  "update.installed": (installed) => instanceUpdate.onInstalled(installed),
  "update.failed": (failure) => instanceUpdate.onFailed(failure),
  "service.restarting": (restart) => instanceUpdate.onRestarting(restart),
  "service.restart_failed": (failure) => instanceUpdate.onRestartFailed(failure),
  // A switch of the instance's project, by any client; the window reloads
  // every store's project on project.opened.
  "project.opening": (event) => projectSwitch.onOpening(event),
  "project.upgrading": (event) => projectSwitch.onUpgrading(event),
  "project.waiting": (event) => projectSwitch.onWaiting(event),
  "project.opened": (event) =>
    projectSwitch.onOpened(event).catch((err) => console.error("Loading the opened project failed:", err)),
  "project.opening_failed": (event) => projectSwitch.onOpeningFailed(event),
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
  instanceUpdate,
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
