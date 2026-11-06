// The connection store bound to the app: the local instance through Go's
// ConnectLocal, and the service through the app's service client. The
// lifecycle is in createConnectionStore.js.
import { ConnectLocal } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createConnectionStore } from "./createConnectionStore.js";
import { serviceProjectLoaded } from "../stores.js";
import { homeStore } from "./homeStore.js";

export const connectionStore = createConnectionStore({
  connectLocal: () => ConnectLocal(),
  use: (connection) => service.use(connection),
  readStatus: () => service.get("/service/status"),
  openEvents: (handlers) => service.openEvents(handlers),
  closeEvents: () => service.closeEvents(),
  // Only Home reads the service so far; each page's ticket adds its store.
  loadProject: async (status) => {
    homeStore.clear();
    await homeStore.populate();
    serviceProjectLoaded(status.project);
  },
});
