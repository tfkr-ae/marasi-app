// The project's extensions on the connected instance: v1's extension
// bindings, which name an extension, and the calls v2 adds, which take
// Marasi's extension id. Marasi's routes take the id only, so a name is
// resolved through the list.
import { marasi } from "./marasi.js";

/** A GET /extension summary as v1's extension. */
export const extensionSummary = (extension) => ({
  ID: extension.id,
  Name: extension.name,
  Enabled: extension.enabled,
  Author: extension.author,
  Description: extension.description,
  SourceURL: extension.source_url,
  UpdatedAt: extension.updated_at,
});

const listExtensions = async () => (await marasi.get("/extension")).items ?? [];

// The id of the extension called `name`, rejecting as v1 did when the
// project has none.
async function extensionID(name) {
  const extension = (await listExtensions()).find((item) => item.name === name);
  if (!extension) throw new Error(`extension ${name} not found`);
  return extension.id;
}

/** The project's extensions, in v1's shape. */
export const GetExtensions = async () => (await listExtensions()).map(extensionSummary);

/** The Lua code of the extension called `name`. */
export const GetExtensionCode = async (name) =>
  (await marasi.get(`/extension/${await extensionID(name)}`)).lua_content;

/**
 * Saves `code` as the extension's code and runs it. Marasi refuses code
 * that fails with lua_error, without Lua's message.
 */
export const RunExtension = async (name, code) => {
  await marasi.post(`/extension/${await extensionID(name)}`, { lua_content: code });
};

/** Runs `code` on the Workshop. As in v1, a failure is only logged. */
export const DoExtender = (code) =>
  RunExtension("workshop", code).catch((error) => console.error("Running the Workshop failed:", error));

/** The lines the extension printed that Marasi still holds, in v1's shape. */
export const GetExtensionLogs = async (name) => {
  const { items } = await marasi.get(`/extension/${await extensionID(name)}/logs`);
  return (items ?? []).map((line) => ({ Time: line.time, Text: line.text }));
};

/**
 * v1 set its Wails listeners for extension calls here. v2's calls are
 * plain routes (callExtension), so there is nothing to set up.
 */
export const LoadExtensions = async () => {};

/**
 * v1 read the extension's Lua globals `ui_code` and `version`. Marasi has no
 * route for them and v1 drew no UI from them, so this answers v1's empty UI.
 */
export const GetExtensionUI = async () => ({ UICode: "", Version: "" });

/** v1 read an extension's Lua global flag. No v1 page asked, and Marasi has no route. */
export const GetExtensionFlag = async () => false;

/** Turns the extension `id` on or off; resolves to its summary in v1's shape. */
export const setExtensionEnabled = async (id, enabled) =>
  extensionSummary(await marasi.post(`/extension/${id}/enable`, { enabled }));

/** The extension `id`'s settings object. */
export const getExtensionSettings = async (id) => (await marasi.get(`/extension/${id}/settings`)).settings ?? {};

/** Replaces the extension `id`'s settings; resolves to them as saved. */
export const saveExtensionSettings = async (id, settings) =>
  (await marasi.post(`/extension/${id}/settings`, { settings })).settings ?? {};

/**
 * Calls the Lua function `fn` of the extension `id` with `args`, as v1's
 * extension_call_function and extension_sync_state did. Marasi refuses a
 * function the extension doesn't define with function_not_found.
 */
export const callExtension = (id, fn, args = []) => marasi.post(`/extension/${id}/call`, { function: fn, args });
