// The saved queries' api: app-wide queries and hidden built-ins stay in the
// app config (Go bindings, passed in as `appConfig`); the project's own are
// client settings on the service. Match counts leave out the project's
// content-type exclusion, as the Ledger's do.
import { createClientSettings } from "./clientSettingsApi.js";
import { countTraffic } from "./trafficApi.js";

export function createSavedQueriesApi(client, { appConfig, exclusion }) {
  const settings = createClientSettings(client);
  return {
    getAppSavedQueries: () => appConfig.getAppSavedQueries(),
    saveAppSavedQueries: (list) => appConfig.saveAppSavedQueries(list),
    setHiddenBuiltins: (ids) => appConfig.setHiddenBuiltins(ids),
    countMatches: async (query) => countTraffic(client, { query }, await exclusion.effective()),
    listClientSettings: (prefix) => settings.list(prefix),
    setClientSetting: (key, value) => settings.set(key, value),
    deleteClientSetting: (key) => settings.delete(key),
  };
}
