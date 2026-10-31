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
 * The window's connection store. `api` is `{listInstances, connect,
 * current, listRemotes, connectRemote, connectSaved, forgetRemote,
 * refusedRemote, useConnection}`: the main process bridge's calls, and the
 * client module's useConnection(baseURL), which points the client at the
 * instance and returns it. The remote calls resolve `{value}`, or `{error,
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
    // {instance, baseURL, loopbackTurnedOn, remote, status}, or null.
    connection: null,
    // The saved remote instances: [{name, url}].
    remotes: [],
    // The remote whose token was refused, {name, url}, while the screen
    // asks for the new one.
    tokenPrompt: null,
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
  async function use({ instance, baseURL, loopbackTurnedOn, remote = false }) {
    const status = await api.useConnection(baseURL).get("/service/status");
    const connection = { instance, baseURL, loopbackTurnedOn, remote, status };
    store.update((s) => ({ ...s, connecting: null, connectError: null, tokenPrompt: null, connection }));
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

  async function listRemotes() {
    try {
      const remotes = await api.listRemotes();
      store.update((s) => ({ ...s, remotes }));
    } catch (error) {
      store.update((s) => ({ ...s, listError: reason(error) }));
    }
  }

  // Connects with a remote call's answer; a refused token asks for the new
  // one for `remote` ({name, url}).
  async function connectWith(label, remote, call) {
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
    return connectWith(name || url, remote, () => api.connectRemote({ url, token, name, save }));
  }

  /** Connects the window to the saved remote at `url` with its saved token. */
  function connectSaved(url) {
    const remote = get(store).remotes.find((item) => item.url === url) ?? { name: url, url };
    return connectWith(remote.name, remote, () => api.connectSaved(url));
  }

  /** Removes the saved remote at `url`. */
  async function forgetRemote(url) {
    await api.forgetRemote(url);
    await listRemotes();
  }

  /** Stops asking for a refused remote's token. */
  function dismissTokenPrompt() {
    store.update((s) => ({ ...s, tokenPrompt: null, connectError: null }));
  }

  /**
   * Takes up the connection the window already has, as after a reload, or
   * null. A window whose remote refused its token comes back without one,
   * asking for the new token.
   */
  async function resume() {
    const current = await api.current();
    if (!current) {
      const refused = await api.refusedRemote?.();
      if (refused) {
        store.update((s) => ({
          ...s,
          tokenPrompt: refused,
          connectError: `${refused.name} changed its token: paste the new one`,
        }));
      }
      return null;
    }
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

  return {
    subscribe: store.subscribe,
    listInstances,
    connect,
    listRemotes,
    connectRemote,
    connectSaved,
    forgetRemote,
    dismissTokenPrompt,
    resume,
    connected,
  };
}
