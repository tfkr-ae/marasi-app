// The Insert panel's Traffic tab: the newest pairs that match a Marasi
// query, kept live while the panel is shown. A store of
// { query, pairs, loading, error }.
//
// `createTrafficList({ read(query) → { Items, QueryError }, on })`;
// `trafficList` (toolItems.js) binds it to the service client.
import { get, writable } from "svelte/store";

export const TRAFFIC_LIST_LIMIT = 100;

export function createTrafficList({ read, on, settleMs = 300 }) {
  const store = writable({ query: "", pairs: [], loading: false, error: "" });
  let users = 0;
  let unsubscribe = [];
  let timer = null;
  let generation = 0;

  async function load() {
    const mine = ++generation;
    const { query } = get(store);
    store.update((state) => ({ ...state, loading: true }));
    try {
      const page = await read(query);
      if (mine !== generation) return;
      if (page.QueryError) {
        store.update((state) => ({ ...state, pairs: [], loading: false, error: page.QueryError.Message }));
        return;
      }
      const pairs = [...page.Items].sort((a, b) => b.Number - a.Number);
      store.update((state) => ({ ...state, pairs, loading: false, error: "" }));
    } catch (err) {
      if (mine !== generation) return;
      store.update((state) => ({ ...state, loading: false, error: String(err?.message ?? err) }));
    }
  }

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(load, settleMs);
  };

  return {
    subscribe: store.subscribe,
    setQuery(query) {
      store.update((state) => ({ ...state, query }));
      later();
    },
    /** Reads the list and keeps it live until the returned stop is called. */
    start() {
      users += 1;
      if (users === 1) {
        load();
        unsubscribe = ["traffic.request", "traffic.response", "traffic.changed"].map((name) => on(name, later));
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        users -= 1;
        if (users === 0) {
          clearTimeout(timer);
          unsubscribe.forEach((stop) => stop?.());
          unsubscribe = [];
        }
      };
    },
  };
}
