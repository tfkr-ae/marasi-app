// The instance's log, which Home's log table shows: what GET /logs reads,
// oldest first, then each line log.added brings.
import { writable } from "svelte/store";

/**
 * The log store. `api` is `{getLogs(cursor)}`, one page of GET /logs:
 * `{items, next_cursor}`, newest first.
 */
export function createLogStore(api) {
  const store = writable({ items: [] });
  // Each reload's number, so an older one's answer is dropped.
  let reloads = 0;
  // The lines log.added brought while a reload read, which its answer
  // may not have.
  let arrived = null;

  function withLine(items, line) {
    return items.some((item) => item.id === line.id) ? items : [...items, line];
  }

  /** Reads the whole log again, and shows it in place of what was shown. */
  async function reload() {
    const reload = ++reloads;
    arrived = [];
    const pages = [];
    let cursor;
    try {
      do {
        const page = await api.getLogs(cursor);
        if (reload !== reloads) return;
        pages.push(...(page?.items ?? []));
        cursor = page?.next_cursor || "";
      } while (cursor);
      store.set({ items: arrived.reduce(withLine, pages.reverse()) });
    } finally {
      if (reload === reloads) arrived = null;
    }
  }

  /** Adds a log.added event's line. */
  function onLogAdded(line) {
    arrived?.push(line);
    store.update((state) => ({ ...state, items: withLine(state.items, line) }));
  }

  function clear() {
    reloads++;
    arrived = null;
    store.set({ items: [] });
  }

  return { subscribe: store.subscribe, reload, onLogAdded, clear };
}
