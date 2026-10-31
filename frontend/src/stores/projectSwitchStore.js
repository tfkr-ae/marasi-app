// The window's project switch store, wired to the Marasi client module, the
// main process and the app's stores (createProjectSwitchStore.js has the
// logic).
import { get } from "svelte/store";
import { goto } from "$app/navigation";
import { createProjectSwitchStore } from "./createProjectSwitchStore.js";
import { GetRecentProjects, OpenProject } from "../lib/bindings/App";
import { WindowSetTitle } from "../lib/bindings/runtime";
import { localInstances, openInstanceWindow, windowConnection, windowTitle } from "./windowConnectionStore.js";
import { activeProject, appState, openProject, pagesKey } from "../stores.js";

export const projectSwitch = createProjectSwitchStore({
  openProject: OpenProject,
  listProjects: GetRecentProjects,
  localInstances,
  isRemote: () => Boolean(get(windowConnection).connection?.remote),
  async load(project, loadPart) {
    activeProject.set(project.name);
    WindowSetTitle(windowTitle(project.name));
    goto("/");
    try {
      await openProject(loadPart);
    } finally {
      // The pages mount afresh on the new project's stores.
      pagesKey.update((key) => key + 1);
    }
  },
  busy: (isBusy) => appState.update((s) => ({ ...s, isReady: !isBusy })),
  openInstanceWindow,
  showCheckpoint: () => goto("/checkpoint"),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});
