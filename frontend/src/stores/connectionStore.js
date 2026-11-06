// The connection store bound to the app: the local instance through Go's
// ConnectLocal, and the service through the app's service client. The
// lifecycle is in createConnectionStore.js.
import { ConnectLocal } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createConnectionStore } from "./createConnectionStore.js";
import { loadProject, projectStore } from "./projectStore.js";

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
});
