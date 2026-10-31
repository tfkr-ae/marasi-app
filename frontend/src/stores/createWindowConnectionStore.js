// The window's connection: the local service instances it can connect to,
// and the one it is connected to. The main process finds the instances and
// keeps the control token; the renderer gets each connection's base URL and
// reaches the instance through the Marasi client module.
import { writable } from "svelte/store";

// An error from the main process, without Electron's "Error invoking
// remote method '…': Error: " prefix.
const reason = (error) =>
  String(error?.message ?? error ?? "").replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");

/**
 * The name Start suggests for an instance on `project` (a path, or null
 * for the scratchpad): the project's file name, with `-2` and so on when an
 * instance in `taken` has it.
 */
export function instanceNameFor(project, taken) {
  const base = project ? project.split(/[\\/]/).pop().replace(/\.marasi$/i, "") : "scratchpad";
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The window's connection store. `api` is `{listInstances, startup,
 * connect, start, disconnect, marasi, chooseMarasi, useConnection}`: the
 * main process bridge's calls, and the client module's
 * useConnection(baseURL), which points the client at the instance and
 * returns it.
 */
export function createWindowConnectionStore(api) {
  const store = writable({
    // The running local instances, each its /service/status plus `healthy`.
    instances: [],
    listing: false,
    // The instance a connect is under way to.
    connecting: null,
    // Why the last listing failed, and why the last connect did.
    listError: null,
    connectError: null,
    // {instance, baseURL, loopbackTurnedOn, status}, or null.
    connection: null,
    // The Marasi Start runs: {path, bundled}, path null for the bundled one.
    marasi: null,
  });

  async function listInstances() {
    store.update((s) => ({ ...s, listing: true }));
    try {
      const items = (await api.listInstances()).map((item) => ({ ...item, healthy: item.status === "running" }));
      items.sort((a, b) => Number(b.healthy) - Number(a.healthy) || a.instance.localeCompare(b.instance));
      store.update((s) => ({ ...s, instances: items, listing: false, listError: null }));
    } catch (error) {
      store.update((s) => ({ ...s, instances: [], listing: false, listError: reason(error) }));
    }
  }

  // Reads the instance's status through the client module, and connects.
  async function use({ instance, baseURL, loopbackTurnedOn }) {
    const status = await api.useConnection(baseURL).get("/service/status");
    const connection = { instance, baseURL, loopbackTurnedOn, status };
    store.update((s) => ({ ...s, connecting: null, connectError: null, connection }));
    return connection;
  }

  // Connects to `instance` through `open`, the bridge call that connects
  // the window. Resolves to the connection, or null with the reason shown.
  async function connectWith(instance, open) {
    store.update((s) => ({ ...s, connecting: instance, connectError: null }));
    try {
      return await use(await open());
    } catch (error) {
      store.update((s) => ({ ...s, connecting: null, connectError: reason(error) }));
      return null;
    }
  }

  /** Connects the window to local `instance`. Resolves to the connection, or null. */
  const connect = (instance) => connectWith(instance, () => api.connect(instance));

  /**
   * Starts local `instance` on `project` (a path, or null for the
   * scratchpad) and connects to it. Resolves to the connection, or null.
   */
  const start = (instance, project) => connectWith(instance, () => api.start(instance, project));

  /**
   * The window's connection at launch: the default instance, started if it
   * isn't running, or the connection it had before a reload. Null after a
   * disconnect, or with the reason shown when the default can't start.
   */
  async function startup() {
    try {
      const current = await api.startup();
      return current && (await use(current));
    } catch (error) {
      store.update((s) => ({ ...s, connectError: reason(error) }));
      return null;
    }
  }

  /** Ends the window's connection, leaving its instance running. */
  async function disconnect() {
    await api.disconnect();
    store.update((s) => ({ ...s, connection: null }));
  }

  async function readMarasi() {
    const marasi = await api.marasi();
    store.update((s) => ({ ...s, marasi }));
  }

  /** Chooses the Marasi Start runs from a path, or the bundled one when `bundled`. */
  async function chooseMarasi(bundled = false) {
    const marasi = await api.chooseMarasi(bundled);
    store.update((s) => ({ ...s, marasi }));
  }

  /** Resolves to the window's connection once it has one. */
  function connected() {
    return new Promise((resolve) => {
      let done = false;
      let stop = null;
      stop = store.subscribe(({ connection }) => {
        if (!connection || done) return;
        done = true;
        resolve(connection);
        stop?.();
      });
      if (done) stop();
    });
  }

  return {
    subscribe: store.subscribe,
    listInstances,
    startup,
    connect,
    start,
    disconnect,
    readMarasi,
    chooseMarasi,
    connected,
  };
}
