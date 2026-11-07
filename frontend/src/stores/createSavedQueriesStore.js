// Saved queries: the open project's own (client settings
// `ledger.saved_query.<uuid>`, each { name, query, order }, docs/adr/2026-10-16-app-defaults-with-project-overrides.md), the
// app-wide ones (the app config YAML), and the built-ins that ship with the
// app, which can be hidden. Backend calls go through the injected `api`, so
// tests run against a fake:
//
//   getAppSavedQueries()        -> { queries: [{ id, name, query, order }], hidden_builtins: [id] }
//   saveAppSavedQueries(list)   -> the saved list, in order
//   setHiddenBuiltins(ids)      -> the saved ids
//   countMatches(query)         -> { Count, Capped, QueryError } (CountTraffic)
//   listClientSettings(prefix)  -> [{ key, value }] (the project's settings)
//   setClientSetting(key, value), deleteClientSetting(key)
//
// Each writable source has a backend in `backends` with put and remove; its
// entries live in state.queries[source]. Writes are optimistic: the state
// changes first, and goes back if the write fails.
import { writable } from "svelte/store";
import { COUNT_DELAY_MS, createMatchCounts } from "./createMatchCounts.js";

/** The client-setting key prefix of the project's saved queries. */
export const PROJECT_QUERY_PREFIX = "ledger.saved_query.";

/** The menu's groups, in order. Only "builtin" is read-only. */
export const SOURCES = [
  { key: "project", label: "This project" },
  { key: "app", label: "All projects" },
  { key: "builtin", label: "Built-in" },
];

/** The saved queries that ship with the app. Their ids are stable: hiding one stores its id. */
export const BUILTIN_QUERIES = [
  { id: "server-errors", name: "Server errors", query: "status_code >= 500" },
  { id: "client-errors", name: "Client errors", query: "status_code >= 400 AND status_code < 500" },
  { id: "redirects", name: "Redirects", query: "status_code >= 300 AND status_code < 400" },
  {
    id: "writes",
    name: "Writes",
    query: 'method = "POST" OR method = "PUT" OR method = "PATCH" OR method = "DELETE"',
  },
  { id: "cookies-set", name: "Cookies set", query: 'response_head:"set-cookie"' },
  { id: "jwts-anywhere", name: "JWTs anywhere", query: '"eyJhbGci"' },
].map((q, order) => ({ ...q, order, source: "builtin" }));

// How much of a query names a query saved without a name.
const UNNAMED_LENGTH = 32;

function initialState() {
  return {
    // Each writable source's entries ({ id, name, query, order, source }), in order.
    queries: { project: [], app: [] },
    // Ids of the hidden built-ins.
    hiddenBuiltins: [],
    // Match counts by query text: { count, capped }, { error } for a query
    // Marasi rejects, or null when it couldn't be counted. `stale: true`
    // marks the last run's count while a refresh recounts it. A query
    // without an entry hasn't been counted yet.
    counts: {},
  };
}

/**
 * The menu's groups ({ key, label, items }), leaving out empty ones. Each
 * item is an entry plus `hidden`; hidden built-ins appear only with
 * `showHidden`.
 */
export function savedQueryGroups(state, { showHidden = false } = {}) {
  return SOURCES.map((source) => {
    const entries = source.key === "builtin" ? BUILTIN_QUERIES : state.queries[source.key] ?? [];
    const items = entries
      .map((q) => ({ ...q, hidden: source.key === "builtin" && state.hiddenBuiltins.includes(q.id) }))
      .filter((q) => showHidden || !q.hidden);
    return { ...source, items };
  }).filter((group) => group.items.length);
}

/** Every saved query the menu shows without hidden built-ins, in menu order. */
export function visibleSavedQueries(state) {
  return savedQueryGroups(state).flatMap((group) => group.items);
}

/** How many built-ins are hidden. */
export function hiddenBuiltinCount(state) {
  return BUILTIN_QUERIES.filter((q) => state.hiddenBuiltins.includes(q.id)).length;
}

/**
 * The saved query whose query is `text`, or null. A hidden built-in still
 * counts: the query is saved, just not listed.
 */
