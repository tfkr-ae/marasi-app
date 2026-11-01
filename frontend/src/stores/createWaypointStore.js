// The open project's waypoints, which Settings → Waypoints shows as v1's
// {hostname: override} map. The store reads the map after each change and
// follows the waypoint.* events, so a change the CLI or another window
// makes shows up too.
import { writable } from "svelte/store";

/**
 * The waypoint store. `api` is `{list(), save(host, override),
 * remove(host)}`: GetWaypoints, CreateWaypoint and DeleteWaypoint.
 */
export function createWaypointStore(api) {
  const store = writable({});

  async function reload() {
    store.set(await api.list());
  }

  return {
    subscribe: store.subscribe,
    reload,
    clear: () => store.set({}),
    /** Shows a waypoint.added/updated/removed event's list. */
    onWaypoints: ({ items = [] } = {}) =>
      store.set(Object.fromEntries(items.map((item) => [item.hostname, item.override]))),
    async save(host, override) {
      await api.save(host, override);
      await reload();
    },
    async remove(host) {
      await api.remove(host);
      await reload();
    },
  };
}
