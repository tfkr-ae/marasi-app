// Stop and Start for a local connection that isn't the active one, in its
// details (ConnectionDetail). The active connection's Stop and Start go
// through the connection store; this one never touches it, so Start
// doesn't switch the active connection. It works through the injected
// `api`, bound to one connection (manage.js's localInstanceControl):
//
//   running() -> bool | null   whether its instance runs; null when the
//                              app can't say
//   owns() -> bool             whether the app owns the run (Go's OwnsRun)
//   stop()                     stop the instance (Go's StopLocalInstance)
//   start()                    start it, the app owning the run (Go's
//                              StartLocalInstance)
//
// Stop asks first for a run the app doesn't own, as the active one does.
import { get, writable } from "svelte/store";

const idle = () => ({ running: null, owned: false, stopAsk: false, busy: null, error: "" });

const message = (err) => String(err?.message ?? err);

export function createInstanceControl(api) {
  const store = writable(idle());
  let reads = 0;

  /** Reads whether the instance runs and whether the app owns it. */
  async function refresh() {
    const read = ++reads;
    const [running, owned] = await Promise.all([
      Promise.resolve()
        .then(api.running)
        .catch(() => null),
      Promise.resolve()
        .then(api.owns)
        .then(Boolean)
        .catch(() => false),
    ]);
    if (read === reads) store.update((s) => ({ ...s, running, owned }));
  }

  async function run(busy, call) {
    store.update((s) => ({ ...s, busy, stopAsk: false, error: "" }));
    let error = "";
    try {
      await call();
    } catch (err) {
      error = message(err);
    }
    await refresh();
    store.update((s) => ({ ...s, busy: null, error }));
  }

  return {
    subscribe: store.subscribe,
    refresh,
    /** Stops the instance, or asks first when the app doesn't own the run. */
    stop() {
      const s = get(store);
      if (s.busy) return Promise.resolve();
      if (!s.owned) {
        store.update((state) => ({ ...state, stopAsk: true, error: "" }));
        return Promise.resolve();
      }
      return run("stop", api.stop);
    },
    /** The answer to Stop's question. */
    confirmStop() {
      if (get(store).busy) return Promise.resolve();
      return run("stop", api.stop);
    },
    cancelStop() {
      store.update((s) => ({ ...s, stopAsk: false }));
    },
    /** Starts the instance; the active connection stays as it is. */
    start() {
      if (get(store).busy) return Promise.resolve();
      return run("start", api.start);
    },
  };
}
