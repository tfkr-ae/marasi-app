// The connected instance's proxy listener, which Home's listener button and
// the Setup Listener modal show: `{status, address, port}`, with status true
// while it listens. It reads GET /listener/status, changes through start,
// update and stop, and follows the listener.* events, so a change the CLI or
// another window makes shows up too. A stopped listener keeps the address it
// last had, for the modal to start it on again.
import { get, writable } from "svelte/store";

// "127.0.0.1:8080" or "[::1]:8080" as {address, port}.
function splitListener(listener) {
  const at = listener.lastIndexOf(":");
  return { address: listener.slice(0, at).replace(/^\[(.*)\]$/, "$1"), port: listener.slice(at + 1) };
}

/**
 * The listener store. `api` is `{status(), start(address, port),
 * update(address, port), stop()}`, each resolving Marasi's listener status,
 * `{status: "active"|"inactive", proxy_listener}`.
 */
export function createListenerStore(api) {
  const store = writable({ status: false, address: "127.0.0.1", port: "8080" });

  /** Shows a listener status, from an answer or a listener.* event. */
  function onListener(status) {
    store.update((state) => ({
      ...state,
      ...(status?.proxy_listener ? splitListener(status.proxy_listener) : {}),
      status: status?.status === "active",
    }));
  }

  async function reload() {
    onListener(await api.status());
  }

  /** Listens on `address`:`port`: starts the listener, or moves it if it runs. */
  async function setup(address, port) {
    const change = get(store).status ? api.update : api.start;
    onListener(await change(address, Number(port)));
  }

  async function stop() {
    onListener(await api.stop());
  }

  return { subscribe: store.subscribe, reload, onListener, setup, stop };
}
