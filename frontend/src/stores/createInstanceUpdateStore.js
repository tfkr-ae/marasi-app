// The connected instance's version and updates: what the connection status
// shows, and the instance update actions. They go through Marasi's /update
// routes and POST /service/restart, so they are separate from the app's own
// updater (updateStore.js), which the main process runs.
import { writable } from "svelte/store";
import { isNeedsNewerMarasi } from "../lib/bindings/marasi.js";

// What a refused call shows: Marasi's message, or its code.
const reason = (error) => error?.body?.message || error?.code || String(error);

/**
 * The instance update store. `api` is `{get, post, put, delete,
 * connection, runsBundled}`: the client module's methods on the window's
 * connection, the window's connection ({instance, remote}, or null), and
 * the main process's runsBundled(installPath), whether a build path is the
 * app's bundled Marasi.
 */
export function createInstanceUpdateStore(api) {
  const initial = {
    // The instance's version, from /service/status.
    version: null,
    // Whether an install replaced the build the instance runs.
    restartRequired: false,
    // Whether the update actions show: false for the bundled Marasi, which
    // updates with the app.
    canUpdate: false,
    // Whether the instance is a development build, which never checks or
    // installs.
    development: false,
    // The update Marasi found, {version, channel, published, notes, page},
    // or null.
    available: null,
    checking: false,
    // The instance's install, as GET /update's `install`: {state:
    // "idle"|"running"|"installed"|"failed", version?, step?, received?,
    // total?, error?}.
    install: { state: "idle" },
    // True from service.restarting, or a restart call, until the instance
    // is read again.
    restarting: false,
    // Why the last update action failed, or null.
    error: null,
  };
  const store = writable(initial);

  // The state from a GET /update body.
  const fromUpdate = (update) => ({
    development: Boolean(update.development),
    available: update.available ?? null,
    install: update.install ?? { state: "idle" },
    restartRequired: Boolean(update.restart_required),
  });

  /** Reads the connected instance's version and update state. */
  async function reload() {
    const connection = api.connection();
    if (!connection) {
      store.set(initial);
      return;
    }
    // An instance without the /update routes still shows its version.
    const [status, update] = await Promise.all([
      api.get("/service/status"),
      api.get("/update").catch((error) => {
        if (isNeedsNewerMarasi(error)) return null;
        throw error;
      }),
    ]);
    const bundled = !connection.remote && update && (await api.runsBundled(update.install_path));
    store.update((s) => ({
      ...s,
      ...(update ? fromUpdate(update) : {}),
      version: status.version,
      restartRequired: Boolean(status.restart_required || update?.restart_required),
      canUpdate: Boolean(update) && !bundled,
      restarting: false,
    }));
  }

  /** Asks Marasi to check for an update now. */
  async function check() {
    store.update((s) => ({ ...s, checking: true, error: null }));
    try {
      const update = await api.post("/update/check");
      store.update((s) => ({ ...s, ...fromUpdate(update), checking: false }));
    } catch (error) {
      store.update((s) => ({ ...s, checking: false, error: reason(error) }));
    }
  }

  /** update.available: Marasi found an update. */
  function onAvailable({ version, channel, published, notes, page }) {
    store.update((s) => ({ ...s, available: { version, channel, published, notes, page } }));
  }

  /** Installs the available update; the update.* events follow it. */
  async function install() {
    store.update((s) => ({ ...s, error: null }));
    try {
      const { install } = await api.post("/update/install");
      store.update((s) => ({ ...s, install }));
    } catch (error) {
      store.update((s) => ({ ...s, error: reason(error) }));
    }
  }

  /** Cancels the running install. */
  async function cancel() {
    try {
      const { install } = await api.delete("/update/install");
      store.update((s) => ({ ...s, install }));
    } catch (error) {
      store.update((s) => ({ ...s, error: reason(error) }));
    }
  }

  /** update.progress: the install's step and bytes. */
  function onProgress({ version, step, received, total }) {
    store.update((s) => ({ ...s, install: { state: "running", version, step, received, total } }));
  }

  /** update.installed: the instance runs the old build until it restarts. */
  function onInstalled({ version }) {
    store.update((s) => ({ ...s, install: { ...s.install, state: "installed", version }, restartRequired: true }));
  }

  /** update.failed: the install ended with `message`. */
  function onFailed({ version, kind, step, message, page }) {
    store.update((s) => ({
      ...s,
      install: { state: "failed", version, step, error: { kind, step, message, page } },
      error: message,
    }));
  }

  /**
   * Restarts the instance into its installed build; `force` drops held
   * Checkpoint items. Resolves to {restarted}, or {held: [{id, type,
   * summary}]} when held items stopped it, so the caller can ask first.
   * The window reconnects to the successor on the same address.
   */
  async function restart({ force = false } = {}) {
    store.update((s) => ({ ...s, restarting: true, error: null }));
    try {
      await api.post("/service/restart", force ? { force: true } : undefined);
    } catch (error) {
      const held = error?.code === "checkpoint_items_held";
      store.update((s) => ({ ...s, restarting: false, error: held ? null : reason(error) }));
      return held ? { held: error.body.items ?? [] } : { restarted: false };
    }
    await reload().catch((error) => store.update((s) => ({ ...s, restarting: false, error: reason(error) })));
    return { restarted: true };
  }

  /** service.restarting: the instance is handing over to its successor. */
  function onRestarting() {
    store.update((s) => ({ ...s, restarting: true }));
  }

  /** service.restart_failed: the instance rolled back and keeps running. */
  function onRestartFailed({ error }) {
    store.update((s) => ({ ...s, restarting: false, error }));
  }

  return {
    subscribe: store.subscribe,
    reload,
    check,
    install,
    cancel,
    onAvailable,
    onProgress,
    onInstalled,
    onFailed,
    restart,
    onRestarting,
    onRestartFailed,
  };
}
