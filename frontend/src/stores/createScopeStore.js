// Compass's scope rules on the connected instance, in v1's shape:
// {loaded, defaultAllow, includeRules: [{pattern, matchType}], excludeRules}.
// Marasi announces no scope event; Compass's code holds the rules, so an
// extension.updated for compass reads them again.
// Backend calls go through the injected `api`, so tests run against a fake:
//
//   getRules() -> {defaultAllow, includeRules, excludeRules}   GET /scope
import { writable } from "svelte/store";

const empty = () => ({ loaded: false, defaultAllow: false, includeRules: [], excludeRules: [] });

export function createScopeStore(api) {
  const { subscribe, set } = writable(empty());
  // Bumped by clear, so a read begun before a project switch is dropped.
  let generation = 0;

  async function reload() {
    const run = generation;
    const rules = await api.getRules();
    if (run === generation) set({ loaded: true, ...rules });
  }

  return {
    subscribe,
    /** Reads the rules, as after the event stream reopens or a project opens. */
    reload,
    clear() {
      generation++;
      set(empty());
    },
    /** extension.updated: Compass's new code may change the rules. */
    onExtension: async (extension) => {
      if (extension?.name === "compass") await reload();
    },
  };
}
