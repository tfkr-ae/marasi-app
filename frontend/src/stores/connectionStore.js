// The connection store bound to the app: the saved connections and their
// passwords through Go (connections.go, keychain.go), the local instance
// through Go's ConnectLocal, and the service through the app's service
// client. The lifecycle is in createConnectionStore.js.
import {
  AddRecentProject,
  ConfirmProjectSwitch,
  ConnectLocal,
  ConnectionPassword,
  ListConnections,
  MarasiPin,
  SetActiveConnection,
  SetConnectionNoPassword,
  SetConnectionPassword,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";
import { loadedProject, loadProject, projectStore, resyncProject } from "./projectStore.js";
import { activeConnectionId } from "./activeConnection.js";
import { trackRecents } from "./recentProjects.js";
import { projectData } from "./projectData.js";

export const connectionStore = createConnectionStore({
  listConnections: () => ListConnections(),
  connectLocal: () => ConnectLocal(),
  connectionPassword: (id) => ConnectionPassword(id),
  savePassword: (id, password) => SetConnectionPassword(id, password),
  forgetPassword: (id, origins) => SetConnectionNoPassword(id, origins),
  // The control listener: sharing, the password and the allowed origins.
  readControl: () => service.get("/service/control-listener/status"),
  updateControl: (body) => service.post("/service/control-listener/update", body),
  // What the service sees as this app's Origin when the password is off.
  appOrigin: () => globalThis.location?.origin ?? null,
  setActive: (id) => SetActiveConnection(id),
  // Leaving a connection: the last service's data goes before the next loads.
  clearStores: () => projectData.clear(),
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
// a switch changes. Each project loaded joins the connection's recents.
loadedProject.subscribe(
  trackRecents({
    connectionId: () => get(connectionStore).connection.id,
    addRecent: (id, name, path) =>
      AddRecentProject(id, name, path).catch((err) => console.error("Saving the recent project failed:", err)),
    onLoaded: (path) => connectionStore.dispatch({ type: "PROJECT_LOADED", path }),
  }),
);
// The project store reads the active connection's recents.
connectionStore.subscribe((state) => activeConnectionId.set(state.connection.id));
// A restart announced before the stream drops means a full load afterwards.
service.on("service.restarting", () => connectionStore.dispatch({ type: "SERVICE_RESTARTING" }));
// A change made elsewhere (the CLI, another client) keeps the details current.
for (const name of ["control_listener.updated", "control_listener.stopped", "control_listener.started"]) {
  service.on(name, (control) => connectionStore.dispatch({ type: "CONTROL_LOADED", control }));
}
// The Marasi date the app was built against: an older service warns.
MarasiPin()
  .then((pin) => connectionStore.dispatch({ type: "MARASI_PIN", pin }))
  .catch((err) => console.error("Reading the pinned Marasi version failed:", err));
