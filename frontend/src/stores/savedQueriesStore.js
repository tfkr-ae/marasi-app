// The app's saved queries, bound to the Wails backend. The logic lives in
// createSavedQueriesStore.js, which tests load with a fake API.
import { derived } from "svelte/store";
import {
  CountTraffic,
  DeleteClientSetting,
  GetAppSavedQueries,
  ListClientSettings,
  SaveAppSavedQueries,
  SetClientSetting,
  SetHiddenBuiltinQueries,
} from "../lib/wailsjs/go/main/App";
import { createSavedQueriesStore, visibleSavedQueries } from "./createSavedQueriesStore.js";

export {
  activeSavedQuery,
  canSaveQuery,
  hiddenBuiltinCount,
  savedQueryGroups,
  visibleSavedQueries,
} from "./createSavedQueriesStore.js";

export const savedQueriesStore = createSavedQueriesStore({
  getAppSavedQueries: () => GetAppSavedQueries(),
  saveAppSavedQueries: (list) => SaveAppSavedQueries(list),
  setHiddenBuiltins: (ids) => SetHiddenBuiltinQueries(ids),
  countMatches: (query) => CountTraffic(query, "", {}),
  listClientSettings: (prefix) => ListClientSettings(prefix),
  setClientSetting: (key, value) => SetClientSetting(key, value),
  deleteClientSetting: (key) => DeleteClientSetting(key),
});

/** The visible saved queries as the query box's ready-made suggestions ({ label, query }). */
export const readyMadeQueries = derived(savedQueriesStore, (state) =>
  visibleSavedQueries(state).map((q) => ({ label: q.name, query: q.query })),
);
