// The instance's Chrome paths and profiles, which Settings → Browser and
// Home's Chrome menu show, in v1's shapes: paths as [{OS, Path}], profiles
// as names. The store keeps each call's answer and follows the chrome.*
// events, so a change the CLI or another window makes shows up too.
import { writable } from "svelte/store";

// A chrome.path.* event's list as v1's [{OS, Path}], a profile one's as names.
const eventPaths = (items = []) => items.map((item) => ({ OS: item.os, Path: item.path }));
const eventProfiles = (items = []) => items.map((item) => item.name);

/**
 * The Chrome store. `api` is `{paths(), profiles(), addPath(path, os),
 * removePath(path, os), addProfile(name), removeProfile(name)}`, the v1
 * Chrome bindings, each resolving the list it changed.
 */
export function createChromeStore(api) {
  const store = writable({ paths: [], profiles: [] });
  const setPaths = (paths) => store.update((state) => ({ ...state, paths }));
  const setProfiles = (profiles) => store.update((state) => ({ ...state, profiles }));

  return {
    subscribe: store.subscribe,
    async reload() {
      const [paths, profiles] = await Promise.all([api.paths(), api.profiles()]);
      store.set({ paths, profiles });
    },
    onPaths: ({ items } = {}) => setPaths(eventPaths(items)),
    onProfiles: ({ items } = {}) => setProfiles(eventProfiles(items)),
    addPath: async (path, os) => setPaths(await api.addPath(path, os)),
    removePath: async ({ Path, OS }) => setPaths(await api.removePath(Path, OS)),
    addProfile: async (name) => setProfiles(await api.addProfile(name)),
    removeProfile: async (name) => setProfiles(await api.removeProfile(name)),
  };
}
