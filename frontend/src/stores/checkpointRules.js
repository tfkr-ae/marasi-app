// Checkpoint's interception rules: the `checkpoint` extension's Lua.
// `code` is the rules in the editor, `applied` the rules Checkpoint runs
// (stores.js's checkpointCode and checkpointCodeApplied). `api` is
// { read(), run(code) }; checkpointStore.js binds it to extensionsStore,
// which finds the extension by name and runs Lua through the service.
import { get } from "svelte/store";

export const RULES_EXTENSION = "checkpoint";

export function createCheckpointRules(api, { code, applied }) {
  return {
    /** Reads the rules into the editor. */
    async load() {
      const lua = await api.read();
      code.set(lua);
      applied.set(lua);
    },
    /** Reads the rules again, keeping an edit the researcher hasn't applied. */
    async resync() {
      const lua = await api.read();
      if (get(code) === get(applied)) code.set(lua);
      applied.set(lua);
    },
    /**
     * Runs `lua` as the rules; the service stores them only once they ran.
     * Rejects, leaving the applied rules, when they fail.
     */
    async apply(lua) {
      await api.run(lua);
      applied.set(lua);
    },
  };
}
