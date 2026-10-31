// The connected instance's version and updates, wired to the Marasi client
// module and the main process bridge (createInstanceUpdateStore.js has the
// logic). It reads the instance again each time the window connects.
import { get } from "svelte/store";
import { createInstanceUpdateStore } from "./createInstanceUpdateStore.js";
import { windowConnection } from "./windowConnectionStore.js";
import { marasi } from "../lib/bindings/marasi.js";

// Outside Electron there is no bundled Marasi.
const bridge = globalThis.window?.marasiApp ?? { runsBundled: async () => false };

export const instanceUpdate = createInstanceUpdateStore({
  get: (path) => marasi.get(path),
  post: (path, body) => marasi.post(path, body),
  put: (path, body) => marasi.put(path, body),
  delete: (path, body) => marasi.delete(path, body),
  connection: () => get(windowConnection).connection,
  runsBundled: (installPath) => bridge.runsBundled(installPath),
});

let baseURL = null;
windowConnection.subscribe(({ connection }) => {
  const next = connection?.baseURL ?? null;
  if (next === baseURL) return;
  baseURL = next;
  instanceUpdate.reload().catch((error) => console.error("Reading the instance's version failed:", error));
});
