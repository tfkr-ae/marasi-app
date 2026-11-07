// The app's waypoints over the service client (createWaypointStore.js),
// loaded with the project and kept current by the stream's waypoint events.
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createWaypointStore } from "./createWaypointStore.js";
import { projectData } from "./projectData.js";

/** Settings' waypoints: host → override, plus load, save and remove. */
export const waypoints = createWaypointStore(service);

projectData.register("waypoints", {
  signal: loadSignals.waypoints,
  clear: waypoints.clear,
  load: waypoints.load,
});

for (const name of ["waypoint.added", "waypoint.updated", "waypoint.removed"]) {
  service.on(name, waypoints.onChanged);
}
