// The app's connected windows, one connection each, for the ⌘K window
// switcher (docs/adr/2026-10-31-one-connection-per-window.md). The main
// process keeps the list and draws the Window menu and the dock badge from
// what each window reports: its open project and its held count.
import { writable } from "svelte/store";

/**
 * The window list store: [{id, instance, project, label, current}],
 * `current` marking this window. `api` is the main process bridge's
 * `{windows, focusWindow, newWindow, onWindowsChanged, reportProject,
 * reportHeld}`.
 */
export function createWindowListStore(api) {
  const store = writable([]);
  const refresh = () => api.windows().then(store.set);

  /** Follows the list from now on; returns the call that stops. */
  function follow() {
    const stop = api.onWindowsChanged(refresh);
    refresh();
    return stop;
  }

  /** Brings `window` (a list item) to the front, unless it is this one. */
  async function switchTo(window) {
    if (!window.current) await api.focusWindow(window.id);
  }

  // The last values reported, so an unchanged one isn't sent again.
  let held = 0;
  let project = null;

  /** Reports this window's Checkpoint held count, for the dock badge. */
  function reportHeld(count) {
    if (count === held) return;
    held = count;
    api.reportHeld(count);
  }

  /** Reports this window's open project, for the window list. */
  function reportProject(name) {
    if (name === project) return;
    project = name;
    api.reportProject(name);
  }

  return {
    subscribe: store.subscribe,
    follow,
    switchTo,
    newWindow: () => api.newWindow(),
    reportHeld,
    reportProject,
  };
}
