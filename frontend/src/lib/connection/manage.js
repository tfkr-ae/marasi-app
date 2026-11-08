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
} from "../bindings/github.com/tfkr-ae/marasi-app/app.js";
import { connectionStore } from "../../stores/connectionStore.js";

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

/** The instances the Marasi CLI lists; [] when it can't say. */
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
 * Whether the app owns a run on connection `id`, so Remove waits for a
 * stop; false when Go can't say (Go refuses the remove anyway).
 */
export async function ownsRun(id) {
  try {
    return Boolean(await OwnsRun(id));
  } catch {
    return false;
  }
}

/** A Go error's text, for the inline error line. */
export const errorText = (err) => String(err?.message ?? err);
