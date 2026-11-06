// The project store's api over the service client (see
// docs/agents/maps/marasi-service.md, "Adding a store to the service
// client"). `confirmSwitch` (the native unsaved-work prompt) and
// `loadProject` (the app's full project load) come from the app.
const projectEvents = [
  "project.opening",
  "project.upgrading",
  "project.waiting",
  "project.opened",
  "project.opening_failed",
];

export function createProjectApi(client, { confirmSwitch, loadProject }) {
  return {
    /** The ids of the items Checkpoint holds; the service would wait for them. */
    heldCheckpointIDs: async () => ((await client.get("/checkpoint")).items ?? []).map((item) => item.id),
    confirmSwitch,
    /** Opens `{name}` or `{path}` on the service; resolves to its canonical path. */
    open: async (target) => (await client.post("/project/open", target)).project,
    /** The service's named projects, `[{name, path, modifiedAt}]`, most recent first. */
    async listProjects() {
      const items = (await client.get("/project/list")).items ?? [];
      return items
        .map(({ name, project, modified_at }) => ({ name, path: project, modifiedAt: modified_at }))
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
    },
    loadProject,
    /** Calls `handler(name, data)` for each project.* event; returns the unsubscribe. */
    onProjectEvent(handler) {
      const stops = projectEvents.map((name) => client.on(name, (data) => handler(name, data)));
      return () => stops.forEach((stop) => stop());
    },
  };
}

/**
 * The open the project picker's `r` asks for: a path (it names a directory)
 * opens by path, with ".marasi" added when missing, and anything else by
 * name in the service's projects.
 */
export function projectTarget(r) {
  const text = String(r).trim();
  if (!/[\\/]/.test(text)) return { name: text.replace(/\.marasi$/, "") };
  return { path: text.endsWith(".marasi") ? text : text + ".marasi" };
}
