import { writable } from "svelte/store";
import {
  GetMarasiConfig,
  GetKeybindings,
  OSUserName,
} from "./lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
// Each registers with projectData as it loads.
import "./stores/logbookStore";
import "./stores/webSocketStore";
// Registers the Armory with projectData before the first load.
import "./stores/armoryStore";
// Registers the Launchpad with projectData before the first load.
import "./stores/launchpadStore";
import "./stores/checkpointStore";
import { readHighlights } from "./stores/highlightsStore";
// The Ledger's stores register with projectData as they load.
import "./stores/ledgerStore";
import "./stores/sitemapStore";
import "./stores/savedQueriesStore";
import "./stores/ledgerMenuCounts";
import "./stores/jobsStore";
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
export { waypoints } from "./stores/waypointStore.js";

// Checkpont
// The rules in the editor, and the rules Checkpoint runs.
export { checkpointCode, checkpointCodeApplied } from "./stores/checkpointStore";
export { interceptFlag } from "./stores/interceptFlag.js";

// Workshop (stores/extensionsStore.js loads it)
export const workshopCode = writable("");

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
 * store's populate). It sets nothing once `live()` is false.
 */
export async function resetProject(name, live = () => true) {
  const assessor = await OSUserName();
  if (!live()) return;
  reportMetadata.set({
    title: name + " Report",
    client: "Client Name",
    type: "Assessment Type",
    is_draft: true,
    scope: "Assessment Scope",
    assessor,
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
}
