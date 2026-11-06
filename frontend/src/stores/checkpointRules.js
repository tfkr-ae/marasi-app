// Checkpoint's interception rules: the `checkpoint` extension's Lua.
// `code` is the rules in the editor, `applied` the rules Checkpoint runs
// (stores.js's checkpointCode and checkpointCodeApplied).
import { get } from "svelte/store";

const RULES_EXTENSION = "checkpoint";

/** The rules' api over the service client: the extension, found by name. */
export function createRulesApi(client) {
  async function extensionId() {
    const { items = [] } = await client.get("/extension");
    const extension = items.find((item) => item.name === RULES_EXTENSION);
    if (!extension) throw new Error(`The ${RULES_EXTENSION} extension isn't installed.`);
    return extension.id;
  }
  return {
    read: async () => (await client.get(`/extension/${await extensionId()}`)).lua_content ?? "",
    // The service runs the code, and stores it only once it ran.
    run: async (code) => client.post(`/extension/${await extensionId()}`, { lua_content: code }),
  };
}

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
    /** Runs `lua` as the rules. Rejects, leaving the applied rules, when it fails. */
    async apply(lua) {
      await api.run(lua);
      applied.set(lua);
    },
  };
}
