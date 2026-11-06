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

// Once Settings has read the list, keep it current: another client's edit,
// a project's selection, or a reconnect reads it again.
function reloadShown() {
  if (!get(upstreamProxyStore).loaded) return;
  return upstreamProxyStore.load().catch((error) => console.error("Reading upstream proxies failed:", error));
}
for (const name of ["added", "updated", "removed", "selected"]) service.on(`upstream_proxy.${name}`, reloadShown);
projectData.register("upstreamProxies", { load: reloadShown });

/** Asks for a CA file and resolves to its text, or "" when cancelled. */
export const readUpstreamProxyCAFile = () => ReadUpstreamProxyCAFile();
