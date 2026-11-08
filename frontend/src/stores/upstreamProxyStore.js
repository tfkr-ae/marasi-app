// The app's upstream proxy store over the service client. The logic lives in
// createUpstreamProxyStore.js and the API shapes in upstreamProxyApi.js;
// this file binds them to the app's client and follows the service's
// upstream proxy events. Choosing a CA file stays a Go binding.
import { get } from "svelte/store";
import { ReadUpstreamProxyCAFile } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createUpstreamProxyApi } from "./upstreamProxyApi.js";
import { createUpstreamProxyStore } from "./createUpstreamProxyStore.js";
import { projectData } from "./projectData.js";

export {
  selectionWarning,
  upstreamAddress,
} from "./createUpstreamProxyStore.js";

export const upstreamProxyStore = createUpstreamProxyStore(createUpstreamProxyApi(service));

// Once Settings has read the list, keep it current: another client's edit
// or selection applies its event, and a project load or reconnect reads it
// again.
function reloadShown() {
  if (!get(upstreamProxyStore).loaded) return;
  return upstreamProxyStore.load().catch((error) => console.error("Reading upstream proxies failed:", error));
}
for (const name of ["upstream_proxy.added", "upstream_proxy.updated", "upstream_proxy.removed"]) {
  service.on(name, upstreamProxyStore.onListChanged);
}
service.on("upstream_proxy.selected", upstreamProxyStore.onSelected);
projectData.register("upstreamProxies", { clear: upstreamProxyStore.clear, load: reloadShown });

/** Asks for a CA file and resolves to its text, or "" when cancelled. */
export const readUpstreamProxyCAFile = () => ReadUpstreamProxyCAFile();