export function activeSavedQuery(state, text) {
  const query = text.trim();
  if (!query) return null;
  const all = savedQueryGroups(state, { showHidden: true }).flatMap((group) => group.items);
  return all.find((q) => q.query === query) ?? null;
}

/** True when `text` is a valid query (`valid`) that no saved query has. */
export function canSaveQuery(state, text, valid) {
  return Boolean(valid && text.trim() && !activeSavedQuery(state, text));
}

/**
 * The project's saved queries from its client settings, in order, skipping
 * unusable values so one bad key does not hide the others.
 */
function parseProjectQueries(settings) {
  const out = [];
  for (const setting of settings ?? []) {
    let value = setting?.value;
    try {
      if (typeof value === "string") value = JSON.parse(value);
    } catch {
      value = null;
    }
    const id = String(setting?.key ?? "").slice(PROJECT_QUERY_PREFIX.length);
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    const query = typeof value?.query === "string" ? value.query.trim() : "";
    if (!id || !name || !query) {
      console.error(`skipping unusable saved query ${setting?.key}`);
      continue;
    }
    out.push({ id, name, query, order: Number.isFinite(value.order) ? value.order : 0 });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** The name a query saved without one gets. */
function defaultName(query) {
  return query.length > UNNAMED_LENGTH ? `${query.slice(0, UNNAMED_LENGTH).trimEnd()}…` : query;
}

export function createSavedQueriesStore(
  api,
  { newId = () => crypto.randomUUID(), timers = globalThis, countDelay = COUNT_DELAY_MS } = {},
) {
  const { subscribe, update } = writable(initialState());
  let current = initialState();
  subscribe((state) => (current = state));

  const setSource = (source, entries) =>
    update((state) => ({
      ...state,
      queries: { ...state.queries, [source]: entries.map((q) => ({ ...q, source })) },
    }));

  // The app config's list, without the store's own fields.
  const appList = (entries) => entries.map(({ id, name, query, order }) => ({ id, name, query, order }));
  // One project query per client setting, so a change rewrites only its key.
  const projectKey = (entry) => `${PROJECT_QUERY_PREFIX}${entry.id}`;

  const byOrder = (entries) => [...entries].sort((a, b) => a.order - b.order);
  const without = (entries, entry) => entries.filter((q) => q.id !== entry.id);

  // The writable sources' backends. `put` writes `entry` and `remove`
  // deletes it, given the source's list as it now stands in the menu.
  const backends = {
    project: {
      put: (entry) => {
        const { name, query, order } = entry;
        return api.setClientSetting(projectKey(entry), { name, query, order });
      },
      remove: (entry) => api.deleteClientSetting(projectKey(entry)),
    },
    app: {
      put: (entry, entries) => writeApp(entries),
      remove: (entry, entries) => writeApp(entries),
    },
  };
  async function writeApp(entries) {
    const saved = await api.saveAppSavedQueries(appList(entries));
    setSource("app", saved ?? []);
  }

  // Settings writes are optimistic: the menu changes at once, then the
  // backend is written. A failed write puts the source's list back and
  // rejects, so the caller can say so.
  async function change(source, entries, write) {
    const before = current.queries[source];
    setSource(source, entries);
    try {
      await write(entries);
    } catch (error) {
      setSource(source, before);
      throw error;
    }
  }

  // Adds, updates or removes one entry of `entry.source`.
  function addEntry(entry) {
    const { source } = entry;
    return change(source, byOrder([...current.queries[source], entry]), (entries) =>
      backends[source].put(entry, entries),
    );
  }
  function updateEntry(entry) {
    const { source } = entry;
    const entries = current.queries[source].map((q) => (q.id === entry.id ? entry : q));
    return change(source, entries, (entries) => backends[source].put(entry, entries));
  }
  function removeEntry(entry) {
    const { source } = entry;
    return change(source, without(current.queries[source], entry), (entries) =>
      backends[source].remove(entry, entries),
    );
  }

  let projectRun = 0;
  /**
   * Reads the open project's saved queries, replacing the last project's.
   * A newer read wins; a failed read leaves the project with none.
   */
  async function loadProject() {
    const run = ++projectRun;
    let entries = [];
    try {
      entries = parseProjectQueries(await api.listClientSettings(PROJECT_QUERY_PREFIX));
    } catch (error) {
      console.error("reading the project's saved queries:", error);
    }
    if (run === projectRun) setSource("project", entries);
  }

  let loading = null;
  /**
   * Reads the project's saved queries, and the app-wide ones once; later
   * calls share the first app-wide read.
   */
  function load() {
    const project = loadProject();
    loading ??= (async () => {
      try {
        const saved = await api.getAppSavedQueries();
        setSource("app", saved?.queries ?? []);
        update((state) => ({ ...state, hiddenBuiltins: saved?.hidden_builtins ?? [] }));
      } catch (error) {
        console.error("reading saved queries:", error);
        loading = null;
      }
    })();
    return Promise.all([project, loading]).then(() => {});
  }

  /** Saves `query` as `name` in `source`, after its other queries. Resolves to the entry. */
  async function save(name, query, source = "app") {
    const text = query.trim();
    const entry = {
      id: newId(),
      name: name.trim() || defaultName(text),
      query: text,
      order: nextOrder(source),
      source,
    };
    await addEntry(entry);
    return entry;
  }

  const nextOrder = (source) => current.queries[source].reduce((max, q) => Math.max(max, q.order + 1), 0);

  /**
   * Moves a saved query to `target` ("project" or "app"), after its
   * queries. The menu shows it in its new place at once; then the new copy
   * is written and the old one deleted. If either write fails the query
   * goes back where it was, with the new copy taken back, so one copy
   * remains, and it rejects.
   */
  async function move(entry, target) {
    if (entry.source === target || !backends[target]) return;
    const { hidden, ...stored } = entry;
    const from = stored.source;
    const moved = { ...stored, order: nextOrder(target), source: target };
    const putBack = () => setSource(from, byOrder([...without(current.queries[from], stored), stored]));
    setSource(from, without(current.queries[from], stored));
    try {
      await addEntry(moved);
    } catch (error) {
      putBack();
      throw error;
    }
    try {
      await backends[from].remove(stored, current.queries[from]);
    } catch (error) {
      putBack();
      await removeEntry(moved).catch((undo) => console.error("taking back a moved query:", undo));
      throw error;
    }
  }

  /** Renames a saved query; a blank name changes nothing. */
  async function rename(entry, name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === entry.name) return;
    const { hidden, ...stored } = entry;
    await updateEntry({ ...stored, name: trimmed });
  }

  async function remove(entry) {
    const { hidden, ...stored } = entry;
    await removeEntry(stored);
  }

  /** Hides a built-in, or shows it again; at once, put back if the write fails. */
  async function setBuiltinHidden(id, hidden) {
    const before = current.hiddenBuiltins;
    const others = before.filter((h) => h !== id);
    const next = hidden ? [...others, id] : others;
    update((state) => ({ ...state, hiddenBuiltins: next }));
    try {
      const saved = await api.setHiddenBuiltins(next);
      update((state) => ({ ...state, hiddenBuiltins: saved ?? [] }));
    } catch (error) {
      update((state) => ({ ...state, hiddenBuiltins: before }));
      throw error;
    }
  }

  // Match counts, mirrored into state.counts: four at a time, the last
  // run's kept (stale) until each new one arrives; see createMatchCounts.
  const counts = createMatchCounts({
    queries: () => savedQueryGroups(current, { showHidden: true }).flatMap((g) => g.items.map((q) => q.query)),
    count: async (query) => {
      const result = await api.countMatches(query);
      return result.QueryError ? { error: result.QueryError.Message } : { count: result.Count, capped: result.Capped };
    },
    timers,
    delay: countDelay,
  });
  counts.subscribe((value) => update((state) => ({ ...state, counts: value })));
  const loadCounts = counts.load;
  // Counts after a project load, a resync or new traffic, once for a burst.
  const scheduleCounts = counts.schedule;
  // Forgets every count and stops counting, as a project switch does.
  const clearCounts = counts.clear;

  return {
    subscribe,
    load,
    loadProject,
    save,
    rename,
    remove,
    move,
    setBuiltinHidden,
    loadCounts,
    scheduleCounts,
    clearCounts,
  };
}
