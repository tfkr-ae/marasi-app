// Recent projects per connection: each project loaded joins the recents of
// the connection it loaded on (Go's AddRecentProject).
//
// The project store's `loadedProject` re-announces the loaded project on any
// project-store change, so a switch that has already made the next
// connection active announces the last one's project again. Only a project
// the store hasn't announced yet counts as loaded.

/**
 * Returns `announce(project)` for `loadedProject.subscribe`. `connectionId()`
 * is the active connection, `addRecent(id, name, path)` saves a recent, and
 * `onLoaded(path)` hears of each project loaded.
 */
export function trackRecents({ connectionId, addRecent, onLoaded }) {
  let last = null;
  let lastRecent = null;
  return function announce(project) {
    if (!project || project === last) return;
    last = project;
    onLoaded(project.path);
    const id = connectionId();
    if (lastRecent === `${id}\n${project.path}`) return;
    lastRecent = `${id}\n${project.path}`;
    addRecent(id, project.name, project.path);
  };
}
