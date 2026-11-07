// The app's store for the connected service's own update, fed by its
// update.* events (serviceUpdate.js), and cleared when the active
// connection changes, since the events describe that connection's service.
import { service } from "../lib/service/index.js";
import { connectionStore } from "./connectionStore.js";
import { createServiceUpdateStore, SERVICE_UPDATE_EVENTS } from "./serviceUpdate.js";

export { serviceUpdateLine, serviceUpdateToast, SERVICE_UPDATE_EVENTS } from "./serviceUpdate.js";

export const serviceUpdateStore = createServiceUpdateStore();

for (const name of SERVICE_UPDATE_EVENTS) service.on(name, (data) => serviceUpdateStore.onEvent(name, data));

let connectionId = null;
connectionStore.subscribe((state) => {
  if (state.connection.id !== connectionId) serviceUpdateStore.clear();
  connectionId = state.connection.id;
});
