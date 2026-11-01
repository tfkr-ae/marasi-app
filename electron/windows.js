// The app's windows, for the Window menu, the ⌘K window list and the dock
// badge (docs/adr/2026-10-31-one-connection-per-window.md). Each renderer
// reports the project it has open, its Checkpoint's held count and its
// unsaved Launchpad drafts; the instance comes from the window's connection.

/**
 * The windows' list and held items. `connectionOf(id)` is a window's
 * connection ({instance}), or null for none. Windows are keyed by their
 * webContents id.
 */
export function createWindowList({ connectionOf }) {
  // Each open window's {project, held, drafts}, in the order the windows opened.
  const windows = new Map();
  const blank = () => ({ project: null, held: 0, drafts: 0 });
  const count = (n) => Math.max(0, Number(n) || 0);
  const sum = (key) => [...windows.values()].reduce((total, window) => total + window[key], 0);

  /**
   * The connected windows: {id, instance, project, label, current}, the
   * label naming the instance and the project once one is open, and
   * `current` marking window `currentId`.
   */
  function list(currentId) {
    return [...windows].flatMap(([id, { project }]) => {
      const connection = connectionOf(id);
      if (!connection) return [];
      const { instance } = connection;
      const label = project ? `${instance} — ${project}` : instance;
      return [{ id, instance, project, label, current: id === currentId }];
    });
  }

  /** The held items of every window, for the dock badge. */
  const held = () => sum("held");

  /** The dirty Launchpad drafts of window `id`, or of every window. */
  const drafts = (id) => (id === undefined ? sum("drafts") : (windows.get(id)?.drafts ?? 0));

  const report = (id, change) => {
    if (windows.has(id)) windows.set(id, { ...windows.get(id), ...change });
  };

  return {
    list,
    held,
    drafts,
    opened: (id) => windows.set(id, blank()),
    closed: (id) => windows.delete(id),
    /** A window that disconnected has no project and holds nothing. */
    disconnected: (id) => report(id, blank()),
    /** A reloaded window starts again with nothing held and no drafts, until it reports. */
    reloaded: (id) => report(id, { held: 0, drafts: 0 }),
    setProject: (id, project) => report(id, { project: project || null }),
    setHeld: (id, n) => report(id, { held: count(n) }),
    setDrafts: (id, n) => report(id, { drafts: count(n) }),
  };
}
