// The window's connection store, wired to the main process bridge and the
// Marasi client module (createWindowConnectionStore.js has the logic).
import { get } from "svelte/store";
import { createWindowConnectionStore } from "./createWindowConnectionStore.js";
import { useConnection } from "../lib/bindings/marasi.js";

// Outside Electron (a plain browser on the dev server) there is no bridge,
// and so no local instance to connect to.
const bridge = globalThis.window?.marasiApp ?? {
  listInstances: async () => {
    throw new Error("Open Marasi v2 to connect to an instance");
  },
  connect: async () => {
    throw new Error("Open Marasi v2 to connect to an instance");
  },
  connection: async () => null,
};

export const windowConnection = createWindowConnectionStore({
  listInstances: () => bridge.listInstances(),
  connect: (instance) => bridge.connect(instance),
  current: () => bridge.connection(),
  useConnection,
});

/**
 * The window's title for open project `project`: the project and the
 * instance it is open on, so the researcher knows where actions go.
 */
export function windowTitle(project) {
  const instance = get(windowConnection).connection?.instance;
  return instance ? `${project} — ${instance}` : project;
}
