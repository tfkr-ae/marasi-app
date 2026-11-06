// The active connection's id ("local" or a saved remote's), which the
// connection store keeps current. Its own module so stores the connection
// store imports (projectStore.js) can read it without an import cycle.
import { writable } from "svelte/store";

export const activeConnectionId = writable("local");
