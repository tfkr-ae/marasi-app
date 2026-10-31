// The connected instance's proxy listener, wired to the ported listener
// bindings (createListenerStore.js has the logic).
import { createListenerStore } from "./createListenerStore.js";
import { StartProxy, StopProxy, UpdateProxy } from "../lib/bindings/App";
import { marasi } from "../lib/bindings/marasi.js";

export const listenerStore = createListenerStore({
  status: () => marasi.get("/listener/status"),
  start: StartProxy,
  update: UpdateProxy,
  stop: StopProxy,
});
