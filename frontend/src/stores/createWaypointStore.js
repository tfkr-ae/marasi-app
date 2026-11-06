// Waypoints: the project's host → override map, as Settings shows it. The
// store calls the service's waypoint routes through the client it is given
// (the app's service client, or a fake in tests); it is small enough to be
// its own adapter. Every write answers with the whole list, which replaces
// the map, and so do the waypoint.* events other clients cause.
import { writable } from "svelte/store";

/** The service's `{items:[{hostname, override}]}` as a host → override map. */
export const toWaypointMap = (list) =>
  Object.fromEntries((list?.items ?? []).map((item) => [item.hostname, item.override]));

export function createWaypointStore(client) {
  const { subscribe, set } = writable({});
  const apply = (list) => set(toWaypointMap(list));

  return {
    subscribe,
    clear: () => set({}),
    load: async () => apply(await client.get("/waypoint")),

    // Adds the waypoint, or updates the one the service already has for
    // `hostname` (it refuses to add that one twice).
    async save(hostname, override) {
      const waypoint = { hostname, override };
      try {
        apply(await client.post("/waypoint", waypoint));
      } catch (err) {
        if (err?.code !== "waypoint_already_exists") throw err;
        apply(await client.post("/waypoint/update", waypoint));
      }
    },
    remove: async (hostname) => apply(await client.del("/waypoint", { hostname })),

    onChanged: apply,
  };
}
