// The project store: which project the app has loaded, and opening another
// one on the service with the opening screen's state (lib/openProgress.js).
// It takes its api as an argument (projectApi.js builds it), so node --test
// runs it with a fake service client:
//
//   heldCheckpointIDs() -> [id]      GET /checkpoint
//   confirmSwitch() -> bool          the native unsaved-work prompt (Go)
//   open({name} | {path}) -> path    POST /project/open
//   listProjects() -> [{name, path, modifiedAt}]
//   loadProject(path, part, live)    the app's full load; part(signal);
//                                    it stops once live() is false
//   onProjectEvent(handler) -> stop  the service's project.* events
//
// The service waits for held Checkpoint items instead of refusing, so the
// store refuses first, as the app always has. A failed open leaves the
// service's project as it was, so the loaded project stays.
//
// Each open, reload and loadService is a run. A newer run supersedes it, and
// so does the caller's `current()` turning false (a connection switch).
// After each await a superseded run changes nothing (the opening screen,
// `loaded`, `generation`, a failure) and resolves to `{status:
// "superseded"}`; its load stops before the next store. Its opening screen
// closes when it ends, unless a newer run's screen has taken over.
//
// `follow` keeps a standing project.* listener for opens another client
// (the Marasi CLI, another app) starts: it shows the opening screen and
// hands the opened project on, since loading it asks first.
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
  // An open or reload of the app's own is under way: its events aren't
  // another client's.
  let own = 0;
  // Another client's open the screen follows: {path, timer, due (the
  // delay passed), held (the service waits for Checkpoint items)}.
  let followed = null;
  // The latest run, and the run whose opening screen shows (0: none).
  let latest = 0;
  let screenOf = 0;
  const superseded = { status: "superseded" };

  // Begins a run: `live()` holds while no newer run has begun and the
  // caller's `current()` holds.
  function claim(current = () => true) {
    const run = ++latest;
    return { run, live: () => run === latest && current() };
  }

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
   * Checkpoint items), `{status: "cancelled"}` (at the prompt),
   * `{status: "failed", error}` (the opening screen shows why) or
   * `{status: "superseded"}`.
   */
  async function open(target) {
    lastTarget = target;
    const { run, live } = claim();
    const held = await api.heldCheckpointIDs();
    if (!live()) return superseded;
    if (held.length) return { status: "held", ids: held };
    const agreed = await api.confirmSwitch();
    if (!live()) return superseded;
    if (!agreed) return { status: "cancelled" };

    const name = target.name ?? projectName(target.path);
    const finish = begin(name, target.path ?? null, run, live);
    try {
      let path;
      try {
        path = await api.open(target);
      } catch (error) {
        return live() ? fail(error) : superseded;
      }
      if (!live()) return superseded;
      return await load(path, live);
    } finally {
      finish();
    }
  }

  // Shows run `run`'s opening state for `name` (the screen waits
  // openingDelay), and follows the service's project events while `live()`.
  // Returns the function that stops, which closes the screen when the run
  // was superseded and the screen is still its own.
  function begin(name, path, run, live) {
    own++;
    endFollowed();
    const current = get(store).loaded;
    screenOf = run;
    patch({
      opening: openingFor({ name, path, current, scratchpad: name === "scratchpad" }),
      shown: current === null,
    });
    const timer = timers.setTimeout(() => live() && patch({ shown: true }), openingDelay);
    const stopEvents = api.onProjectEvent(
      (event, data) => live() && updateOpening((state) => withProjectEvent(state, event, data)),
    );
    return () => {
      own--;
      stopEvents();
      timers.clearTimeout(timer);
      if (!live() && screenOf === run) {
        screenOf = 0;
        patch({ opening: null, shown: false });
      }
    };
  }

  // Stops following another client's open; `close` takes its screen down.
  function endFollowed({ close = false } = {}) {
    if (!followed) return;
    timers.clearTimeout(followed.timer);
    followed = null;
    if (close) patch({ opening: null, shown: false });
  }

  /**
   * Follows the service's project events for opens the app didn't start,
   * until the returned function is called. The opening screen shows as for
   * the app's own opens; `opened(path)` hands on a project the service
   * opened instead of the loaded one, whose load (after the unsaved-work
   * prompt) is the connection store's, and `failed(name, error)` reports an
   * open that failed, after which the service keeps the loaded project.
   */
  function follow({ opened = () => {}, failed = () => {} } = {}) {
    return api.onProjectEvent((event, data) => {
      const path = typeof data?.project === "string" ? data.project : null;
      const { loaded, opening } = get(store);
      if (own || !path || !loaded) return;
      // A late event of the app's own failed open, whose screen still
      // shows. A failed open never sends project.opened.
      const ours = opening && (opening.path ? opening.path === path : opening.name === projectName(path));
      if (!followed && ours && event !== "project.opened") return;
      if (path === loaded.path) {
        if (event === "project.opened") endFollowed({ close: true });
        return;
      }
      if (event === "project.opening_failed") {
        if (followed?.path === path) endFollowed({ close: true });
        failed(projectName(path), data.error ?? "");
        return;
      }
      if (followed?.path !== path) {
        endFollowed();
        screenOf = 0;
        patch({ opening: openingFor({ name: projectName(path), path, current: loaded }), shown: false });
        const entry = { path, held: false, due: false, timer: null };
        entry.timer = timers.setTimeout(() => {
          entry.due = true;
          if (followed === entry && !entry.held) patch({ shown: true });
        }, openingDelay);
        followed = entry;
      }
      if (event === "project.waiting") {
        // The service waits for items the app holds in Checkpoint, which
        // the screen would cover: it stays down until they're released.
        followed.held = (data.waiting_for ?? []).some((wait) => wait.kind === "checkpoint");
        if (followed.held) patch({ shown: false });
        else if (followed.due) patch({ shown: true });
      }
      updateOpening((state) => withProjectEvent(state, event, data));
      if (event === "project.opened") opened(path);
    });
  }

  // Loads the project the service switched to, at `path`, and remounts the
  // pages, while `live()`.
  async function load(path, live) {
    const remount = () => store.update((state) => ({ ...state, generation: state.generation + 1 }));
    updateOpening((state) => withSwitched({ ...state, path }));
    try {
      await api.loadProject(path, (signal) => live() && updateOpening((state) => withLoadPart(state, signal)), live);
    } catch (error) {
      if (!live()) return superseded;
      remount();
      return fail(error);
    }
    if (!live()) return superseded;
    remount();
    const { opening } = get(store);
    const project = (opening && openingScreen(withOpened(opening)).opened) ?? projectAt(path);
    screenOf = 0;
    patch({ opening: null, shown: false, loaded: project });
    return { status: "opened", project };
  }

  /**
   * Loads afresh the project the service has open at `path`, as after a
   * switch, with no open and no prompt: the connection store's reconnect
   * found another project or a restarted service, and asked already.
   * `current()` false supersedes it, as a newer run does.
   */
  async function reload(path, { current } = {}) {
    lastTarget = { path };
    const { run, live } = claim(current);
    const finish = begin(projectName(path), path, run, live);
    try {
      return await load(path, live);
    } finally {
      finish();
    }
  }

  /**
   * Loads the service's project at `path` on connecting, with no opening
   * screen and no remount, then records it as loaded. Resolves to the
   * project, or `{status: "superseded"}` when a newer run began or
   * `current()` turned false first.
   */
  async function loadService(path, { current } = {}) {
    const { live } = claim(current);
    await api.loadProject(path, () => {}, live);
    if (!live()) return superseded;
    const project = projectAt(path);
    patch({ loaded: project });
    return project;
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
    reload,
    loadService,
    follow,
    /** Re-runs the last open, for the opening screen's Try again. */
    retry: () => (lastTarget ? open(lastTarget) : Promise.resolve(null)),
    /**
     * Stays in the project still open after a failed open, and closes the
     * screen. When the target opened but didn't load, that's the target.
     */
    stay() {
      endFollowed();
      screenOf = 0;
      const current = get(store).opening?.current;
      patch({ opening: null, shown: false, ...(current ? { loaded: current } : {}) });
    },
    /**
     * Closes the screen following another client's open, when the
     * unsaved-work prompt kept the pages on the loaded project.
     */
    closeFollowed: () => endFollowed({ close: true }),
    /** The ids of the items Checkpoint holds, which refuse a switch. */
    held: () => api.heldCheckpointIDs(),
    /** The service's projects, most recent first. */
    list: () => api.listProjects(),
  };
}
