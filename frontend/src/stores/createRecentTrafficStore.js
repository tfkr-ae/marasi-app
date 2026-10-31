// The project's newest pairs, oldest first, for the extension web
// components that take an `items` list. It holds at most `limit` pairs, never
// the whole project. Backend calls go through the injected `api`.
import { writable } from "svelte/store";

/** How many of the newest pairs the store holds. */
export const RECENT_TRAFFIC_LIMIT = 1000;

/** How often buffered request and response events reach the list. */
export const RECENT_TRAFFIC_FLUSH_MS = 200;

export function createRecentTrafficStore(api, limit = RECENT_TRAFFIC_LIMIT) {
  const { subscribe, set, update } = writable([]);
  let version = 0;
  // Events wait here until the next flush, so a burst updates the list once.
  let requests = [];
  let responses = new Map();

  return {
    subscribe,
    /** Loads the newest pairs of every content type. */
    async populate() {
      const loading = version;
      try {
        const page = await api.queryTraffic({
          Query: "",
          OrderBy: "requested_at desc",
          Limit: limit,
          IgnoreExclusion: true,
        });
        if (loading === version) set([...(page.Items ?? [])].reverse());
      } catch (err) {
        console.error("Loading recent traffic failed:", err);
      }
    },
    /** Reads the newest pairs again, after the event stream reopens. */
    reload() {
      return this.populate();
    },
    clear() {
      version++;
      requests = [];
      responses = new Map();
      set([]);
    },
    onRequest(req) {
      requests.push(req);
    },
    onResponse(res) {
      responses.set(res.ID, res);
    },
    /** Moves buffered events into the list. */
    flush() {
      if (requests.length === 0 && responses.size === 0) return;
      const arrived = requests;
      const answered = responses;
      requests = [];
      responses = new Map();
      update((items) => {
        const next = [...items, ...arrived].map((item) =>
          answered.has(item.ID) ? { ...item, ...answered.get(item.ID) } : item,
        );
        return next.length > limit ? next.slice(next.length - limit) : next;
      });
    },
  };
}
