// The updater calls the renderer may make, each on its own IPC channel
// `update:<call>`, and the events it sends every window on
// "update:event". As for the app config, a handler resolves { value } or
// { error: message }, so the renderer shows the refusal itself.

export const updateCalls = [
  "getUpdateState",
  "checkForUpdate",
  "installUpdate",
  "cancelUpdateDownload",
  "restartToUpdate",
  "reinstallLatestRelease",
  "dismissUpdate",
  "setUpdateChannel",
  "getUpdateSettings",
  "setAutomaticUpdateChecks",
];

export const updateEventChannel = "update:event";

export function handleUpdates(ipcMain, updater) {
  for (const name of updateCalls) {
    ipcMain.handle(`update:${name}`, async (_event, ...args) => {
      try {
        return { value: await updater[name](...args) };
      } catch (error) {
        return { error: error?.message ?? String(error) };
      }
    });
  }
}
