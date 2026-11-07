// The project store's api over the service client (see
// docs/agents/maps/marasi-service.md, "Adding a store to the service
// client"). `confirmSwitch` (the native unsaved-work prompt) and
// `loadProject` (the app's full project load) come from the app, and
// `recentProjects` (the projects opened on the active connection, from app
// config) too.
const projectEvents = [
  "project.opening",
  "project.upgrading",
  "project.waiting",
  "project.opened",
  "project.opening_failed",
];

export function createProjectApi(client, { confirmSwitch, loadProject, recentProjects = async () => [] }) {
  return {
    /** The ids of the items Checkpoint holds; the service would wait for them. */
    heldCheckpointIDs: async () => ((await client.get("/checkpoint")).items ?? []).map((item) => item.id),
    confirmSwitch,
    /** Opens `{name}` or `{path}` on the service; resolves to its canonical path. */
    open: async (target) => (await client.post("/project/open", target)).project,
    /**
     * The projects to offer, `[{name, path, modifiedAt}]`: those opened on
     * this connection, latest first, then the service's other named
     * projects, most recent first.
     */
    async listProjects() {
      const [items, recents] = await Promise.all([
        client.get("/project/list").then((list) => list.items ?? []),
        recentProjects().catch((err) => {
          console.error("Reading recent projects failed:", err);
          return [];
        }),
      ]);
      const opened = (recents ?? []).map(({ name, path, opened }) => ({ name, path, modifiedAt: opened }));
      const known = new Set(opened.map((r) => r.path));
      const others = items
        .map(({ name, project, modified_at }) => ({ name, path: project, modifiedAt: modified_at }))
        .filter((p) => !known.has(p.path))
        .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
      return [...opened, ...others];
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
 * The open the project picker's `r` asks for. A listed project
 * (`{name, path}` from `listProjects`) opens its exact path. Typed text
 * naming a directory opens by path, with ".marasi" added when missing;
 * other typed text opens by name in the service's projects.
 */
export function projectTarget(r) {
  if (typeof r === "object" && r?.path) return { path: r.path };
  const text = String(r).trim();
  if (!/[\\/]/.test(text)) return { name: text.replace(/\.marasi$/, "") };
  return { path: text.endsWith(".marasi") ? text : text + ".marasi" };
}

/** The listed projects (`listProjects`) whose name or path holds `input`. */
export function projectMatches(projects, input) {
  const text = String(input).trim().toLowerCase();
  if (!text) return projects;
  return projects.filter((p) => p.name.toLowerCase().includes(text) || p.path.toLowerCase().includes(text));
}

/**
 * What the project picker opens: the listed project at `index` in
 * `matches`, else the first match, else the typed `input` (null when
 * blank). `projectTarget` turns it into the open.
 */
export function pickedProject(matches, index, input) {
  const listed = matches[index] ?? matches[0];
  if (listed) return listed;
  return String(input).trim() || null;
}
