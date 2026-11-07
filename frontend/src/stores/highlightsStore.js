// The highlight palette over the service client: the app's colours and
// labels stay in the app config (Go bindings), the project's labels are
// client settings on the service. The logic lives in createHighlightsStore.js
// and lib/ledger/highlights.js, which tests load without bindings.
import {
  GetHighlights,
  ResetHighlights,
  SaveHighlights,
} from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { createHighlightsStore } from "./createHighlightsStore.js";
import { createHighlightsApi } from "./highlightsApi.js";
import { projectData } from "./projectData.js";

export const highlightsStore = createHighlightsStore(
  createHighlightsApi(service, {
    getHighlights: () => GetHighlights(),
    saveHighlights: (list) => SaveHighlights(list),
    resetHighlights: () => ResetHighlights(),
  }),
);

projectData.register("highlights", {
  clear: highlightsStore.clear,
  load: highlightsStore.loadProject,
  resync: highlightsStore.resync,
});

/** The app config's 8 highlights ({ color, label }); null until loaded. */
export const appHighlights = highlightsStore.appHighlights;
/** The open project's highlight labels by number ({ 3: "IDOR candidate" }). */
export const projectHighlightLabels = highlightsStore.projectLabels;
/** The effective palette; see effectivePalette. */
export const highlightPalette = highlightsStore.palette;

export const readHighlights = highlightsStore.readApp;
/** Saves all 8 app highlights; resolves to the saved list or rejects. */
export const saveHighlights = highlightsStore.save;
export const resetHighlights = highlightsStore.reset;
/** Renames highlight n: (n, label, { allProjects }). */
export const renameHighlight = highlightsStore.rename;
