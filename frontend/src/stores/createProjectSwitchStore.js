// The window's project switches and the opening screen they show. A switch
// is the connected instance's: this window starts one with POST
// /project/open, and another client (the CLI, another window) starts one
// that this window follows through Marasi's project.* events. Either way,
// the window reloads the project once it has opened. lib/openProgress.js
// has what the screen shows.
import { get, writable } from "svelte/store";
import { isNotPorted } from "../lib/bindings/notPorted.js";
import {
  openingFor,
  projectName,
  withFailed,
  withLoadPart,
  withOpened,
  withOpening,
  withOwner,
  withRecents,
  withSwitched,
  withUpgrading,
  withWaiting,
  openingScreen,
} from "../lib/openProgress.js";

// The opening screen waits this long once a switch is underway before it
// shows, so quick switches stay instant.
const openingDelay = 300;

const isPath = (target) => /[\\/]/.test(target);

/**
 * The window's project switch store. `api` is:
 * - `openProject(target)`: POST /project/open with a name or an
 *   instance-machine path; resolves to the path once the switch is done.
 * - `listProjects()`: the instance's /project/list items.
 * - `localInstances()`: this machine's running instances' /service/status.
 * - `isRemote()`: whether the window's connection is remote.
 * - `confirmLeaving()`: true when a switch this window starts loses no work
 *   (dirty Launchpad drafts); otherwise it asks, resolving false to stay.
 * - `load(project, loadPart, {own})`: reads the opened project `{name,
 *   path}` into the window, calling `loadPart(signal)` as each part starts.
 *   `own` is a switch this window started, which the researcher agreed to
 *   lose work for; another client's keeps it.
 * - `busy(isBusy)`: a switch started, or ended.
 * - `openInstanceWindow(instance)`: a new window on local `instance`.
 * - `showCheckpoint()`: shows the Checkpoint page.
 * - `setTimeout`, `clearTimeout`: the screen's delay.
 *
 * Its state is `{opening, shown, loaded}`: the switch in progress (as
 * openProgress.js state, plus `own` for one this window started), whether
 * the screen is up, and the project last opened and loaded, `{name, path}`.
 */
