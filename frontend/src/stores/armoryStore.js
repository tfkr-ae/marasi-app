// The app's Armory store, bound to the Wails backend. The logic lives in
// createArmoryStore.js, which tests load with a fake API.
import * as App from "../lib/wailsjs/go/main/App";
import { createArmoryStore } from "./createArmoryStore.js";

export { drawerShareOf } from "./createArmoryStore.js";

export const armoryStore = createArmoryStore(App);
