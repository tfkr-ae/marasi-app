// Home's data: the dashboard counts, the scope's rule counts, the proxy
// listener's status and the service's log. It reads through the injected
// `api` (homeApi.js over the service client; tests pass a fake client):
//
//   dashboard() -> {requests, notes, launchpads, intercepted, interceptedComplete}
//   scope() -> {defaultAllow, includeCount, excludeCount}
//   logs() -> [log], oldest first, in the log table's fields (toLog)
//   extensionNames() -> {id: name}
//   listener() -> {status, address, port}
//
// homeStore.js routes the stream's events, as the service sends them, to
// onLog, onListener and onJobComplete.
// A part that fails to read stays null (or as it was) and the rest load.
import { get, writable } from "svelte/store";
import { toListener, toLog } from "./homeApi.js";

const empty = () => ({
  dashboard: null,
  scope: null,
  logs: [],
  extensionNames: {},
  listener: { status: false, address: "", port: "" },
  loading: false,
});

export function createHomeStore(api) {
  const store = writable(empty());
  // Each populate counts; an older one's answers are dropped.
  let generation = 0;

  async function read(part, run, load) {
    try {
      const value = await load();
      if (run === generation) store.update((s) => ({ ...s, [part]: value }));
    } catch (err) {
      console.error(`Reading Home's ${part} failed:`, err);
    }
  }

  async function readDashboard(run = generation) {
    await read("dashboard", run, api.dashboard);
  }

  /** Reads every part from the service. Also the store's resync. */
  async function populate() {
    const run = ++generation;
    store.update((s) => ({ ...s, loading: true }));
    await Promise.all([
      readDashboard(run),
      read("scope", run, api.scope),
      read("logs", run, api.logs),
      read("extensionNames", run, api.extensionNames),
      read("listener", run, api.listener),
    ]);
    if (run === generation) store.update((s) => ({ ...s, loading: false }));
  }

  return {
    subscribe: store.subscribe,
    populate,
    resync: populate,
    /** Reads the counts and scope again, as Home does each time it shows. */
    async refreshDashboard() {
      const run = generation;
      await Promise.all([readDashboard(run), read("scope", run, api.scope)]);
    },
    clear() {
      generation++;
      store.set(empty());
    },
    /** A log.added event. */
    onLog(event) {
      const log = toLog(event);
      store.update((s) => (s.logs.some((l) => l.ID === log.ID) ? s : { ...s, logs: [...s.logs, log] }));
    },
    /** A listener.started, .updated or .stopped event. */
    onListener(event) {
      store.update((s) => ({
        ...s,
        listener: toListener(event.status === "active" ? event.proxy_listener : null),
      }));
    },
    /** A job.complete event: the intercepted count's job ends its floor. */
    async onJobComplete(event) {
      if (event?.name !== "intercepted_count") return;
      if (get(store).dashboard?.interceptedComplete !== false) return;
      await readDashboard();
    },
  };
}
