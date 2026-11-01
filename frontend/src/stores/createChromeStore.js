// The Chrome paths and profiles, which Settings → Browser and Home's Chrome
// menu show, in v1's shapes: paths as [{OS, Path}], profiles as names. The
// store keeps each call's answer and, while Chrome is the instance's,
// follows the chrome.* events, so a change the CLI or another window makes
// shows up too. On a remote connection Chrome is this machine's, which the
// instance's events don't describe.
import { writable } from "svelte/store";

// A chrome.path.* event's list as v1's [{OS, Path}], a profile one's as names.
const eventPaths = (items = []) => items.map((item) => ({ OS: item.os, Path: item.path }));
const eventProfiles = (items = []) => items.map((item) => item.name);

/**
 * The Chrome store. `api` is `{paths(), profiles(), addPath(path, os),
 * removePath(path, os), addProfile(name), removeProfile(name)}`, the v1
 * Chrome bindings, each resolving the list it changed, and
 * `instanceChrome()`, whether Chrome is the instance's.
 */
export function createChromeStore(api) {
  const store = writable({ paths: [], profiles: [] });
  const setPaths = (paths) => store.update((state) => ({ ...state, paths }));
  const setProfiles = (profiles) => store.update((state) => ({ ...state, profiles }));
  const instanceChrome = api.instanceChrome ?? (() => true);

  return {
    subscribe: store.subscribe,
    async reload() {
      const [paths, profiles] = await Promise.all([api.paths(), api.profiles()]);
      store.set({ paths, profiles });
    },
    onPaths: ({ items } = {}) => instanceChrome() && setPaths(eventPaths(items)),
    onProfiles: ({ items } = {}) => instanceChrome() && setProfiles(eventProfiles(items)),
    addPath: async (path, os) => setPaths(await api.addPath(path, os)),
    removePath: async ({ Path, OS }) => setPaths(await api.removePath(Path, OS)),
    addProfile: async (name) => setProfiles(await api.addProfile(name)),
    removeProfile: async (name) => setProfiles(await api.removeProfile(name)),
  };
}
