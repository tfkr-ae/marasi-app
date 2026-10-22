import { get, writable } from "svelte/store";
import {
  GetLogs,
  GetMarasiConfig,
  GetKeybindings,
  GetExtensionCode,
  GetWaypoints,
  GetInterceptFlag,
  GetExtensions,
  LoadExtensions,
  GetUserName,
  GetRecentProjects,
} from "./lib/wailsjs/go/main/App";
import { testCaseStore } from "./stores/testCaseStore";
import { findingStore } from "./stores/findingStore";
import { connectionStore } from "./stores/connectionStore";
import { armoryStore } from "./stores/armoryStore";
import { launchpadStore } from "./stores/launchpadStore";
import { highlightsStore, readHighlights } from "./stores/highlightsStore";
import { ledgerStore } from "./stores/ledgerStore";
import { sitemapStore } from "./stores/sitemapStore";
import { jobsStore } from "./stores/jobsStore";
import { recentTraffic } from "./stores/recentTrafficStore";
import { savedQueriesStore } from "./stores/savedQueriesStore";
import { wrapStartsOn } from "./lib/lineWrap.js";
import {
  loadSignals,
  openingFor,
  openingScreen,
  withFailed,
  withLoadPart,
  withOpened,
  withOpenLog,
  withRecents,
  withSwitched,
} from "./lib/openProgress.js";

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
  lineWrap.set(wrapStartsOn(config.WrapMode));
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
 * The open in progress, as lib/openProgress.js's state, or null. The root
 * layout shows it as the opening screen over the app while `openingShown`.
 */
export const opening = writable(null);
/** Whether the opening screen is up: slow opens, failures and startup. */
export const openingShown = writable(false);
/**
 * The project the app's Go side has open, `{name, path}` (path null when
 * unknown), so a failed open can offer to stay in it and leave it out of
 * the list.
 */
const currentProject = writable(null);
/**
 * Bumped after each project loads, so the app's pages mount afresh on the
 * new project's stores.
 */
export const pagesKey = writable(0);
/**
 * The project last opened and loaded, `{name, path}`, or null until the
 * first one has: startup carries on once it's set.
 */
export const loadedProject = writable(null);
/**
 * Starts the opening screen's state for opening `name` at `path` (null when
 * only a bare name is known), and returns it. `scratchpad` marks the
 * scratchpad. Before the first project has loaded (startup), nothing is
 * open to stay in. An opening screen that's up stays up for the new open.
 */
export function startOpening({ name, path = null, scratchpad = false }) {
  const current = get(appState).started ? get(currentProject) : null;
  const state = openingFor({ name, path, current, scratchpad });
  opening.set(state);
  return state;
}
/** Shows the opening screen for the open in progress. */
export function showOpening() {
  openingShown.set(true);
}
/** Feeds a backend log event to the open in progress, if any. */
export function feedOpeningLog(log) {
  opening.update((state) => state && withOpenLog(state, log));
}
/** Records that the target is open and the previous project released. */
export function switchOpening() {
  opening.update((state) => state && withSwitched(state));
  currentProject.set(get(opening)?.current ?? null);
}
/**
 * Records that the open in progress succeeded, and closes the screen.
 * Returns the project that opened, `{name, path}`.
 */
export function finishOpening() {
  const state = get(opening);
  const opened = state && openingScreen(withOpened(state)).opened;
  clearOpening();
  if (!opened) return null;
  currentProject.set(opened);
  loadedProject.set(opened);
  return opened;
}
/**
 * Stays in the project still open after a failed open, and closes the
 * screen. When the target opened but didn't load, that's the target.
 */
export function stayInCurrentProject() {
  const state = get(opening);
  clearOpening();
  if (state?.current) loadedProject.set(state.current);
}
/**
 * Records that the open in progress failed with `error`, and shows the
 * opening screen with the recent projects to open instead, however fast
 * the open failed.
 */
export function failOpening(error) {
  const current = get(opening);
  if (!current) return;
  const failed = withFailed(current, error);
  opening.set(failed);
  showOpening();
  GetRecentProjects()
    .then((recents) => opening.update((state) => (state === failed ? withRecents(state, recents) : state)))
    .catch((err) => console.error("Listing recent projects failed:", err));
}
/** Closes the opening screen, as after a cancelled open or Stay in. */
export function clearOpening() {
  opening.set(null);
  openingShown.set(false);
}
// Signals that the load sequence starts loading `signal`.
function loadPart(signal) {
  opening.update((state) => state && withLoadPart(state, signal));
}

export async function openProject() {
  // Each loadPart signal tells the opening screen which part loads next.
  loadPart(loadSignals.traffic);
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
  compassCode.set("");
  testerInput.set("");
  checkpointCode.set("");
  interceptFlag.set(false);
  workshopCode.set("");
  waypoints.set({});
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
  connectionStore.clear();
  armoryStore.clear();
  launchpadStore.clear();
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
  await populateLogs();
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
  loadPart(loadSignals.intercept);
  await connectionStore.populateInterceptFlag();
  loadPart(loadSignals.armory);
  await armoryStore.populate();
  loadPart(loadSignals.launchpads);
  await launchpadStore.populate();
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
export async function populateLogs() {
  GetLogs().then((items) => {
    console.log(items);
    logItems.set(items ? items : []);
  });
}
export async function populateExtensions() {
  GetExtensions().then((exts) => {
    console.log(exts);
    extensions.set(exts ? exts : []);
  });
}
