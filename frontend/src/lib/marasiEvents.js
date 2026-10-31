// The window's Marasi events: which store's on* method each event goes to,
// and the stores that reload when the event stream reopens. Each ticket
// that ports a store adds its events here.
import { createEventStream } from "./eventStream.js";
import { followConnection, reloadStores } from "./followConnection.js";
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

// Each Marasi event's handler, by event name.
const handlers = {
  "log.added": (log) => logStore.onLogAdded(log),
  "listener.started": (status) => listenerStore.onListener(status),
  "listener.updated": (status) => listenerStore.onListener(status),
  "listener.stopped": (status) => listenerStore.onListener(status),
  "job.progress": (job) => jobsStore.onJobProgress(job),
  "job.complete": (job) => {
    jobsStore.onJobComplete(job);
    dashboardStore.onJobComplete(job).catch((err) => console.error("Counting the dashboard failed:", err));
  },
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
