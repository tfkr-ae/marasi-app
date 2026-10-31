// The app config calls the renderer may make, each on its own IPC channel
// `appConfig:<call>`. A handler resolves { value } or { error: message }, so
// the renderer shows the refusal itself rather than Electron's wrapped
// "Error invoking remote method" text.

const configCalls = [
  "marasiConfig",
  "setFlag",
  "toggleFlag",
  "keybindings",
  "saveKeybindings",
  "highlights",
  "saveHighlights",
  "resetHighlights",
  "appSavedQueries",
  "saveAppSavedQueries",
  "setHiddenBuiltinQueries",
  "defaultContentTypeExclusion",
  "setDefaultContentTypeExclusion",
];
const fileCalls = ["exportProfile", "importProfile"];

export const appConfigCalls = [...configCalls, ...fileCalls];

export function handleAppConfig(ipcMain, { appConfig, keybindingFiles }) {
  for (const name of appConfigCalls) {
    const target = fileCalls.includes(name) ? keybindingFiles : appConfig;
    ipcMain.handle(`appConfig:${name}`, async (_event, ...args) => {
      try {
        return { value: await target[name](...args) };
      } catch (error) {
        return { error: error?.message ?? String(error) };
      }
    });
  }
}
