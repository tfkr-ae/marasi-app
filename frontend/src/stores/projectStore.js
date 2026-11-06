// The project store bound to the app: the service client, the native
// unsaved-work prompt, and the app's full project load. The open flow is in
// createProjectStore.js.
import { derived } from "svelte/store";
import { ConfirmProjectSwitch } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { loadSignals, projectName } from "../lib/openProgress.js";
import { activeProject, resetProject } from "../stores.js";
import { createProjectApi } from "./projectApi.js";
import { createProjectStore } from "./createProjectStore.js";
import { homeStore } from "./homeStore.js";

/**
 * Loads the service's project at `path` into every store, on connecting and
 * after each switch. `part(signal)` tells the opening screen what loads
 * next. Each page's ticket adds its store's populate here.
 */
export async function loadProject(path, part = () => {}) {
  part(loadSignals.traffic);
  await resetProject(projectName(path));
  homeStore.clear();
  await homeStore.populate();
}

export const projectStore = createProjectStore(
  createProjectApi(service, { confirmSwitch: () => ConfirmProjectSwitch(), loadProject }),
);

/** The open in progress (lib/openProgress.js state), or null. */
export const opening = derived(projectStore, (state) => state.opening);
/** Whether the opening screen is up: slow opens and failures. */
export const openingShown = derived(projectStore, (state) => state.shown);
/** The project loaded, `{name, path}`, or null until the first has. */
export const loadedProject = derived(projectStore, (state) => state.loaded);
/** Bumped after each switch's load, so the pages mount afresh. */
export const pagesKey = derived(projectStore, (state) => state.generation);

// The window, Home and the report name the loaded project.
loadedProject.subscribe((project) => project && activeProject.set(project.name));
