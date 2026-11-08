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
// restarted service: every store clears, then every store loads at once;
// the pages remount.
// resync() runs when a reconnect to the same project can't replay the missed
// events (a stream reset; an ordinary drop resumes instead): every store reloads
// server data in place and keeps what only the app holds (drafts,
// selection, scroll, an open drawer); nothing clears, nothing remounts.
// A store that holds nothing local can leave resync out.

// `load()` as a promise, so a load that throws before its first await
// rejects like one that fails later.
function started(load) {
  try {
    return Promise.resolve(load());
  } catch (error) {
    return Promise.reject(error);
  }
}

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

    /**
     * Clears every store, then runs every store's load at once. The opening
     * screen's part is the earliest store still loading: `part(signal)` is
     * reported, in registration order, for each store once every store
     * before it has settled. Stops before the clear and before each store
     * starts once `live()` is false (a newer load superseded this one), and
     * then reports nothing more. One store's failure stops none of the
     * others: once all have settled, each failure is logged and the load
     * rejects with the first, in registration order (a superseded load
     * resolves instead).
     */
    async load(part = () => {}, live = () => true) {
      if (!live()) return;
      const list = [...entries.values()];
      for (const entry of list) entry.clear();
      const settled = list.map(() => false);
      let next = 0;
      // Moves the screen past every store that settled, up to the first
      // still loading, reporting each part on the way.
      const advance = () => {
        while (next < list.length && live()) {
          const entry = list[next];
          if (entry.signal) part(entry.signal);
          if (!settled[next]) return;
          next++;
        }
      };
      const loads = [];
      for (const [i, entry] of list.entries()) {
        if (!live()) return;
        const loading = started(entry.load);
        loads.push(loading);
        loading.finally(() => {
          settled[i] = true;
          if (i === next) {
            next++;
            advance();
          }
        }).catch(() => {});
      }
      advance();
      const results = await Promise.allSettled(loads);
      if (!live()) return;
      const failures = results.flatMap((result, i) => {
        if (result.status === "fulfilled") return [];
        console.error(`Loading ${list[i].name} failed:`, result.reason);
        return [result.reason];
      });
      if (failures.length) throw failures[0];
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
