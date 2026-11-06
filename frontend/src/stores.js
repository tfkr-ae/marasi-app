import { writable } from "svelte/store";
import {
  GetLogs,
  GetMarasiConfig,
  GetKeybindings,
  GetExtensionCode,
  GetWaypoints,
  GetUserName,
} from "./lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { testCaseStore } from "./stores/testCaseStore";
import { findingStore } from "./stores/findingStore";
import { logbookStore } from "./stores/logbookStore";
import { webSocketStore } from "./stores/webSocketStore";
import { armoryStore } from "./stores/armoryStore";
import { launchpadStore } from "./stores/launchpadStore";
import { checkpointStore } from "./stores/checkpointStore";
import { interceptFlag } from "./stores/interceptFlag.js";
import { readHighlights } from "./stores/highlightsStore";
import { ledgerStore } from "./stores/ledgerStore";
import { sitemapStore } from "./stores/sitemapStore";
import { jobsStore } from "./stores/jobsStore";
import { recentTraffic } from "./stores/recentTrafficStore";
import { wrapStartsOn } from "./lib/lineWrap.js";
import { textSizeFrom } from "./lib/textSize.js";
import { textSize } from "./stores/textSizeStore.js";

// Startup. `started` turns true once the first project has loaded, and the
// app's pages stay mounted from then on; `isReady` is false while a project
// opens or loads.
export const appState = writable({
  started: false,
  isReady: false,
  message: "Starting...",
  details: "",
});

// Extensions (stores/extensionsStore.js keeps them)
export const extensions = writable([]);
export const extensions_ui = writable({});

// Logbook Stores
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
  // Bodies are cut at 1000 bytes unless the tester turns Truncate off.
  truncate_length: 1000,
  custom_properties: { include_test_cases: true },
});

// ---------------------------
// Compass
export const compassCode = writable("");
export const testerInput = writable("");

// Waypoint
export const waypoints = writable({});

// Checkpont
export const checkpointCode = writable("");
// The rules Checkpoint runs: what the project loaded, then each Update rules.
export const checkpointCodeApplied = writable("");
export { interceptFlag } from "./stores/interceptFlag.js";

// Workshop (stores/extensionsStore.js loads it)
export const workshopCode = writable("");

export const logItems = writable([]);
export const prettify = writable(true);
export const lineWrap = writable(true);

export let drawerHeight = writable("h-[60%]");
export let marasiConfig = writable({});
export async function readConfig() {
  const config = await GetMarasiConfig();
  marasiConfig.set(config);
  lineWrap.set(wrapStartsOn(config.WrapMode));
  // Set before anything is drawn, so the app never shows at Default first.
  textSize.set(textSizeFrom(config.TextSize));
  await Promise.all([readKeybindings(), readHighlights()]);
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

export let listener = writable({
  status: false,
  address: "127.0.0.1",
  port: "8080",
});
export let activeProject = writable("Marasi");
/**
 * Resets what the app holds for the project, before the project at `name`
 * loads (projectStore.js's loadProject, which each page's ticket gives its
 * store's populate).
 */
export async function resetProject(name) {
  reportMetadata.set({
    title: name + " Report",
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
    truncate_length: 1000,
    custom_properties: { include_test_cases: true },
  });
  compassCode.set("");
  testerInput.set("");
  checkpointCode.set("");
  checkpointCodeApplied.set("");
  interceptFlag.set(false);
  waypoints.set({});
  ledgerStore.clear();
  sitemapStore.clear();
  recentTraffic.clear();
  testCaseStore.clear();
  findingStore.clear();
  logbookStore.clear();
  webSocketStore.clear();
  armoryStore.clear();
  launchpadStore.clear();
  checkpointStore.clear();
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
export async function populateCheckpoint() {
  GetExtensionCode("checkpoint")
    .then((code) => {
      checkpointCode.set(code);
      checkpointCodeApplied.set(code);
    })
    .catch((error) => {
      console.log(error);
    });
  // The held items and the Intercept all flag.
  checkpointStore
    .populate()
    .catch((err) => console.error("Failed to read Checkpoint items:", err));
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
export async function populateLogs() {
  GetLogs().then((items) => {
    console.log(items);
    logItems.set(items ? items : []);
  });
}
