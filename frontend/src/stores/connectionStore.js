// The connection store bound to the app: the local instance through Go's
// ConnectLocal, and the service through the app's service client. The
// lifecycle is in createConnectionStore.js.
import { ConnectLocal, ConfirmProjectSwitch, MarasiPin } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createConnectionStore } from "./createConnectionStore.js";
import { loadedProject, loadProject, projectStore, resyncProject } from "./projectStore.js";

export const connectionStore = createConnectionStore({
  connectLocal: () => ConnectLocal(),
  use: (connection) => service.use(connection),
  readStatus: () => service.get("/service/status"),
  openEvents: (handlers) => service.openEvents(handlers),
  closeEvents: () => service.closeEvents(),
  // The project the service has open, whichever it is: the scratchpad on a
  // fresh instance, or what it had open when the app attached.
  loadProject: async (status) => {
    await loadProject(status.project);
    projectStore.loaded(status.project);
  },
  // After a reconnect to the same project.
  resync: () => resyncProject(),
  // After a reconnect that found another project or a restarted service:
  // the unsaved-work prompt, then the full load (the pages remount).
  confirmSwitch: () => ConfirmProjectSwitch(),
  reloadProject: (status) => projectStore.reload(status.project),
});

// Reconnects compare the service's project with the one loaded last, which
// a switch changes.
loadedProject.subscribe((project) => project && connectionStore.dispatch({ type: "PROJECT_LOADED", path: project.path }));
// A restart announced before the stream drops means a full load afterwards.
service.on("service.restarting", () => connectionStore.dispatch({ type: "SERVICE_RESTARTING" }));
// The Marasi date the app was built against: an older service warns.
MarasiPin()
  .then((pin) => connectionStore.dispatch({ type: "MARASI_PIN", pin }))
  .catch((err) => console.error("Reading the pinned Marasi version failed:", err));
