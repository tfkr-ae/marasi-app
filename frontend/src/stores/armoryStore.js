// The app's Armory store, bound to the Wails backend. The logic lives in
// createArmoryStore.js, which tests load with a fake API.
import * as App from "../lib/wailsjs/go/main/App";
import { createArmoryStore } from "./createArmoryStore.js";

export { drawerShareOf } from "./createArmoryStore.js";

/** How often buffered request and response events reach the run's rows. */
const RUN_TRAFFIC_FLUSH_MS = 200;

export const armoryStore = createArmoryStore(App);
setInterval(armoryStore.runTraffic.flush, RUN_TRAFFIC_FLUSH_MS);
