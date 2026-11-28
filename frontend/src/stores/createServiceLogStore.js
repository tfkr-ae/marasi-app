// The Service log drawer's data: the service's own messages, oldest first,
// and the extensions' names its lines carry. It reads through the injected
// `api` (serviceLogApi.js over the service client; tests pass a fake client):
//
//   logs() -> [log], oldest first, in toLog's fields
//   extensionNames() -> {id: name}
//   pairNumber(id) -> the pair's number, or null when it's gone
//
// serviceLogStore.js routes log.added to onLog. A part that fails to read
// stays as it was and the other loads.
import { writable } from "svelte/store";
import { toLog } from "./serviceLogApi.js";

const empty = () => ({ logs: [], extensionNames: {} });

export function createServiceLogStore(api) {
  const store = writable(empty());
  // Each populate counts; an older one's answers, or a cleared one's, are dropped.
  let generation = 0;

  async function read(part, run, load) {
    try {
      const value = await load();
      if (run === generation) store.update((s) => ({ ...s, [part]: value }));
    } catch (err) {
      console.error(`Reading the Service log's ${part} failed:`, err);
    }
  }

  /** Reads the log and the extensions' names. Also the store's resync. */
  async function populate() {
    const run = ++generation;
    await Promise.all([read("logs", run, api.logs), read("extensionNames", run, api.extensionNames)]);
  }

  return {
    subscribe: store.subscribe,
    populate,
    resync: populate,
    clear() {
      generation++;
      store.set(empty());
    },
    /** A log.added event. */
    onLog(event) {
      const log = toLog(event);
      store.update((s) => (s.logs.some((l) => l.ID === log.ID) ? s : { ...s, logs: [...s.logs, log] }));
    },
    /** The number of the pair `id`, or null when the project no longer holds it. */
    pairNumber: (id) => api.pairNumber(id).catch(() => null),
  };
}
