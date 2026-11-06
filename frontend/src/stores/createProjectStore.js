// The project store: which project the app has loaded, and opening another
// one on the service with the opening screen's state (lib/openProgress.js).
// It takes its api as an argument (projectApi.js builds it), so node --test
// runs it with a fake service client:
//
//   heldCheckpointIDs() -> [id]      GET /checkpoint
//   confirmSwitch() -> bool          the native unsaved-work prompt (Go)
//   open({name} | {path}) -> path    POST /project/open
//   listProjects() -> [{name, path, modifiedAt}]
//   loadProject(path, part)          the app's full load; part(signal)
//   onProjectEvent(handler) -> stop  the service's project.* events
//
// The service waits for held Checkpoint items instead of refusing, so the
// store refuses first, as the app always has. A failed open leaves the
// service's project as it was, so the loaded project stays.
import { get, writable } from "svelte/store";
import {
  openingFor,
  openingScreen,
  projectName,
  withFailed,
  withLoadPart,
  withOpened,
  withProjectEvent,
  withRecents,
  withSwitched,
} from "../lib/openProgress.js";

// The opening screen waits this long once an open is underway before it
// shows, so quick switches stay instant.
const openingDelay = 300;

const projectAt = (path) => ({ name: projectName(path), path });

export function createProjectStore(api, timers = globalThis) {
  const store = writable({
    // The open in progress (openProgress.js state), or null.
    opening: null,
    // Whether the opening screen is up: slow opens and failures.
    shown: false,
    // The project the app has loaded, `{name, path}`, or null until the
    // first one has.
    loaded: null,
    // Bumped after each switch's load, so the pages mount afresh.
    generation: 0,
  });
  const patch = (next) => store.update((state) => ({ ...state, ...next }));
  const updateOpening = (change) =>
    store.update((state) => (state.opening ? { ...state, opening: change(state.opening) } : state));
  let lastTarget = null;

  function fail(error) {
    const failed = get(store).opening && withFailed(get(store).opening, error);
    patch({ opening: failed, shown: true });
    api
      .listProjects()
      .then((recents) => updateOpening((state) => (state === failed ? withRecents(state, recents) : state)))
      .catch((err) => console.error("Listing projects failed:", err));
    return { status: "failed", error };
  }

  /**
   * Opens `target`, `{name}` or `{path}`, and loads it. Resolves to
   * `{status: "opened", project}`, `{status: "held", ids}` (refused over held
   * Checkpoint items), `{status: "cancelled"}` (at the prompt) or
   * `{status: "failed", error}` (the opening screen shows why).
   */
  async function open(target) {
    lastTarget = target;
    const held = await api.heldCheckpointIDs();
    if (held.length) return { status: "held", ids: held };
    if (!(await api.confirmSwitch())) return { status: "cancelled" };

    const current = get(store).loaded;
    const name = target.name ?? projectName(target.path);
    patch({
      opening: openingFor({ name, path: target.path ?? null, current, scratchpad: name === "scratchpad" }),
      shown: current === null,
    });
    const timer = timers.setTimeout(() => patch({ shown: true }), openingDelay);
    const stopEvents = api.onProjectEvent((event, data) => updateOpening((state) => withProjectEvent(state, event, data)));
    try {
      let path;
      try {
        path = await api.open(target);
      } catch (error) {
        return fail(error);
      }
      updateOpening((state) => withSwitched({ ...state, path }));
      try {
        await api.loadProject(path, (signal) => updateOpening((state) => withLoadPart(state, signal)));
      } catch (error) {
        return fail(error);
      } finally {
        store.update((state) => ({ ...state, generation: state.generation + 1 }));
      }
      const project = openingScreen(withOpened(get(store).opening)).opened ?? projectAt(path);
      patch({ opening: null, shown: false, loaded: project });
      return { status: "opened", project };
    } finally {
      stopEvents();
      timers.clearTimeout(timer);
    }
  }

  return {
    subscribe: store.subscribe,
    /** Records the service's project, at `path`, as loaded (on connecting). */
    loaded(path) {
      const project = projectAt(path);
      patch({ loaded: project });
      return project;
    },
    open,
    /** Re-runs the last open, for the opening screen's Try again. */
    retry: () => (lastTarget ? open(lastTarget) : Promise.resolve(null)),
    /**
     * Stays in the project still open after a failed open, and closes the
     * screen. When the target opened but didn't load, that's the target.
     */
    stay() {
      const current = get(store).opening?.current;
      patch({ opening: null, shown: false, ...(current ? { loaded: current } : {}) });
    },
    /** The ids of the items Checkpoint holds, which refuse a switch. */
    held: () => api.heldCheckpointIDs(),
    /** The service's projects, most recent first. */
    list: () => api.listProjects(),
  };
}
