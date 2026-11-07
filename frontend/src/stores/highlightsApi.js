// The highlights' api: the app's 8 colours and labels stay in the app config
// (Go bindings, passed in as `appConfig`); the project's labels are client
// settings on the service.
import { createClientSettings } from "./clientSettingsApi.js";

export function createHighlightsApi(client, appConfig) {
  const settings = createClientSettings(client);
  return {
    /** The client bound to its connection now, for a multi-step action (boundAction.js). */
    bind: () => client.bind?.(),
    getHighlights: () => appConfig.getHighlights(),
    saveHighlights: (list) => appConfig.saveHighlights(list),
    resetHighlights: () => appConfig.resetHighlights(),
    listClientSettings: (prefix) => settings.list(prefix),
    setClientSetting: (key, value) => settings.set(key, value),
    deleteClientSetting: (key) => settings.delete(key),
  };
}
