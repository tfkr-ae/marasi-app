// The instance's log store, wired to the ported GetLogs binding
// (createLogStore.js has the logic).
import { createLogStore } from "./createLogStore.js";
import { GetLogs } from "../lib/bindings/App";

export const logStore = createLogStore({ getLogs: GetLogs });
