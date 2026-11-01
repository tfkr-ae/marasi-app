// The app's scope store, bound to the connected instance. The logic lives
// in createScopeStore.js, which tests load with a fake API.
import { GetScopeRules } from "../lib/bindings/App.js";
import { createScopeStore } from "./createScopeStore.js";

export const scopeStore = createScopeStore({ getRules: () => GetScopeRules() });
