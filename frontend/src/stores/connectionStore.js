// The connection store bound to the app: the saved connections and their
// passwords through Go (connections.go, keychain.go), a local connection's
// instance through Go's ConnectLocal (Start and Stop through
// StartLocalInstance and StopLocalInstance), and the service through the app's service
// client. The lifecycle is in createConnectionStore.js.
import {
  AddRecentProject,
  ConfirmFollowProject,
  ConfirmProjectSwitch,
  ConnectLocal,
  ConnectionPassword,
  ListConnections,
  SetActiveConnection,
  SetConnectionNoPassword,
  SetConnectionPassword,
  StartLocalInstance,
  StopLocalInstance,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { get } from "svelte/store";
import { createConnectionStore } from "./createConnectionStore.js";
import { connectionServiceApi } from "./connectionServiceApi.js";
import { loadedProject, projectStore, resyncProject } from "./projectStore.js";
import { activeConnectionId } from "./activeConnection.js";
import { trackRecents } from "./recentProjects.js";
import { projectData } from "./projectData.js";
import { homeStore } from "./homeStore.js";
import { projectName } from "../lib/openProgress.js";

export const connectionStore = createConnectionStore({
  ...connectionServiceApi(service, projectStore),
  listConnections: () => ListConnections(),
  connectLocal: (id) => ConnectLocal(id),
  startLocal: (id, project) => StartLocalInstance(id, project),
  stopLocal: (id) => StopLocalInstance(id),
  connectionPassword: (id) => ConnectionPassword(id),
  savePassword: (id, password) => SetConnectionPassword(id, password),
  forgetPassword: (id, origins) => SetConnectionNoPassword(id, origins),
  // What the service sees as this app's Origin when the password is off.
  appOrigin: () => globalThis.location?.origin ?? null,
  setActive: (id) => SetActiveConnection(id),
  // Leaving a connection: the last service's data goes before the next loads.
  clearStores: () => projectData.clear(),
  // A stop takes the proxy listener with it; Home shows it off, as a
  // listener.stopped event would, until Start loads the project again.
  serviceStopped: () => homeStore.onListener({ status: "stopped" }),
  // After a stream reset (expired or invalid) or a service without a run ID.
  resync: () => resyncProject(),
  // After a reconnect that found another project or a restarted service:
  // the unsaved-work prompt, then the full load (the pages remount).
  confirmSwitch: () => ConfirmProjectSwitch(),
  // Another client opened `project`: the same prompt, naming it.
  confirmFollow: (project) => ConfirmFollowProject(projectName(project)),
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
// A change made elsewhere (the CLI, another client) keeps the details current.
for (const name of ["control_listener.updated", "control_listener.stopped", "control_listener.started"]) {
  service.on(name, (control) => connectionStore.dispatch({ type: "CONTROL_LOADED", control }));
}
// A restart another client (or `marasi service restart`) asks for shows in
// the banner until the new run answers; a failed one says why.
service.on("service.restarting", (restart) => connectionStore.dispatch({ type: "SERVICE_RESTARTING", restart }));
service.on("service.restart_failed", (failure) => connectionStore.dispatch({ type: "SERVICE_RESTART_FAILED", failure }));
