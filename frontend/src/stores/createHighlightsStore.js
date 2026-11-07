// The highlight palette's state: the app's colours and labels (the app
// config YAML), the open project's labels (client settings
// `ledger.highlight.<n>`, docs/adr/2026-10-16-app-defaults-with-project-overrides.md),
// and renaming a label. Backend calls go through the injected `api`
// (highlightsApi.js), so tests run against a fake:
//
//   getHighlights() / saveHighlights(list) / resetHighlights()   app highlights
//   listClientSettings(prefix)                                    project settings
//   setClientSetting(key, value) / deleteClientSetting(key)
import { derived, get, writable } from "svelte/store";
import { DEFAULT_HIGHLIGHTS, effectivePalette } from "../lib/ledger/highlights.js";
import { boundAction } from "../lib/service/boundAction.js";

/** The project setting that holds highlight `number`'s label. */
export const projectLabelKey = (number) => `ledger.highlight.${number}`;
const LABEL_PREFIX = "ledger.highlight.";

// Reads ledger.highlight.<n> settings into { n: label }.
function labelsFrom(settings) {
  const labels = {};
  for (const setting of settings ?? []) {
    const number = Number(setting.key.slice(LABEL_PREFIX.length));
    if (Number.isInteger(number) && number >= 1 && number <= 8 && typeof setting.value === "string") {
      labels[number] = setting.value;
    }
  }
  return labels;
}

export function createHighlightsStore(api) {
  /** The app config's 8 highlights ({ color, label }); null until loaded. */
  const appHighlights = writable(null);
  /** The open project's labels by number ({ 3: "IDOR candidate" }). */
  const projectLabels = writable({});
  /** The effective palette; see effectivePalette. */
  const palette = derived([appHighlights, projectLabels], ([$app, $project]) =>
    effectivePalette($app, $project),
  );

  let app = null;
  appHighlights.subscribe((value) => (app = value));
  let labels = {};
  projectLabels.subscribe((value) => (labels = value));
  // Increases on every load and clear, so late results for an earlier
  // project are dropped.
  let generation = 0;

  async function readApp() {
    try {
      appHighlights.set(await api.getHighlights());
    } catch (error) {
      console.error("reading highlights, using defaults:", error);
    }
  }

  // Settings writes are optimistic: `store` takes `value` at once, then
  // `write` runs. A failed write puts the old value back and rejects, so
  // the caller can say so. Resolves to what `write` resolves to.
  // The project's labels stay as a load or clear since left them: they are
  // the next project's.
  async function optimistic(store, value, write) {
    const before = get(store);
    const at = generation;
    store.set(value);
    try {
      return await write();
    } catch (error) {
      if (store !== projectLabels || at === generation) store.set(before);
      throw error;
    }
  }

  /** Saves all 8 app highlights; resolves to the saved list or rejects. */
  async function save(highlights) {
    const saved = await optimistic(appHighlights, highlights, () => api.saveHighlights(highlights));
    appHighlights.set(saved);
    return saved;
  }

  /** Puts the app highlights back to the defaults. */
  async function reset() {
    const defaults = DEFAULT_HIGHLIGHTS.map(({ color }) => ({ color, label: "" }));
    const saved = await optimistic(appHighlights, defaults, () => api.resetHighlights());
    appHighlights.set(saved);
    return saved;
  }

  const withoutLabel = (number) => {
    const { [number]: _, ...rest } = labels;
    return rest;
  };

  /**
   * Renames highlight `number`. For this project, the label is the project's
   * own (blank drops it, so the app label shows). For all projects, it
   * becomes the app label and the project's own is dropped.
   */
  async function rename(number, label, { allProjects = false } = {}) {
    const text = String(label ?? "").trim();
    const key = projectLabelKey(number);
    if (allProjects) {
      const next = DEFAULT_HIGHLIGHTS.map((fallback, i) => ({
        color: app?.[i]?.color || fallback.color,
        label: app?.[i]?.label ?? "",
      }));
      next[number - 1] = { ...next[number - 1], label: text };
      if (!(number in labels)) return save(next).then(() => {});
      // The project's own label goes with the app label, so the new one
      // shows: on the connection the rename began on (boundAction.js).
      const action = boundAction(api.bind?.());
      await optimistic(projectLabels, withoutLabel(number), async () => {
        await save(next);
        await action.step(() => api.deleteClientSetting(key));
      });
      return;
    }
    if (text) {
      await optimistic(projectLabels, { ...labels, [number]: text }, () => api.setClientSetting(key, text));
    } else {
      await optimistic(projectLabels, withoutLabel(number), () => api.deleteClientSetting(key));
    }
  }

  async function loadProject() {
    const loading = ++generation;
    try {
      const settings = await api.listClientSettings(LABEL_PREFIX);
      if (loading === generation) projectLabels.set(labelsFrom(settings));
    } catch (error) {
      console.error("Reading the project's highlight labels failed:", error);
    }
  }

  const store = {
    appHighlights,
    projectLabels,
    palette,
    readApp,
    save,
    reset,
    rename,

    /** Loads the open project's labels. */
    loadProject,
    /** Reads the project's labels again; another client may have renamed one. */
    resync: loadProject,
    /** Forgets the last project's labels. */
    clear() {
      generation++;
      projectLabels.set({});
    },
  };
  return store;
}
