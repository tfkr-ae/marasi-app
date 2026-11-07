// The extensions' store over the service client. The logic is in
// createExtensionsStore.js and the API shapes in extensionsApi.js; this file
// binds them to the app's client and the pages' writables, and routes the
// stream's extension.* events to the store.
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { compassCode, extensions, extensions_ui, workshopCode } from "../stores.js";
import { createExtensionsApi } from "./extensionsApi.js";
import { createExtensionsStore } from "./createExtensionsStore.js";
export { WORKSHOP } from "./createExtensionsStore.js";
import { projectData } from "./projectData.js";

// The toasts extensions render need the layout's toast store; until it
// hands one over (showExtensionToasts), they are dropped.
let toast = () => {};

/** Shows the toasts extensions render through `show(schema)`. */
export function showExtensionToasts(show) {
  toast = show;
  return () => (toast = () => {});
}

export const extensionsStore = createExtensionsStore(createExtensionsApi(service), {
  list: extensions,
  ui: extensions_ui,
  workshop: workshopCode,
  editors: { compass: compassCode },
  toast: (schema) => toast(schema),
});

projectData.register("extensions", {
  signal: loadSignals.extensions,
  clear: extensionsStore.clear,
  load: extensionsStore.populate,
  resync: extensionsStore.resync,
});

service.on("extension.gui.rendered", extensionsStore.onRendered);
service.on("extension.gui.updated", extensionsStore.onUpdated);
service.on("extension.log", extensionsStore.onLog);
const changed = (summary) =>
  extensionsStore.onChanged(summary).catch((err) => console.error("Reading an extension failed:", err));
service.on("extension.enabled", changed);
service.on("extension.updated", changed);
