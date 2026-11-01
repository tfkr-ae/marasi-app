// The app's extensions store, bound to the connected instance. The logic
// lives in createExtensionsStore.js, which tests load with a fake API.
import {
  GetExtensions,
  callExtension,
  getExtensionSettings,
  saveExtensionSettings,
  setExtensionEnabled,
} from "../lib/bindings/extensions.js";
import { createExtensionsStore } from "./createExtensionsStore.js";

export { parseSettings } from "./createExtensionsStore.js";

export const extensionsStore = createExtensionsStore({
  list: () => GetExtensions(),
  setEnabled: (id, enabled) => setExtensionEnabled(id, enabled),
  getSettings: (id) => getExtensionSettings(id),
  saveSettings: (id, settings) => saveExtensionSettings(id, settings),
  call: (id, fn, args) => callExtension(id, fn, args),
});
