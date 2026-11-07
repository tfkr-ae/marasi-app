// The project store bound to the app: the service client, the native
// unsaved-work prompt, and the app's full project load. The open flow is in
// createProjectStore.js.
import { derived, get } from "svelte/store";
import { ConfirmProjectSwitch, RecentProjects } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { projectName } from "../lib/openProgress.js";
import { activeProject, resetProject } from "../stores.js";
import { createProjectApi } from "./projectApi.js";
import { createProjectStore } from "./createProjectStore.js";
import { projectData } from "./projectData.js";
import { activeConnectionId } from "./activeConnection.js";
// Each store registers itself with projectData when its module loads; these
// stores aren't imported elsewhere before the first load.
import "./homeStore.js";

/**
 * Loads the service's project at `path` into every store, on connecting and
 * after each switch. `part(signal)` tells the opening screen what loads
 * next. It stops once `live()` is false (a newer load superseded it).
 * Stores join through projectData.register (projectData.js).
 */
export async function loadProject(path, part = () => {}, live = () => true) {
  await resetProject(projectName(path), live);
  await projectData.load(part, live);
}

/**
 * Brings every store up to date in place after a stream reset (expired or invalid) on the same
 * project: drafts, selection, scroll and open drawers stay.
 */
export const resyncProject = () => projectData.resync();

export const projectStore = createProjectStore(
  createProjectApi(service, {
    confirmSwitch: () => ConfirmProjectSwitch(),
    loadProject,
    recentProjects: () => RecentProjects(get(activeConnectionId)),
  }),
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
