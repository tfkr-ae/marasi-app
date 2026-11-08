// Settings → Upstream Proxy: this machine's upstream proxy list and the open
// project's selection. The store reads the list when Settings shows it,
// keeps each call's answer, and applies the upstream_proxy.* events another
// client's edits cause (onListChanged, onSelected) once it has read it.
// Backend calls go through the injected `api`, so tests run against a fake:
//
//   list() -> { items, selected, configured }
//   add(name, url, ca), update(name, url, ca, removeCA), remove(name),
//   use(name) -> the same state
//   check(name, target) -> { name, address, target, outcome, message }
//
// items are redacted: { name, scheme, host, port, has_credentials, has_ca }.
import { writable } from "svelte/store";

/** scheme://host:port, or "" for an entry whose URL a hand edit broke. */
export function upstreamAddress(item) {
  if (!item.scheme) return "";
  return `${item.scheme}://${item.host}:${item.port}`;
}

/** The warning for a selection this machine does not list, or "". */
export function selectionWarning(state) {
  if (!state.selected || state.configured) return "";
  return `"${state.selected}" isn't set up on this machine. This project's requests fail until you add it or choose another.`;
}

export function createUpstreamProxyStore(api) {
  const initial = () => ({
    items: [],
    selected: "",
    configured: true,
    loaded: false,
    // The last check of each entry, by name.
    checks: {},
    checking: "",
  });
  const store = writable(initial());

  function apply(answer, { forget } = {}) {
    store.update((state) => {
      const checks = { ...state.checks };
      if (forget) delete checks[forget];
      return {
        ...state,
        items: answer.items ?? [],
        selected: answer.selected ?? "",
        configured: answer.configured ?? true,
        loaded: true,
        checks,
      };
    });
    return answer;
  }

  const isListed = (items, name) => !name || items.some((item) => item.name === name);

  // Bumped by clear, so a load a project switch superseded drops its answer
  // instead of showing the last project's selection.
  let run = 0;
  async function load() {
    const thisRun = run;
    const answer = await api.list();
    return thisRun === run ? apply(answer) : answer;
  }

  // upstream_proxy.added, .updated and .removed carry the whole list. An
  // entry that changed loses its last check.
  function onListChanged({ items = [] } = {}) {
    store.update((state) => {
      if (!state.loaded) return state;
      const before = new Map(state.items.map((item) => [item.name, JSON.stringify(item)]));
      const checks = {};
      for (const item of items) {
        if (state.checks[item.name] && before.get(item.name) === JSON.stringify(item)) {
          checks[item.name] = state.checks[item.name];
        }
      }
      return { ...state, items, configured: isListed(items, state.selected), checks };
    });
  }

  // upstream_proxy.selected: { name }, "" for none.
  function onSelected({ name = "" } = {}) {
    store.update((state) =>
      state.loaded ? { ...state, selected: name, configured: isListed(state.items, name) } : state,
    );
  }

  return {
    subscribe: store.subscribe,
    onListChanged,
    onSelected,
    load,
    /**
     * Drops the answer of a load under way, as a project switch does. The
     * list stays shown (it is this machine's) until the next load reads it
     * with the new project's selection.
     */
    clear: () => {
      run++;
    },
    add: async (name, url, ca = "") => apply(await api.add(name, url, ca)),
    // An entry's old check no longer says anything about it.
    update: async (name, url, ca, removeCA) =>
      apply(await api.update(name, url, ca, removeCA), { forget: name }),
    remove: async (name) => apply(await api.remove(name), { forget: name }),
    use: async (name) => apply(await api.use(name)),
    /** Makes one test connection; a failed call is kept as its result. */
    async check(name, target) {
      store.update((state) => ({ ...state, checking: name }));
      let result;
      try {
        result = await api.check(name, target);
      } catch (error) {
        result = { name, target, outcome: "error", message: String(error) };
      }
      store.update((state) => ({
        ...state,
        checking: state.checking === name ? "" : state.checking,
        checks: { ...state.checks, [name]: result },
      }));
      return result;
    },
  };
}
