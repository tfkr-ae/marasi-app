// The project's extensions on the connected instance: the list, which
// follows Marasi's extension.enabled and extension.updated events, and the UI
// extensions draw with marasi.gui (extension.gui.rendered and .updated).
// Marasi doesn't replay what an extension drew, so a window shows only what
// was drawn while it followed the events.
// Backend calls go through the injected `api`, so tests run against a fake:
//
//   list() -> [extension]   (v1's shape: {ID, Name, Enabled, …})
//   setEnabled(id, enabled) -> extension
//   getSettings(id), saveSettings(id, settings) -> settings
//   call(id, fn, args)      POST /extension/{id}/call
//
// `list` and `ui` are the app's `extensions` and `extensions_ui` stores; ui
// is {[name]: {state, main?, panel?, icon?, menu?}}, by extension name as in
// v1. `settings` holds the settings read so far, by extension id.
import { get, writable } from "svelte/store";
import { extensionSummary } from "../lib/bindings/extensions.js";

// The toast variants an extension can ask for, as in v1.
const toastVariants = new Set(["primary", "secondary", "tertiary", "success", "warning", "error", "surface"]);

/** The toast a render to the "toast" target shows. */
export function extensionToast(schema = {}) {
  const variant = toastVariants.has(schema.variant) ? schema.variant : "primary";
  return { message: schema.message, background: `variant-filled-${variant}` };
}

export function createExtensionsStore(api) {
  const list = writable([]);
  const ui = writable({});
  const settings = writable({});
  const toastListeners = new Set();
  // The followers of each extension's log lines, by name.
  const logFollowers = new Map();

  // Puts the extension's summary in the list, in place or at the end.
  const putExtension = (extension) =>
    list.update((items) =>
      items.some((item) => item.ID === extension.ID)
        ? items.map((item) => (item.ID === extension.ID ? extension : item))
        : [...items, extension],
    );

  async function loadSettings(id) {
    const read = await api.getSettings(id);
    settings.update((all) => ({ ...all, [id]: read }));
    return read;
  }

  // The extension's UI, changed by `change`, a copy of its state.
  const changeUI = (name, change) =>
    ui.update((all) => {
      const current = all[name] ?? { state: {} };
      return { ...all, [name]: change({ ...current, state: { ...current.state } }) };
    });

  return {
    list,
    ui,
    settings,
    /** Reads the list, as after the event stream reopens or a project opens. */
    reload: async () => list.set(await api.list()),
    clear() {
      list.set([]);
      ui.set({});
      settings.set({});
    },
    /** extension.enabled and extension.updated: the extension's new summary. */
    onExtension: (payload) => putExtension(extensionSummary(payload)),
    /**
     * extension.settings.updated. Its payload doesn't name the extension, so
     * every extension's settings read so far are read again.
     */
    onSettingsUpdated: async () => {
      const ids = Object.keys(get(settings));
      await Promise.all(ids.map((id) => loadSettings(id)));
    },
    /** extension.log: a line the extension printed, to its followers. */
    onLog({ name, time, text }) {
      for (const follower of logFollowers.get(name) ?? []) follower({ Time: time, Text: text });
    },
    /** Calls `follower({Time, Text})` for each line extension `name` prints; returns a stop. */
    followLogs(name, follower) {
      if (!logFollowers.has(name)) logFollowers.set(name, new Set());
      logFollowers.get(name).add(follower);
      return () => logFollowers.get(name)?.delete(follower);
    },
    /** extension.gui.rendered: a toast, or the schema drawn on its target. */
    onRendered({ name, target, schema }) {
      if (target === "toast") {
        const toast = extensionToast(schema);
        for (const listener of toastListeners) listener(toast);
        return;
      }
      changeUI(name, (current) => ({ ...current, [target]: schema }));
    },
    /** extension.gui.updated: one key of the extension's UI state. */
    onUpdated({ name, key, value }) {
      changeUI(name, (current) => ({ ...current, state: { ...current.state, [key]: value } }));
    },
    /** Calls `listener({message, background})` for each toast; returns a stop. */
    onToast(listener) {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    /** Calls the extension's Lua function `fn` with `args`. */
    call: (id, fn, args) => api.call(id, fn, args),
    /** Turns the extension on or off. */
    setEnabled: async (id, enabled) => putExtension(await api.setEnabled(id, enabled)),
    loadSettings,
    /** Replaces the extension's settings. */
    async saveSettings(id, changed) {
      const saved = await api.saveSettings(id, changed);
      settings.update((all) => ({ ...all, [id]: saved }));
      return saved;
    },
  };
}
