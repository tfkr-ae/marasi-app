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
 * The window's connection store. `api` is `{listInstances, connect,
 * current, useConnection}`: the main process bridge's calls, and the client
 * module's useConnection(baseURL), which points the client at the instance
 * and returns it.
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

  /** Connects the window to local `instance`. Resolves to the connection, or null. */
  async function connect(instance) {
    store.update((s) => ({ ...s, connecting: instance, connectError: null }));
    try {
      return await use(await api.connect(instance));
    } catch (error) {
      store.update((s) => ({ ...s, connecting: null, connectError: reason(error) }));
      return null;
    }
  }

  /** Takes up the connection the window already has, as after a reload, or null. */
  async function resume() {
    const current = await api.current();
    if (!current) return null;
    try {
      return await use(current);
    } catch (error) {
      store.update((s) => ({ ...s, connectError: reason(error) }));
      return null;
    }
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

  return { subscribe: store.subscribe, listInstances, connect, resume, connected };
}
