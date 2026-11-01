// The window's connection: the local service instances and saved remote
// ones it can connect to, and the one it is connected to. The main process finds the instances and
// keeps the control token; the renderer gets each connection's base URL and
// reaches the instance through the Marasi client module.
import { get, writable } from "svelte/store";

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
 * connect, start, disconnect, marasi, chooseMarasi, listRemotes,
 * connectRemote, connectSaved, forgetRemote, refusedRemote,
 * useConnection}`: the main process bridge's calls, and the client
 * module's useConnection(baseURL, {remote}), which points the client at the instance
 * and returns it. The remote calls resolve `{value}`, or `{error,
 * tokenRefused, remote}` where `remote` is the refusing remote's {name, url}.
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
    // {instance, baseURL, loopbackTurnedOn, remote, resumed, status}, or
    // null; `resumed` after a reload.
    connection: null,
    // The saved remote instances: [{name, url}].
    remotes: [],
    // The remote whose token was refused, {name, url}, while the screen
    // asks for the new one.
    tokenPrompt: null,
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
  async function use({ instance, baseURL, loopbackTurnedOn, remote = false, resumed = false }) {
    const status = await api.useConnection(baseURL, { remote }).get("/service/status");
    const connection = { instance, baseURL, loopbackTurnedOn, remote, resumed, status };
    store.update((s) => ({ ...s, connecting: null, connectError: null, tokenPrompt: null, connection }));
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

  async function listRemotes() {
    try {
      const remotes = await api.listRemotes();
      store.update((s) => ({ ...s, remotes }));
    } catch (error) {
      store.update((s) => ({ ...s, listError: reason(error) }));
    }
  }

  // Connects with a remote bridge call's answer. A refused token asks for
  // the new one for `remote` ({name, url}).
  async function connectRemoteWith(label, remote, call) {
    store.update((s) => ({ ...s, connecting: label, connectError: null }));
    try {
      const answer = await call();
      if (answer.error) {
        store.update((s) => ({
          ...s,
          connecting: null,
          connectError: answer.error,
          tokenPrompt: answer.tokenRefused ? (answer.remote ?? remote) : s.tokenPrompt,
        }));
        return null;
      }
      const connection = await use(answer.value);
      await listRemotes();
      return connection;
    } catch (error) {
      store.update((s) => ({ ...s, connecting: null, connectError: reason(error) }));
      return null;
    }
  }

  /**
   * Connects the window to the remote instance at `url` with `token`, and
   * saves it under `name` when `save` is set. Resolves to the connection, or
   * null.
   */
  function connectRemote({ url, token, name = "", save = false }) {
    const remote = { name: name || url, url };
    return connectRemoteWith(name || url, remote, () => api.connectRemote({ url, token, name, save }));
  }

  /** Connects the window to the saved remote at `url` with its saved token. */
  function connectSaved(url) {
    const remote = get(store).remotes.find((item) => item.url === url) ?? { name: url, url };
    return connectRemoteWith(remote.name, remote, () => api.connectSaved(url));
  }

  /** Removes the saved remote at `url`. */
  async function forgetRemote(url) {
    await api.forgetRemote(url);
    await listRemotes();
  }

  /**
   * The window's connection at launch: the default instance, started if it
   * isn't running, or the connection it had before a reload. Null after a
   * disconnect, or with the reason shown when the default can't start. A
   * window whose remote refused its token comes back without one, asking
   * for the new token.
   */
  async function startup() {
    try {
      const current = await api.startup();
      if (!current) {
        const refused = await api.refusedRemote();
        if (refused) {
          store.update((s) => ({
            ...s,
            tokenPrompt: refused,
            connectError: `${refused.name} changed its token: paste the new one`,
          }));
        }
        return null;
      }
      return await use(current);
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
    listRemotes,
    connectRemote,
    connectSaved,
    forgetRemote,
    connected,
  };
}
