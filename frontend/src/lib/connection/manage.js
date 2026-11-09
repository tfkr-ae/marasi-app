// Adding, editing and removing saved connections (Go's connections.go),
// then reloading the connection store's list.
import {
  AddConnection,
  AddLocalConnection,
  LocalInstances,
  OwnsRun,
  RemoveConnection,
  SetConnectionAddress,
  SetConnectionPort,
  StartLocalInstance,
  StopLocalInstance,
} from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
import { connectionStore } from "../../stores/connectionStore.js";
import { createInstanceControl } from "./instanceControl.js";

/** Saves a remote, `{name, url, password, noPassword}`; resolves to it. */
export async function addConnection(input) {
  const saved = await AddConnection(input);
  await connectionStore.load();
  return saved;
}

/** Saves a local connection, `{name, instance, port}`; resolves to it. */
export async function addLocalConnection(input) {
  const saved = await AddLocalConnection(input);
  await connectionStore.load();
  return saved;
}

/** Changes an added local connection's proxy port (0: any free port). */
export async function setPort(id, port) {
  await SetConnectionPort(id, port);
  await connectionStore.load();
}

/** The instances the Marasi CLI lists (`{instance, status, version, project, proxy_listener}`); [] when it can't say. */
export async function listInstances() {
  try {
    return (await LocalInstances()) ?? [];
  } catch {
    return [];
  }
}

/** Changes a remote's address; the active one is reached again there. */
export async function setAddress(id, url) {
  await SetConnectionAddress(id, url);
  await connectionStore.load();
}

/**
 * Forgets an added connection that isn't active, with its recents and a
 * remote's password or a local connection's owned run.
 */
export async function removeConnection(id) {
  await RemoveConnection(id);
  await connectionStore.load();
}

/**
 * Stop and Start for local connection `connection` while it isn't active
 * (instanceControl.js). It runs when the CLI lists its instance (Local's is
 * `default`); a start leaves the active connection as it is.
 */
export function localInstanceControl(connection) {
  const instance = connection.instance || "default";
  return createInstanceControl({
    running: async () => ((await LocalInstances()) ?? []).some((i) => i.instance === instance),
    owns: () => OwnsRun(connection.id),
    stop: () => StopLocalInstance(connection.id),
    start: () => StartLocalInstance(connection.id, ""),
  });
}

/** A Go error's text, for the inline error line. */
export const errorText = (err) => String(err?.message ?? err);
