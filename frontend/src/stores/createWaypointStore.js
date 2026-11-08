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
  // Bumped by clear, so a load a project switch superseded drops its answer.
  let run = 0;

  return {
    subscribe,
    clear: () => {
      run++;
      set({});
    },
    async load() {
      const thisRun = run;
      const list = await client.get("/waypoint");
      if (thisRun === run) apply(list);
    },

    // Adds the waypoint, or updates the one the service already has for
    // `hostname` (it refuses to add that one twice). Both requests go
    // through one binding, so a switch before the refusal lands updates
    // nothing on the next connection.
    async save(hostname, override) {
      const link = client.bind?.() ?? client;
      const waypoint = { hostname, override };
      try {
        apply(await link.post("/waypoint", waypoint));
      } catch (err) {
        if (err?.code !== "waypoint_already_exists") throw err;
        apply(await link.post("/waypoint/update", waypoint));
      }
    },
    remove: async (hostname) => apply(await client.del("/waypoint", { hostname })),

    onChanged: apply,
  };
}
