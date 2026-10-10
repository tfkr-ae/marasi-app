import { get, writable } from "svelte/store";
import {
  GetProxyItems,
  GetLogs,
  GetMarasiConfig,
  GetKeybindings,
  GetFilters,
  GetExtensionCode,
  GetWaypoints,
  GetInterceptFlag,
  GetExtensions,
  LoadExtensions,
  GetLaunchpads,
  GetLaunchpadRequests,
  GetUserName,
} from "./lib/wailsjs/go/main/App";
import { testCaseStore } from "./stores/testCaseStore";
import { findingStore } from "./stores/findingStore";
import { connectionStore } from "./stores/connectionStore";
import { armoryStore } from "./stores/armoryStore";
import {
  clearQuery,
  markTrafficChanged,
  patchQueryResultMetadata,
  patchQueryResultResponses,
  sameID,
} from "./stores/ledgerQuery";

// Startup
export const appState = writable({
  isReady: false,
  message: "Starting...",
  details: "",
});

// Extensions
export const extensions = writable([]);
export const extensions_ui = writable({});

// Ledger Stores
export const sorting = writable([{ id: "ID", desc: true }]);
export const pagination = writable({ pageIndex: 0, pageSize: 100 });
export const proxyItems = writable([]);
export const contentTypeFilter = writable([]);
export const contentTypeFilterInput = writable("");

// Logbook Stores
export const logbookSearchInput = writable("");
export const reportMetadata = writable({
  title: "Report Title",
  client: "Client Name",
  type: "Assessment Type",
  is_draft: true,
  scope: "Assessment Scope",
  assessor: "Assessor",
  start: new Date(
    new Date().setDate(new Date().getDate() - 14),
  ).toLocaleDateString("en-CA"),
  end: new Date().toLocaleDateString("en-CA"),
  created_at: new Date().toISOString(),
  truncate_length: 0,
  custom_properties: {},
});

let requestBuffer = [];
let responseBuffer = new Map();
function flushBuffer() {
  if (requestBuffer.length === 0 && responseBuffer.size === 0) return;

  const reqBatch = requestBuffer;
  const resBatch = responseBuffer;

  requestBuffer = [];
  responseBuffer = new Map();

  proxyItems.update((items) => {
    let current = Array.isArray(items) ? items : [];

    if (resBatch.size > 0 && current.length > 0) {
      current = current.map((item) => {
        if (resBatch.has(item.ID)) {
          return { ...item, ...resBatch.get(item.ID) };
        }
        return item;
      });
    }

    if (reqBatch.length > 0) {
      if (resBatch.size > 0) {
        for (let i = 0; i < reqBatch.length; i++) {
          const req = reqBatch[i];
          if (resBatch.has(req.ID)) {
            reqBatch[i] = { ...req, ...resBatch.get(req.ID) };
          }
        }
      }
      current = [...current, ...reqBatch];
    }

    return current;
  });

  // Responses also fill in loaded query results, and any traffic may bring
  // new matches.
  patchQueryResultResponses(resBatch);
  markTrafficChanged();
}
if (typeof window !== "undefined") {
  setInterval(flushBuffer, 200);
}

export function addRequest(req) {
  requestBuffer.push(req);
  if (requestBuffer.length > 500) flushBuffer();
}
export function addResponse(res) {
  responseBuffer.set(res.ID, res);

  if (responseBuffer.size > 500) flushBuffer();
}

export function patchWebSocketMetadata(conn) {
  if (!conn?.RequestID) return;
  const patch = {
    protocol: "websocket",
    "websocket.state": conn.State || "closed",
    "websocket.transport": conn.Transport,
    "websocket.close_code": conn.CloseCode,
    "websocket.close_reason": conn.CloseReason,
  };
  patchLiveViewMetadata(conn.RequestID, patch);
  patchQueryResultMetadata(conn.RequestID, patch);
  markTrafficChanged();
}

/**
 * Merges `patch` into the Metadata of the live-view pair with this ID. Does
 * nothing when the live view doesn't hold the pair.
 */
export function patchLiveViewMetadata(id, patch) {
  proxyItems.update((items) =>
    (items || []).map((item) => {
      if (!sameID(item.ID, id)) return item;
      return { ...item, Metadata: { ...(item.Metadata || {}), ...patch } };
    }),
  );
}

// ---------------------------
// Compass
export const compassCode = writable("");
export const testerInput = writable("");

// Waypoint
export const waypoints = writable({});

// Checkpont
export const checkpointCode = writable("");
export const interceptFlag = writable(false);

// Workshop
export const workshopCode = writable("");

export const logItems = writable([]);
export const extensionElements = writable({});
export const prettify = writable(true);
export const lineWrap = writable(true);

export let drawerHeight = writable("h-[60%]");
export let marasiConfig = writable({});
export async function readConfig() {
  const config = await GetMarasiConfig();
  marasiConfig.set(config);
  await readKeybindings();
}

