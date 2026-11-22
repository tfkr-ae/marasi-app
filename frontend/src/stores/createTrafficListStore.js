// The Insert panel's Traffic tab: the newest pairs that match a Marasi
// query, kept live while the panel is shown. A store of
// { query, pairs, loading, error }; `error` is the query's own message when
// Marasi refuses it, or the app's words when the read fails.
//
// `createTrafficListStore(api)` takes createToolTrafficApi's api; the app's
// instance, its events and its projectData entry are in trafficListStore.js.
import { get, writable } from "svelte/store";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";

export const READ_FAILED = "Couldn't read traffic";

export function createTrafficListStore(api, { settleMs = 300, maxWaitMs = 1000 } = {}) {
  const store = writable({ query: "", pairs: [], loading: false, error: "" });
  let users = 0;
  let timer = null;
  let deadline = 0;
  // Bumped by every read and by clear(), so only the newest read writes.
  let generation = 0;

  async function load() {
    if (!users) return;
    const mine = ++generation;
    const action = boundAction(api.bind?.());
    const { query } = get(store);
    store.update((state) => ({ ...state, loading: true }));
    let page;
    try {
      page = await action.step(() => api.readList(query));
    } catch (err) {
      if (isSuperseded(err) || mine !== generation) return;
      console.error("reading the Insert panel's traffic:", err);
      store.update((state) => ({ ...state, loading: false, error: READ_FAILED }));
      return;
    }
    if (mine !== generation) return;
    if (page.QueryError) {
      store.update((state) => ({ ...state, pairs: [], loading: false, error: page.QueryError.Message }));
      return;
    }
    const pairs = [...page.Items].sort((a, b) => b.Number - a.Number);
    store.update((state) => ({ ...state, pairs, loading: false, error: "" }));
  }

  // Each call restarts the settle wait, but never past maxWaitMs from the
  // first call, so steady traffic still refreshes the list.
  const later = () => {
    const now = Date.now();
    if (!timer) deadline = now + maxWaitMs;
    clearTimeout(timer);
    timer = setTimeout(fire, Math.max(0, Math.min(settleMs, deadline - now)));
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  function fire() {
    timer = null;
    load();
  }

  return {
    subscribe: store.subscribe,
    setQuery(query) {
      store.update((state) => ({ ...state, query }));
      later();
    },
    /** Reads the list and keeps it live until the returned stop is called. */
    start() {
      users += 1;
      if (users === 1) load();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        users -= 1;
        if (users === 0) cancel();
      };
    },
    /** traffic.request, traffic.response and traffic.changed: read again while shown. */
    onTraffic() {
      if (users) later();
    },
    /** Forgets the last project's pairs; the query stays. */
    clear() {
      generation++;
      cancel();
      store.update((state) => ({ ...state, pairs: [], loading: false, error: "" }));
    },
    /** Reads the list afresh while it is shown. */
    load,
    resync: load,
  };
}
