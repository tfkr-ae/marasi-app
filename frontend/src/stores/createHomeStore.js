// Home's data: the dashboard counts, the scope's rule counts, the pairs per
// status class and the proxy listener's status. It reads through the injected
// `api` (homeApi.js over the service client; tests pass a fake client):
//
//   dashboard() -> {requests, notes, launchpads, intercepted, interceptedComplete}
//   scope() -> {defaultAllow, includeCount, excludeCount}
//   statusClasses() -> {"2xx", "3xx", "4xx", "5xx"}: pairs per status class
//   listener() -> {status, address, port}
//   setListener(address, port, active) -> {status, address, port}
//   stopListener() -> {status, address, port}
//
// homeStore.js routes the stream's events, as the service sends them, to
// onListener, onJobComplete, onScope, onRequest, onResponse and
// onCountsChanged. The Service log keeps its own store (serviceLogStore.js).
// A part that fails to read stays null (or as it was) and the rest load,
// except the status classes, which count no responses in any class.
import { get, writable } from "svelte/store";
import { noStatusClasses, toListener, toScope } from "./homeApi.js";
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
  statusClasses: null,
  listener: { status: false, address: "", port: "" },
  lastListener: null,
  // The researcher stopped the listener (Home's Pending reads it); a start clears it.
  listenerStopped: false,
  listenerBusy: false,
  loading: false,
});

function withListener(state, next) {
  return {
    ...state,
    listener: next,
    lastListener: next.status ? { address: next.address, port: next.port } : state.lastListener,
    listenerStopped: next.status ? false : state.listenerStopped,
  };
}

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

  async function readListener(run) {
    try {
      const value = await api.listener();
      if (run === generation) store.update((s) => withListener(s, value));
    } catch (err) {
      console.error("Reading Home's listener failed:", err);
    }
  }

  // A failed read counts no responses in any class, never an error.
  async function readStatusClasses(run) {
    const value = await api.statusClasses().catch((err) => {
      console.error("Reading Home's status classes failed:", err);
      return noStatusClasses();
    });
    if (run === generation) store.update((s) => ({ ...s, statusClasses: value }));
  }

  // The counts `parts` names: "dashboard", "statusClasses" or both.
  const COUNTS = ["dashboard", "statusClasses"];
  async function readCounts(run, parts = COUNTS) {
    await Promise.all([
      parts.includes("dashboard") && read("dashboard", run, api.dashboard),
      parts.includes("statusClasses") && readStatusClasses(run),
    ]);
  }

  /** Reads every part from the service. Also the store's resync. */
  async function populate() {
    const run = ++generation;
    store.update((s) => ({ ...s, loading: true }));
    await Promise.all([
      readCounts(run),
      read("scope", run, api.scope),
      readListener(run),
    ]);
    if (run === generation) store.update((s) => ({ ...s, loading: false }));
  }

  let countsTimer = null;
  let counting = Promise.resolve();
  // The counts the pending window reads.
  let due = new Set();

  // Reads the counts `parts` names once the settle window that the first
  // change since the last read started has passed. Later changes join that
  // window. A response only changes the status classes, unless it was
  // intercepted.
  function countsChanged(parts = COUNTS) {
    for (const part of parts) due.add(part);
    if (countsTimer !== null) return;
    countsTimer = setTimeout(() => {
      countsTimer = null;
      const read = [...due];
      due = new Set();
      counting = readCounts(generation, read);
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
    onCountsChanged: () => countsChanged(),
    /** A traffic.request event: a captured request adds to Requests. */
    onRequest: () => countsChanged(),
    /**
     * A traffic.response event: its status code adds to a status class.
     * Only one whose metadata marks it intercepted, the flag the
     * Intercepted count follows, changes a dashboard count.
     */
    onResponse(event) {
      countsChanged(event?.metadata?.intercepted === true ? COUNTS : ["statusClasses"]);
    },
    /** Waits for a dashboard read onCountsChanged started. */
    settled: () => counting,
    /** Reads the counts and scope again, as Home does each time it shows. */
    async refreshDashboard() {
      const run = generation;
      await Promise.all([readCounts(run), read("scope", run, api.scope)]);
    },
    clear() {
      clearTimeout(countsTimer);
      countsTimer = null;
      due = new Set();
      generation++;
      store.set(empty());
    },
    /**
     * Starts the proxy listener on `address:port`, or moves it there, and
     * resolves to the listener the service reports. With `fallback` (the
     * port is the app's default), a start refused because the port is
     * taken starts on a free port instead, as the app starts its instance.
     * A refusal rejects and leaves the listener as it was.
     */
    async setListener(address, port, { fallback = false } = {}) {
      const run = generation;
      const active = get(store).listener.status;
      store.update((s) => ({ ...s, listenerBusy: true }));
      try {
        let next;
        try {
          next = await api.setListener(address, port, active);
        } catch (err) {
          if (!fallback || active || codeIDs(err, "listener_unavailable") === null) throw err;
          next = await api.setListener(address, 0, false);
        }
        if (run === generation) store.update((s) => withListener(s, next));
        return next;
      } finally {
        if (run === generation) store.update((s) => ({ ...s, listenerBusy: false }));
      }
    },
    /**
     * Stops the proxy listener on the service without stopping the service.
     * A refusal rejects and leaves the listener as it was.
     */
    async stopListener() {
      const run = generation;
      store.update((s) => ({ ...s, listenerBusy: true }));
      try {
        const next = await api.stopListener();
        if (run === generation) store.update((s) => ({ ...withListener(s, next), listenerStopped: !next.status }));
        return next;
      } finally {
        if (run === generation) store.update((s) => ({ ...s, listenerBusy: false }));
      }
    },
    /** A listener.started, .updated or .stopped event. */
    onListener(event) {
      store.update((s) => withListener(s, toListener(event.status === "active" ? event.proxy_listener : null)));
    },
    /** A job.complete event: the intercepted count's job ends its floor. */
    async onJobComplete(event) {
      if (event?.name !== "intercepted_count") return;
      if (get(store).dashboard?.interceptedComplete !== false) return;
      await readCounts(generation, ["dashboard"]);
    },
  };
}
