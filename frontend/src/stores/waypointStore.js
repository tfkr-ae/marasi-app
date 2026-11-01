// The open project's waypoints, wired to the waypoint bindings
// (createWaypointStore.js has the logic).
import { createWaypointStore } from "./createWaypointStore.js";
import { CreateWaypoint, DeleteWaypoint, GetWaypoints } from "../lib/bindings/App";

export const waypointStore = createWaypointStore({
  list: GetWaypoints,
  save: CreateWaypoint,
  remove: DeleteWaypoint,
});
