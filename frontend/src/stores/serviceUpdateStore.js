// The app's store for the connected service's own update, backed by the
// service's control API (/update, /update/check, /update/install,
// DELETE /update/install) and live update.* SSE events. Follows the active
// connection: clears immediately on switch and reloads GET /update whenever a
// connection enters connected or reconnects onto a new run.
import { service } from "../lib/service/index.js";
import { connectionStore } from "./connectionStore.js";
import { createServiceUpdateApi } from "./serviceUpdateApi.js";
import { createServiceUpdateStore, followConnection, SERVICE_UPDATE_EVENTS } from "./serviceUpdate.js";

export { serviceUpdateLine, serviceUpdateToast, SERVICE_UPDATE_EVENTS } from "./serviceUpdate.js";

export const serviceUpdateStore = createServiceUpdateStore(createServiceUpdateApi(service));

for (const name of SERVICE_UPDATE_EVENTS) service.on(name, (data) => serviceUpdateStore.onEvent(name, data));

followConnection(connectionStore, serviceUpdateStore);
