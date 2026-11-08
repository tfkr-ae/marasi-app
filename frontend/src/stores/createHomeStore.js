// Home's data: the dashboard counts, the scope's rule counts, the proxy
// listener's status and the service's log. It reads through the injected
// `api` (homeApi.js over the service client; tests pass a fake client):
//
//   dashboard() -> {requests, notes, launchpads, intercepted, interceptedComplete}
//   scope() -> {defaultAllow, includeCount, excludeCount}
//   logs() -> [log], oldest first, in the log table's fields (toLog)
//   extensionNames() -> {id: name}
//   listener() -> {status, address, port}
//   setListener(address, port, active) -> {status, address, port}
//
// homeStore.js routes the stream's events, as the service sends them, to
// onLog, onListener, onJobComplete, onRequest, onResponse and
// onCountsChanged.
// A part that fails to read stays null (or as it was) and the rest load.
import { get, writable } from "svelte/store";
import { toListener, toLog, toScope } from "./homeApi.js";
import { codeIDs } from "../lib/errorCodes.js";

/**
 * How long Home waits after a change to what the dashboard counts (captured
 * traffic, interceptions, notes, launchpads, deleted pairs) before reading
 * the counts again. The first change starts the wait and later ones don't
 * restart it, so a steady stream reads once per window, not never.
 */
export const DASHBOARD_SETTLE_MS = 500;

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

  let countsTimer = null;
  let counting = Promise.resolve();

  // Reads the counts once the settle window that the first change since
  // the last read started has passed. Later changes join that window.
  function countsChanged() {
    if (countsTimer !== null) return;
    countsTimer = setTimeout(() => {
      countsTimer = null;
      counting = readDashboard();
    }, DASHBOARD_SETTLE_MS);
  }

  return {
    subscribe: store.subscribe,
    populate,
    resync: populate,
    /** A scope.updated event: the scope list, as GET /scope answers it. */
    onScope(scope) {
      store.update((s) => ({ ...s, scope: toScope(scope) }));
    },
    /** Another client changed what the dashboard counts; reads it once the window settles. */
    onCountsChanged: countsChanged,
    /** A traffic.request event: a captured request adds to Requests. */
    onRequest: countsChanged,
    /**
     * A traffic.response event: only one whose metadata marks it
     * intercepted, the flag the Intercepted count follows, changes a count.
     */
    onResponse(event) {
      if (event?.metadata?.intercepted === true) countsChanged();
    },
    /** Waits for a dashboard read onCountsChanged started. */
    settled: () => counting,
    /** Reads the counts and scope again, as Home does each time it shows. */
    async refreshDashboard() {
      const run = generation;
      await Promise.all([readDashboard(run), read("scope", run, api.scope)]);
    },
    clear() {
      clearTimeout(countsTimer);
      countsTimer = null;
      generation++;
      store.set(empty());
    },
    /** A log.added event. */
    onLog(event) {
      const log = toLog(event);
      store.update((s) => (s.logs.some((l) => l.ID === log.ID) ? s : { ...s, logs: [...s.logs, log] }));
    },
    /**
     * Starts the proxy listener on `address:port`, or moves it there, and
     * resolves to the listener the service reports. With `fallback` (the
     * port is the app's default), a start refused because the port is
     * taken starts on a free port instead, as the app starts its instance.
     * A refusal rejects and leaves the listener as it was.
     */
    async setListener(address, port, { fallback = false } = {}) {
      const active = get(store).listener.status;
      let next;
      try {
        next = await api.setListener(address, port, active);
      } catch (err) {
        if (!fallback || active || codeIDs(err, "listener_unavailable") === null) throw err;
        next = await api.setListener(address, 0, false);
      }
      store.update((s) => ({ ...s, listener: next }));
      return next;
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
