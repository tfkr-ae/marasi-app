// The highlight palette bound to the Wails backend. The logic lives in
// createHighlightsStore.js and lib/ledger/highlights.js, which tests load
// without bindings.
import {
  DeleteClientSetting,
  GetClientSetting,
  GetHighlights,
  ListClientSettings,
  MigrateOldHighlights,
  ResetHighlights,
  SaveHighlights,
  SetClientSetting,
} from "../lib/wailsjs/go/main/App";
import { createHighlightsStore } from "./createHighlightsStore.js";

export const highlightsStore = createHighlightsStore({
  getHighlights: () => GetHighlights(),
  saveHighlights: (list) => SaveHighlights(list),
  resetHighlights: () => ResetHighlights(),
  listClientSettings: (prefix) => ListClientSettings(prefix),
  getClientSetting: (key) => GetClientSetting(key),
  setClientSetting: (key, value) => SetClientSetting(key, value),
  deleteClientSetting: (key) => DeleteClientSetting(key),
  migrateOldHighlights: () => MigrateOldHighlights(),
});

/** The app config's 8 highlights ({ color, label }); null until loaded. */
export const appHighlights = highlightsStore.appHighlights;
/** The open project's highlight labels by number ({ 3: "IDOR candidate" }). */
export const projectHighlightLabels = highlightsStore.projectLabels;
/** The effective palette; see effectivePalette. */
export const highlightPalette = highlightsStore.palette;
/** True while the open project's old highlights are being updated. */
export const highlightMigrating = highlightsStore.migrating;

export const readHighlights = highlightsStore.readApp;
/** Saves all 8 app highlights; resolves to the saved list or rejects. */
export const saveHighlights = highlightsStore.save;
export const resetHighlights = highlightsStore.reset;
/** Renames highlight n: (n, label, { allProjects }). */
export const renameHighlight = highlightsStore.rename;