export function createProjectSwitchStore(api) {
  const store = writable({ opening: null, shown: false, loaded: null });
  const opening = () => get(store).opening;
  const setOpening = (state) => store.update((s) => ({ ...s, opening: state }));
  // The project the instance has open and this window loaded: what a failed
  // switch stays in. Null until the first one has loaded.
  let current = null;
  // Each switch's number, so a late answer for an earlier one is dropped.
  let attempt = 0;
  let timer = null;
  // The last open asked for, which Try again re-runs.
  let lastOpen = null;

  function stopTimer() {
    if (timer !== null) api.clearTimeout(timer);
    timer = null;
  }

  function show() {
    stopTimer();
    store.update((s) => ({ ...s, shown: true }));
  }

  // Starts a switch's state. With nothing loaded yet (startup) there's
  // nothing else to show, so the screen is up at once; otherwise it shows
  // after the delay. A screen that is up stays up for the new switch.
  function begin({ name, path = null, own }) {
    attempt += 1;
    stopTimer();
    setOpening({ ...openingFor({ name, path, current, scratchpad: name === "scratchpad" }), own });
    api.busy(true);
    if (current === null) show();
    else if (!get(store).shown) timer = api.setTimeout(show, openingDelay);
  }

  // Whether a switch is underway and hasn't failed.
  const underway = () => Boolean(opening()) && !opening().failure;

  // The instance switched to `path`: loads the project into the window.
  async function finish(path) {
    const asked = attempt;
    const state = opening();
    // `loading` marks a switch whose project is loading, so a repeated
    // project.opened doesn't load it again.
    const switched = { ...withSwitched({ ...state, path: path ?? state.path }), loading: true };
    setOpening(switched);
    current = switched.current;
    try {
      await api.load(
        switched.current,
        (signal) => {
          if (asked === attempt) setOpening(withLoadPart(opening(), signal));
        },
        { own: Boolean(state.own) },
      );
    } catch (error) {
      // A call that isn't ported to v2 yet leaves its page empty, but the
      // project is open, so the window carries on in it.
      if (isNotPorted(error)) console.warn("Loading the project stopped at a call not ported yet:", error);
      else {
        if (asked === attempt) fail(error);
        return null;
      }
    }
    if (asked !== attempt) return null;
    const opened = openingScreen(withOpened(opening())).opened;
    stopTimer();
    store.set({ opening: null, shown: false, loaded: opened });
    current = opened;
    api.busy(false);
    return opened;
  }

  // The switch failed with `error`: shows the screen, with the instance's
  // projects to open instead and, for a project another local instance
  // has open, that instance.
  function fail(error) {
    const before = opening();
    if (!before) return;
    const failed = withFailed(before, error);
    setOpening(failed);
    show();
    if (before.failure) return;
    api.busy(false);
    const asked = attempt;
    findAlternatives(failed).catch((err) => console.error("Listing the instance's projects failed:", err));
    async function findAlternatives(state) {
      const items = await api.listProjects();
      if (asked !== attempt) return;
      setOpening(withRecents(opening(), items));
      if (state.failure.kind !== "locked" || api.isRemote()) return;
      // Marasi doesn't name the owner, so ask each local instance.
      const path = state.path ?? items.find((item) => item.name === state.name)?.project ?? null;
      const owner = path && (await api.localInstances()).find((instance) => instance.project === path);
      if (owner && asked === attempt) setOpening(withOwner(opening(), owner.instance));
    }
  }

  /**
   * Opens `target` on the instance: a bare name in its projects directory,
   * or a path on the instance machine. Resolves to the project that
   * opened, `{name, path}`, or null when it didn't. It asks first when
   * the switch would lose work, and stays put on Cancel.
   */
  async function open(target) {
    const text = String(target);
    const leave = api.confirmLeaving();
    if (leave !== true && !(await leave)) return null;
    lastOpen = () => open(text);
    begin({ name: projectName(text), path: isPath(text) ? text : null, own: true });
    const asked = attempt;
    let path;
    try {
      path = await api.openProject(text);
    } catch (error) {
      if (asked === attempt) fail(error);
      return null;
    }
    return asked === attempt ? finish(path) : null;
  }

  /**
   * Loads the project the instance has open at startup, `status` being its
   * /service/status. Resolves like open.
   */
  function openConnected(status) {
    lastOpen = () => openConnected(status);
    begin({ name: projectName(status.project), path: status.project, own: true });
    return finish(status.project);
  }

  // A switch this window didn't start, or whose start it missed.
  function follow(project) {
    if (!underway()) begin({ name: projectName(project), path: project, own: false });
  }

  /** project.opening {project}: a switch began. */
  function onOpening(event) {
    follow(event.project);
    setOpening(withOpening(opening(), event));
  }

  /** project.upgrading {migration, applied, total}. */
  function onUpgrading(event) {
    if (underway()) setOpening(withUpgrading(opening(), event));
  }

  /** project.waiting {waiting_for}. */
  function onWaiting(event) {
    if (underway()) setOpening(withWaiting(opening(), event));
  }

  /**
   * project.opened {project}: the instance switched. A switch this window
   * started loads once its POST answers; any other reloads the window now.
   */
  function onOpened(event) {
    const state = opening();
    if (state && !state.failure && (state.own || state.loading)) return Promise.resolve(null);
    follow(event.project);
    return finish(event.project);
  }

  /** project.opening_failed {project, error}. */
  function onOpeningFailed(event) {
    follow(event.project);
    fail(event.error);
  }

  /** Stays in the project still open, after a failed switch. */
  function stay() {
    const state = opening();
    attempt += 1;
    stopTimer();
    if (state?.current) current = state.current;
    store.set({ opening: null, shown: false, loaded: current });
  }

  /** Opens the instance that owns a locked project in a new window. */
  async function connectOwner() {
    const owner = opening()?.owner;
    if (!owner) return;
    await api.openInstanceWindow(owner);
    stay();
  }

  /** Steps the screen aside for Checkpoint, which answers during a switch. */
  function showCheckpoint() {
    stopTimer();
    store.update((s) => ({ ...s, shown: false }));
    api.showCheckpoint();
  }

  return {
    subscribe: store.subscribe,
    open,
    openConnected,
    retry: () => lastOpen?.(),
    stay,
    connectOwner,
    showCheckpoint,
    onOpening,
    onUpgrading,
    onWaiting,
    onOpened,
    onOpeningFailed,
  };
}
