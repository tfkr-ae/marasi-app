// Home's dashboard counts, wired to the ported CountNotes binding
// (createDashboardStore.js has the logic).
import { createDashboardStore } from "./createDashboardStore.js";
import { CountNotes } from "../lib/bindings/App";

export const dashboardStore = createDashboardStore({ countNotes: CountNotes });
