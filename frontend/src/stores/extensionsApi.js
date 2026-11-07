// The extensions' api over the service client: each call reads a control
// API route and maps its snake_case answer to the shape the extension pages
// read (PascalCase, as the old bindings gave). The service has no lookup by
// name, so callers pass the extension's id; createExtensionsStore finds it
// in the list.

/** An extension summary, from GET /extension or extension.* events. */
export function toExtension(ext) {
  return {
    ID: ext.id,
    Name: ext.name,
    Enabled: ext.enabled,
    Author: ext.author ?? "",
    Description: ext.description ?? "",
    SourceURL: ext.source_url ?? "",
    UpdatedAt: ext.updated_at ?? "",
  };
}

/** An extension log line, from GET /extension/{id}/logs or extension.log. */
export function toExtensionLog(log) {
  return { Time: log.time, Text: log.text };
}

const path = (id, rest = "") => `/extension/${encodeURIComponent(id)}${rest}`;

export function createExtensionsApi(client) {
  return {
    async list() {
      const list = await client.get("/extension");
      return (list.items ?? []).map(toExtension);
    },
    // The summary with its Lua, settings and web component (`ui_code` and
    // `version`, "" when the extension sets none).
    async detail(id) {
      const ext = await client.get(path(id));
      return {
        ...toExtension(ext),
        LuaContent: ext.lua_content ?? "",
        Settings: ext.settings ?? {},
        UICode: ext.ui_code ?? "",
        Version: ext.version ?? "",
      };
    },
    // What the extension last drew: `{renders: {target: schema}, state}`.
    async ui(id) {
      const ui = await client.get(path(id, "/ui"));
      return { renders: ui.renders ?? {}, state: ui.state ?? {} };
    },
    async logs(id) {
      const logs = await client.get(path(id, "/logs"));
      return (logs.items ?? []).map(toExtensionLog);
    },
    // Calls the extension's Lua function `fn` with `args`.
    async call(id, fn, args = []) {
      await client.post(path(id, "/call"), { function: fn, args });
    },
    // Runs `code` as the extension's Lua and stores it when the run succeeds.
    async run(id, code) {
      const ext = await client.post(path(id), { lua_content: code });
      return { ...toExtension(ext), LuaContent: ext.lua_content ?? code, Settings: ext.settings ?? {} };
    },
    async setEnabled(id, enabled) {
      return toExtension(await client.post(path(id, "/enable"), { enabled }));
    },
    async saveSettings(id, settings) {
      const saved = await client.post(path(id, "/settings"), { settings });
      return saved.settings ?? {};
    },
  };
}
