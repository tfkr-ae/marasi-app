// The extensions of the service's project: the list, what each extension's
// GUI drew (renders by target, and its state), its logs, calls from its UI,
// enable and settings, and Workshop's code. `api` is createExtensionsApi's
// shape, so tests pass a fake.
//
// `list`, `ui` and `workshop` are the writables the pages read (stores.js
// `extensions`, `extensions_ui` and `workshopCode`): list items are
// `{ID, Name, Enabled, …, UICode, Version}` (the web component, "" when
// none; extension.updated rereads it), and `ui[name]` is
// `{<target>: schema, state: {key: value}}`. `toast(schema)` shows a toast
// an extension rendered. `editors` maps an extension's name to the writable
// its code editor reads (Compass's rules); `workshop` is Workshop's.
import { get, writable } from "svelte/store";
import { toExtension, toExtensionLog } from "./extensionsApi.js";
import { boundAction } from "../lib/service/boundAction.js";

export const WORKSHOP = "workshop";

// The list item: the summary with the web component from its detail.
// A summary with what its detail adds: the web component and the settings.
const withWebComponent = (ext, { UICode, Version, Settings = {} }) => ({ ...ext, UICode, Version, Settings });

export function createExtensionsStore(
  api,
  { list = writable([]), ui = writable({}), workshop = writable(""), editors = {}, toast = () => {} } = {},
) {
  const codeEditors = { ...editors, [WORKSHOP]: workshop };
  // The keys of each extension's state the researcher changed and the
  // extension hasn't been sent yet: name -> Set of keys. A resync keeps them.
  const edited = new Map();
  // Log watchers: name -> Set of {lines, listener}.
  const logWatchers = new Map();

  async function readExtension(ext) {
    const [detail, drawn] = await Promise.all([api.detail(ext.ID), ext.Enabled ? api.ui(ext.ID) : null]);
    return { ext: withWebComponent(ext, detail), detail, drawn };
  }

  // The researcher's unsent edits over the extension's drawing.
  function drawing(name, { renders, state }) {
    const kept = {};
    const local = get(ui)[name]?.state ?? {};
    for (const key of edited.get(name) ?? []) if (key in local) kept[key] = local[key];
    return { ...renders, state: { ...state, ...kept } };
  }

  async function read() {
    const read = await Promise.all((await api.list()).map(readExtension));
    list.set(read.map((r) => r.ext));
    ui.set(Object.fromEntries(read.filter((r) => r.drawn).map((r) => [r.ext.Name, drawing(r.ext.Name, r.drawn)])));
    return read;
  }

  /** Reads every extension afresh, and the editors' stored code. */
  async function populate() {
    edited.clear();
    const read_ = await read();
    for (const [name, editor] of Object.entries(codeEditors)) {
      editor.set(read_.find((r) => r.ext.Name === name)?.detail.LuaContent ?? "");
    }
  }

  /**
   * Reads every extension again in place after a stream reset, keeping the
   * editors' code and the UI inputs not yet sent.
   */
  async function resync() {
    await read();
  }

  function clear() {
    edited.clear();
    list.set([]);
    ui.set({});
    for (const editor of Object.values(codeEditors)) editor.set("");
  }

  // The extension called `name`: from the list, or (before the first load)
  // the service's list, since it has no lookup by name.
  async function byName(name) {
    const known = get(list).find((ext) => ext.Name === name);
    if (known) return known;
    const found = (await api.list()).find((ext) => ext.Name === name);
    if (!found) throw new Error(`Extension ${name} not found`);
    return found;
  }

  const stateOf = (name) => get(ui)[name]?.state ?? {};

  // Finds the extension, then writes to it: one action on the connection it
  // began on (boundAction.js), so a switch on the way stops the write.
  // Resolves to what `write(ext)` resolves to.
  async function writeTo(name, write) {
    const action = boundAction(api.bind?.());
    const ext = await action.step(() => byName(name));
    return action.step(() => write(ext));
  }

  /**
   * Calls `fn` on the extension with its UI state, as its buttons and menu
   * items do. Rejects with the service's refusal (lua_error,
   * function_not_found).
   */
  async function call(name, fn) {
    await writeTo(name, (ext) => api.call(ext.ID, fn, [stateOf(name)]));
    edited.delete(name);
  }

  /**
   * Sends the extension's UI state to its `sync` function, when it holds
   * any, as leaving its page does. An extension without one ignores it.
   */
  async function sync(name) {
    const state = stateOf(name);
    if (Object.keys(state).length === 0) return;
    try {
      await writeTo(name, (ext) => api.call(ext.ID, "sync", [state]));
      edited.delete(name);
    } catch (err) {
      if (err?.code !== "function_not_found") throw err;
    }
  }

  function setState(name, key, value) {
    ui.update((all) => {
      const ext = all[name] ?? { state: {} };
      return { ...all, [name]: { ...ext, state: { ...ext.state, [key]: value } } };
    });
  }

  /** A UI input changing the bound `key` of the extension's state. */
  function edit(name, key, value) {
    if (!edited.has(name)) edited.set(name, new Set());
    edited.get(name).add(key);
    setState(name, key, value);
  }

  /** extension.gui.rendered: a toast, or the schema drawn at its target. */
  function onRendered({ name, target, schema }) {
    if (target === "toast") {
      toast(schema ?? {});
      return;
    }
    ui.update((all) => {
      const ext = all[name] ?? { state: {} };
      return { ...all, [name]: { ...ext, [target]: schema } };
    });
  }

  /** extension.gui.updated: the extension set `key` of its state. */
  function onUpdated({ name, key, value }) {
    edited.get(name)?.delete(key);
    setState(name, key, value);
  }

  function forgetDrawing(name) {
    edited.delete(name);
    ui.update((all) => {
      const { [name]: _, ...rest } = all;
      return rest;
    });
  }

  // Puts the summary `ext` in the list, drawing the extension when it is
  // enabled and wasn't drawn, and forgetting its drawing when disabled.
  async function changed(ext) {
    const before = get(list).find((e) => e.ID === ext.ID);
    const next = withWebComponent(ext, await api.detail(ext.ID));
    list.update((all) => (before ? all.map((e) => (e.ID === ext.ID ? next : e)) : [...all, next]));
    if (!ext.Enabled) forgetDrawing(ext.Name);
    else if (!get(ui)[ext.Name]) {
      const drawn = await api.ui(ext.ID);
      ui.update((all) => ({ ...all, [ext.Name]: drawing(ext.Name, drawn) }));
    }
  }

  /** extension.enabled and extension.updated: the extension's summary. */
  const onChanged = (summary) => changed(toExtension(summary));

  async function setEnabled(name, enabled) {
    await changed(await writeTo(name, (ext) => api.setEnabled(ext.ID, enabled)));
  }

  // Puts an extension's stored settings in its list entry.
  function setSettings(id, settings) {
    list.update((all) => all.map((e) => (e.ID === id ? { ...e, Settings: settings ?? {} } : e)));
  }

  /** Saves the extension's settings; resolves to them as stored. */
  async function saveSettings(name, settings) {
    let id;
    const saved = await writeTo(name, (ext) => api.saveSettings((id = ext.ID), settings));
    setSettings(id, saved);
    return saved;
  }

  /** extension.settings.updated: { id, name, settings }, as stored. */
  const onSettings = ({ id, settings }) => setSettings(id, settings);

  /** The extension's stored Lua (Checkpoint's rules read theirs). */
  async function code(name) {
    const ext = await byName(name);
    return (await api.detail(ext.ID)).LuaContent;
  }

  /**
   * Runs `code` as the extension's Lua (Workshop's Run and Update,
   * Compass's Update); the
   * service stores it only when the run succeeds. Rejects with its
   * lua_error.
   */
  async function run(name, code) {
    await writeTo(name, (ext) => api.run(ext.ID, code));
  }

  /**
   * Hands `listener` the extension's log lines, `[{Time, Text}]`: its stored
   * lines, then again as each extension.log arrives. Resolves to the
   * function that stops it.
   */
  async function watchLogs(name, listener) {
    const watcher = { lines: [], listener };
    if (!logWatchers.has(name)) logWatchers.set(name, new Set());
    logWatchers.get(name).add(watcher);
    const stop = () => logWatchers.get(name)?.delete(watcher);
    let stored;
    try {
      stored = await api.logs((await byName(name)).ID);
    } catch (err) {
      stop();
      throw err;
    }
    // Lines that arrived while the stored ones were read follow them.
    watcher.lines = [...stored, ...watcher.lines];
    listener(watcher.lines);
    return stop;
  }

  /** extension.log: one line an extension printed. */
  function onLog(log) {
    for (const watcher of logWatchers.get(log.name) ?? []) {
      watcher.lines = [...watcher.lines, toExtensionLog(log)];
      watcher.listener(watcher.lines);
    }
  }

  return {
    subscribe: list.subscribe,
    populate,
    resync,
    clear,
    call,
    sync,
    edit,
    code,
    run,
    setEnabled,
    saveSettings,
    watchLogs,
    onRendered,
    onUpdated,
    onChanged,
    onSettings,
    onLog,
  };
}