// Saved keybinding profiles ({ config, problem }) from the app config; the
// global menu hands them to the shortcut dispatcher.
export const keybindingState = writable(null);
export async function readKeybindings() {
  try {
    keybindingState.set(await GetKeybindings());
  } catch (error) {
    console.error("reading keybindings, using factory shortcuts:", error);
  }
}

// Launchpad navigation state persistence
export const currentEntryIndex = writable(0);
export const activeLaunchpadID = writable("");
export const launchpads = writable([]);

export let listener = writable({
  status: false,
  address: "127.0.0.1",
  port: "8080",
});
export let activeProject = writable("Marasi");
/**
 * Turns a backend log event from opening a project into splash-screen text,
 * or returns null for events the splash ignores. Migrations log one record
 * per statement through goose, with the migration file as `source`.
 */
export function projectOpenMessage(log) {
  const data = log?.data;
  if (data?.logger === "goose" && data.source) {
    return `Upgrading project database (${data.source})…`;
  }
  if (data?.component !== "db") return null;
  if (log.message === "Connecting to SQLite...") {
    return "Opening project database…";
  }
  if (log.message === "Migrations completed") {
    return "Project database upgraded";
  }
  return log.message;
}

export async function openProject() {
  appState.set({
    isReady: false,
    message: "Loading " + get(activeProject) + "…",
    details: "",
  });
  requestBuffer = [];
  responseBuffer = new Map();
  pagination.set({ pageIndex: 0, pageSize: 100 });
  sorting.set([{ id: "ID", desc: true }]);
  clearQuery();
  logbookSearchInput.set("");
  reportMetadata.set({
    title: get(activeProject) + " Report",
    client: "Client Name",
    type: "Assessment Type",
    is_draft: true,
    scope: "Assessment Scope",
    assessor: await GetUserName(),
    start: new Date(
      new Date().setDate(new Date().getDate() - 14),
    ).toLocaleDateString("en-CA"),
    end: new Date().toLocaleDateString("en-CA"),
    created_at: new Date().toISOString(),
    truncate_length: 0,
    custom_properties: {},
  });
  contentTypeFilter.set([]);
  contentTypeFilterInput.set("");
  compassCode.set("");
  testerInput.set("");
  checkpointCode.set("");
  interceptFlag.set(false);
  workshopCode.set("");
  waypoints.set({});
  proxyItems.set([]);
  currentEntryIndex.set(0);
  activeLaunchpadID.set("");
  extensions.set([]);
  extensions_ui.set({});
  testCaseStore.clear();
  findingStore.clear();
  connectionStore.clear();
  armoryStore.clear();
  try {
    await LoadExtensions();
  } catch (err) {
    console.error("Failed to load project extensions:", err);
  }

  // Reset items
  await populateHistory();
  await populateLogs();
  await populateFilters();
  await populateScope();
  await populateCheckpoint();
  await populateWorkshop();
  await populateWaypoints();
  await populateExtensions();
  await populateLaunchpads();
  await testCaseStore.populate();
  await findingStore.populate();
  await connectionStore.populateInterceptFlag();
  await armoryStore.populate();
}

export async function populateWaypoints() {
  GetWaypoints()
    .then((points) => {
      console.log(points);
      waypoints.set(points);
    })
    .catch((waypointErr) => {
      console.log(waypointErr);
    });
}
export async function populateWorkshop() {
  GetExtensionCode("workshop")
    .then((code) => {
      workshopCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
}
export async function populateCheckpoint() {
  GetExtensionCode("checkpoint")
    .then((code) => {
      checkpointCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
  GetInterceptFlag().then((flag) => {
    interceptFlag.set(flag);
  });
}
export async function populateScope() {
  GetExtensionCode("compass")
    .then((code) => {
      compassCode.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
}
export async function populateFilters() {
  GetFilters().then((filters) => {
    console.log("----- Filter ------");
    console.log(filters);
    console.log("----- Filter ------");
    contentTypeFilter.set(filters ? filters : []);
  });
}
export async function populateLogs() {
  GetLogs().then((items) => {
    console.log(items);
    logItems.set(items ? items : []);
  });
}
export async function populateHistory() {
  const start = performance.now();
  GetProxyItems()
    .then((items) => {
      console.log("Received items from Go:", items);
      proxyItems.set(items ? items : []);
      const end = performance.now();
      console.log(`Time taken to set store: ${end - start} ms`);
    })
    .catch((err) => {
      console.log(err);
    });
}

export async function populateExtensions() {
  GetExtensions().then((exts) => {
    console.log(exts);
    extensions.set(exts ? exts : []);
  });
}
export async function populateLaunchpads() {
  const items = await GetLaunchpads();

  const initalisedItems = (items || []).map((item) => ({
    ...item,
    Entries: [],
  }));

  launchpads.set(initalisedItems);
}

export async function populateLaunchpadEntries(id) {
  if (!id) return;

  const reqs = await GetLaunchpadRequests(id);
  launchpads.update((tabs) => {
    return tabs.map((t) => {
      if (t.ID == id) {
        return { ...t, Entries: reqs || [] };
      }
      return t;
    });
  });
}
