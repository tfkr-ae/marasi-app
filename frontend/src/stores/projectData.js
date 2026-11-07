// The stores that hold the service's project data, each registered once from
// its own `xStore.js`, so adding a store touches no shared list:
//
//   projectData.register("home", {
//     signal: loadSignals.logs,  // the opening screen's part (optional)
//     clear: homeStore.clear,    // forget the last project (optional)
//     load: homeStore.populate,  // read everything afresh
//     resync: homeStore.resync,  // optional; defaults to load
//   });
//
// load() runs after a switch, or a reconnect that found another project or a
// restarted service: every store clears, then loads; the pages remount.
// resync() runs after a reconnect to the same project: every store reloads
// server data in place and keeps what only the app holds (drafts,
// selection, scroll, an open drawer); nothing clears, nothing remounts.
// A store that holds nothing local can leave resync out.

export function createProjectData() {
  const entries = new Map();

  return {
    /** Registers the store `name`, replacing one registered before. */
    register(name, { signal = null, clear = () => {}, load, resync = load }) {
      entries.set(name, { name, signal, clear, load, resync });
    },

    /** Clears every store, as when leaving a connection. */
    clear() {
      for (const entry of entries.values()) entry.clear();
    },

    /** Clears every store, then loads each; `part(signal)` before each. */
    async load(part = () => {}) {
      for (const entry of entries.values()) entry.clear();
      for (const entry of entries.values()) {
        if (entry.signal) part(entry.signal);
        await entry.load();
      }
    },

    /**
     * Runs every store's resync at once. Resolves, once all have settled, to
     * the failures, `[{name, error}]`; each is logged, and the rest carry on.
     */
    async resync() {
      const list = [...entries.values()];
      const results = await Promise.allSettled(list.map((entry) => entry.resync()));
      const failures = [];
      results.forEach((result, i) => {
        if (result.status === "fulfilled") return;
        console.error(`Resyncing ${list[i].name} failed:`, result.reason);
        failures.push({ name: list[i].name, error: result.reason });
      });
      return failures;
    },
  };
}

/** The app's registry. projectStore.js's loadProject and resyncProject run it. */
export const projectData = createProjectData();
