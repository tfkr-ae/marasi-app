// Whether Intercept all is on. stores.js re-exports it; it lives here so the
// Checkpoint store can share it without importing stores.js, which imports
// the Checkpoint store.
import { writable } from "svelte/store";

export const interceptFlag = writable(false);
