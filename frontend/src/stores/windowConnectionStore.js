// The window's connection store, wired to the main process bridge and the
// Marasi client module (createWindowConnectionStore.js has the logic).
import { get } from "svelte/store";
import { createWindowConnectionStore } from "./createWindowConnectionStore.js";
import { createWindowListStore } from "./createWindowListStore.js";
import { useConnection } from "../lib/bindings/marasi.js";

// Outside Electron (a plain browser on the dev server) there is no bridge,
// and so no local instance to connect to, and no other window.
const outsideElectron = async () => {
  throw new Error("Open Marasi v2 to connect to an instance");
};
const bridge = globalThis.window?.marasiApp ?? {
  listInstances: outsideElectron,
  startup: async () => null,
  connect: outsideElectron,
  start: outsideElectron,
  disconnect: async () => {},
  marasi: async () => null,
  chooseMarasi: outsideElectron,
  pickProject: outsideElectron,
  newWindow: outsideElectron,
  windows: async () => [],
  focusWindow: async () => {},
  onWindowsChanged: () => () => {},
  reportProject: async () => {},
  reportHeld: async () => {},
};

export const windowConnection = createWindowConnectionStore({
  listInstances: () => bridge.listInstances(),
  startup: () => bridge.startup(),
  connect: (instance) => bridge.connect(instance),
  start: (instance, project) => bridge.start(instance, project),
  disconnect: () => bridge.disconnect(),
  marasi: () => bridge.marasi(),
  chooseMarasi: (bundled) => bridge.chooseMarasi(bundled),
  useConnection,
});

/** The app's connected windows, one connection each (createWindowListStore.js). */
export const windowList = createWindowListStore({
  windows: () => bridge.windows(),
  focusWindow: (id) => bridge.focusWindow(id),
  newWindow: () => bridge.newWindow(),
  onWindowsChanged: (listener) => bridge.onWindowsChanged(listener),
  reportProject: (project) => bridge.reportProject(project),
  reportHeld: (count) => bridge.reportHeld(count),
});

/** A project picked in an OS dialog, for Start: its path, or null. */
export const pickProject = () => bridge.pickProject();

/**
 * The window's title for open project `project`: the project and the
 * instance it is open on, so the researcher knows where actions go.
 */
export function windowTitle(project) {
  const instance = get(windowConnection).connection?.instance;
  return instance ? `${project} — ${instance}` : project;
}
