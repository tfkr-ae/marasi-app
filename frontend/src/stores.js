import { get, writable } from "svelte/store";
import {
  GetMarasiConfig,
  GetKeybindings,
  GetExtensionCode,
  GetExtensions,
  LoadExtensions,
  GetUserName,
} from "./lib/bindings/App";
import { testCaseStore } from "./stores/testCaseStore";
import { findingStore } from "./stores/findingStore";
import { logbookStore } from "./stores/logbookStore";
import { connectionStore } from "./stores/connectionStore";
import { armoryStore } from "./stores/armoryStore";
import { launchpadStore } from "./stores/launchpadStore";
import { checkpointStore } from "./stores/checkpointStore";
import { logStore } from "./stores/logStore.js";
import { interceptFlag } from "./stores/interceptFlag.js";
import { highlightsStore, readHighlights } from "./stores/highlightsStore";
import { ledgerStore } from "./stores/ledgerStore";
import { sitemapStore } from "./stores/sitemapStore";
import { jobsStore } from "./stores/jobsStore";
import { recentTraffic } from "./stores/recentTrafficStore";
import { savedQueriesStore } from "./stores/savedQueriesStore";
import { upstreamProxyStore } from "./stores/upstreamProxyStore";
import { waypointStore } from "./stores/waypointStore.js";
import { wrapStartsOn } from "./lib/lineWrap.js";
import { textSizeFrom } from "./lib/textSize.js";
import { textSize } from "./stores/textSizeStore.js";
import { loadSignals } from "./lib/openProgress.js";

// Startup. `started` turns true once the first project has loaded, and the
// app's pages stay mounted from then on; `isReady` is false while a project
// opens or loads.
export const appState = writable({
  started: false,
  isReady: false,
  message: "Starting...",
  details: "",
});

// Extensions
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

// Waypoint: the open project's {hostname: override} map.
export const waypoints = waypointStore;

// Checkpont
export const checkpointCode = writable("");
// The rules Checkpoint runs: what the project loaded, then each Update rules.
export const checkpointCodeApplied = writable("");
export { interceptFlag } from "./stores/interceptFlag.js";

// Workshop
export const workshopCode = writable("");

export const extensionElements = writable({});
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

// The connected instance's proxy listener, {status, address, port}.
export { listenerStore as listener } from "./stores/listenerStore.js";
export let activeProject = writable("Marasi");
/**
 * Bumped after each project loads, so the app's pages mount afresh on the
 * new project's stores.
 */
export const pagesKey = writable(0);

/**
 * Reads the project the instance has open into the stores, after startup
 * or a switch. `loadPart(signal)` is told as each part starts loading
 * (loadSignals in lib/openProgress.js), for the opening screen.
 */
export async function openProject(loadPart = () => {}) {
  // Each loadPart signal tells the opening screen which part loads next.
  loadPart(loadSignals.traffic);
  reportMetadata.set({
    title: get(activeProject) + " Report",
    client: "Client Name",
    type: "Assessment Type",
    is_draft: true,
    scope: "Assessment Scope",
    assessor: await GetUserName().catch(() => "Assessor"),
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
  workshopCode.set("");
  waypoints.clear();
  ledgerStore.clear();
  sitemapStore.clear();
  jobsStore.clear();
  recentTraffic.clear();
  // Project saved queries belong to the project just opened.
  savedQueriesStore.loadProject();
  extensions.set([]);
  extensions_ui.set({});
  testCaseStore.clear();
  findingStore.clear();
  logbookStore.clear();
  connectionStore.clear();
  armoryStore.clear();
  launchpadStore.clear();
  checkpointStore.clear();
  // The Ledger's first page and its exclusion load in the background, and
  // first: it is the page researchers open, and its rows don't wait on the
  // project's extensions.
  ledgerStore.populate();
  loadPart(loadSignals.extensions);
  try {
    await LoadExtensions();
  } catch (err) {
    console.error("Failed to load project extensions:", err);
  }

  // Reset items. The recent traffic for extensions loads in the background.
  recentTraffic.populate();
  // Marasi's background jobs, polled while one runs.
  jobsStore.refresh();
  // The project's highlight labels, then its old hex highlights migrated in
  // the background; the Ledger reloads once they are numbers.
  highlightsStore.openProject({ onMigrated: () => ledgerStore.reload() });
  loadPart(loadSignals.logs);
  logStore.clear();
  await logStore.reload().catch((err) => console.error("Reading the log failed:", err));
  loadPart(loadSignals.scope);
  await populateScope();
  loadPart(loadSignals.checkpoint);
  await populateCheckpoint();
  loadPart(loadSignals.workshop);
  await populateWorkshop();
  loadPart(loadSignals.waypoints);
  await populateWaypoints();
  loadPart(loadSignals.extensionList);
  await populateExtensions();
  loadPart(loadSignals.testCases);
  await testCaseStore.populate();
  loadPart(loadSignals.findings);
  await findingStore.populate();
  await logbookStore.populate();
  loadPart(loadSignals.intercept);
  await connectionStore.populateInterceptFlag();
  loadPart(loadSignals.armory);
  await armoryStore.populate();
  loadPart(loadSignals.launchpads);
  await launchpadStore.populate();
  // The project's upstream proxy selection. The listener and the
  // instance's version belong to the instance, and Home reads the
  // dashboard as it mounts.
  await upstreamProxyStore.reload().catch((err) => console.error("Reading upstream proxies failed:", err));
}

export async function populateWaypoints() {
  await waypoints.reload().catch((err) => console.error("Reading waypoints failed:", err));
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
export async function populateExtensions() {
  GetExtensions().then((exts) => {
    console.log(exts);
    extensions.set(exts ? exts : []);
  });
}
