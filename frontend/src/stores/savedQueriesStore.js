// The app's saved queries over the service client: app-wide ones stay in
// the app config (Go bindings), the project's own are client settings on
// the service. The logic lives in createSavedQueriesStore.js, which tests
// load with a fake API.
import { derived } from "svelte/store";
import {
  GetAppSavedQueries,
  SaveAppSavedQueries,
  SetHiddenBuiltinQueries,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createSavedQueriesStore, visibleSavedQueries } from "./createSavedQueriesStore.js";
import { createSavedQueriesApi } from "./savedQueriesApi.js";
import { contentTypeExclusion } from "./ledgerStore";
import { projectData } from "./projectData.js";
import { followCountChanges } from "./countChanges.js";

export {
  activeSavedQuery,
  canSaveQuery,
  hiddenBuiltinCount,
  savedQueryGroups,
  visibleSavedQueries,
} from "./createSavedQueriesStore.js";

export const savedQueriesStore = createSavedQueriesStore(
  createSavedQueriesApi(service, {
    appConfig: {
      getAppSavedQueries: () => GetAppSavedQueries(),
      saveAppSavedQueries: (list) => SaveAppSavedQueries(list),
      setHiddenBuiltins: (ids) => SetHiddenBuiltinQueries(ids),
    },
    exclusion: contentTypeExclusion,
  }),
);

// The project's saved queries belong to the project open; a resync reads
// them again, since another client may have saved one. Match counts start
// soon after a load or resync, and again after new traffic or another
// client's change (countChanges.js), so the menu usually opens with its
// numbers; a switch forgets the last project's.
projectData.register("savedQueries", {
  clear: savedQueriesStore.clearCounts,
  load: async () => {
    await savedQueriesStore.load();
    savedQueriesStore.scheduleCounts();
  },
  resync: async () => {
    await savedQueriesStore.loadProject();
    savedQueriesStore.scheduleCounts();
  },
});
followCountChanges(service, savedQueriesStore.scheduleCounts);

/** The visible saved queries as the query box's ready-made suggestions ({ label, query }). */
export const readyMadeQueries = derived(savedQueriesStore, (state) =>
  visibleSavedQueries(state).map((q) => ({ label: q.name, query: q.query })),
);
