// The Ledger's sitemap dock: Marasi's sitemap (marasi docs/adr/2026-10-14-sitemap-is-stored-by-node-and-content-type.md), read a level at a
// time from ListSitemapChildren and never built here. Each open node keeps
// the children loaded so far; the dock shows the busiest WINDOW, then STEP
// more at a time, and reads the next page by cursor once the loaded ones
// run out.
//
// The ledger feeds it a context: the running query, its results' as_of, the
// content-type exclusion and whether the first rows have loaded (the
// sitemap waits for them). The binding is in sitemapStore.js; tests load
// this with a fake API.
import { writable } from "svelte/store";
import { hiddenBy } from "../lib/ledger/contentTypes.js";

/** Children read per ListSitemapChildren call: Marasi's page cap. */
export const FETCH_SIZE = 500;
/** Children each level shows at first. */
export const WINDOW = 10;
/** Children each "Show more" adds. */
export const STEP = 50;
/**
 * How long the sitemap waits after a sitemap.changed (a rebuild, or another
 * client's delete) before reading the open levels again, so a burst reads once.
 */
export const SITEMAP_SETTLE_MS = 400;
/** Levels per ListSitemapLevels call: Marasi's MaxSitemapLevels. */
const MAX_LEVELS = 64;
/** Pairs whose response is still awaited, kept to count their 5xx. */
const MAX_PENDING = 5000;

const SCOPES = ["all", "matching"];

function emptyContext() {
  return { query: "", asOf: null, exclusion: [], ready: false };
}

function initialState(scope = "all") {
  return {
    // The researcher's choice: "all" (All traffic) or "matching" (Matching
    // the query). Matching only takes effect while a query runs.
    scope,
    context: emptyContext(),
    // Loaded levels by node name, "" for the origins:
    // { children, cursor, shown, loading, failed, stale }. `cursor` is the
    // next page's, null when every child is loaded. `stale` is true while a
    // reload has yet to read the level again: its children's counts are
    // from before the query or scope changed.
    levels: {},
    // Open node names.
    open: {},
    // False while Marasi's sitemap job is still placing older pairs.
    complete: true,
  };
}

/** The scope in effect: Matching the query needs a running query. */
export function sitemapScope(state) {
  return state.scope === "matching" && state.context.query ? "matching" : "all";
}

/**
 * The header's host count, such as "12 hosts" or "500+ hosts"; none while
 * Marasi's sitemap job has yet to place a host.
 */
export function hostCountLabel(state) {
  const roots = state.levels[""];
  if (!roots) return "";
  const count = roots.children.length;
  if (count === 0 && !state.complete) return "";
  return `${count.toLocaleString()}${roots.cursor ? "+" : ""} ${count === 1 && !roots.cursor ? "host" : "hosts"}`;
}

/**
 * The dock's rows, top to bottom:
 *   { kind: "node", node, depth, open, loading, matching, dimmed, stale }
 *   { kind: "more", parent, depth, hidden, partial }  (partial: more pages follow)
 *   { kind: "loading", depth } / { kind: "failed", parent, depth }
 * `matching` is the node's matching count in All traffic with a query,
 * else null; a node without matches is dimmed. With `find`, only nodes
 * whose name contains it show, with the loaded nodes leading to them open.
 * `stale` marks a node whose counts are from before a reload that hasn't
 * read its level yet.
 */
export function sitemapRows(state, find = "") {
  const needle = find.trim().toLowerCase();
  const rows = [];
  const withMatching = sitemapScope(state) === "all" && !!state.context.query;
  const leadsTo = new Map();
  // Whether a node's name or a loaded descendant's contains the needle.
  const matches = (name) => {
    if (leadsTo.has(name)) return leadsTo.get(name);
    const hit =
      name.toLowerCase().includes(needle) ||
      (state.levels[name]?.children ?? []).some((child) => matches(child.Name));
    leadsTo.set(name, hit);
    return hit;
  };

  const walk = (parent, depth, filtering) => {
    const level = state.levels[parent];
    if (!level) return;
    const children = filtering ? level.children.filter((child) => matches(child.Name)) : level.children;
    const shown = children.slice(0, level.shown);
    for (const node of shown) {
      const named = filtering && node.Name.toLowerCase().includes(needle);
      // A node shown only because a descendant matches opens to it.
      const open = !!state.open[node.Name] || (filtering && !named);
      const matching = withMatching ? (node.Matching ?? null) : null;
      const childLevel = state.levels[node.Name];
      rows.push({
        kind: "node",
        node,
        depth,
        open,
        loading: !!childLevel?.loading,
        matching,
        dimmed: matching === 0,
        stale: !!level.stale,
      });
      if (!open || !node.HasChildren) continue;
      if (!childLevel || (childLevel.loading && childLevel.children.length === 0)) {
        rows.push({ kind: "loading", depth: depth + 1 });
      } else if (childLevel.failed && childLevel.children.length === 0) {
        rows.push({ kind: "failed", parent: node.Name, depth: depth + 1 });
      } else {
        walk(node.Name, depth + 1, filtering && !named);
      }
    }
    const hidden = children.length - shown.length;
    if (hidden > 0 || (level.cursor && !filtering)) {
      rows.push({ kind: "more", parent, depth, hidden, partial: !!level.cursor });
    }
  };
  walk("", 0, needle !== "");
  return rows;
}

// The names from an origin down to `leaf`: origin, origin/a, origin/a/b, …
function ancestry(leaf) {
  const origin = leaf.match(/^[^:/]+:\/\/[^/]+/)?.[0];
  if (!origin) return [];
  const names = [origin];
  let name = origin;
  for (const segment of leaf.slice(origin.length).split("/").filter(Boolean)) {
    name += "/" + segment;
    names.push(name);
  }
  return names;
}

function segmentOf(name, parent) {
  return parent === "" ? name : name.slice(parent.length + 1);
}

export function createSitemapStore(api) {
  let current = initialState();
  const { subscribe, set: setStore } = writable(current);
  function set(next) {
    current = next;
    setStore(next);
  }
  function update(fn) {
    set(fn(current));
  }
  function updateLevel(name, fn) {
    update((state) => ({ ...state, levels: { ...state.levels, [name]: fn(state.levels[name]) } }));
  }

  // Bumped on every reload and project switch: reads for an older one are
  // dropped.
  let generation = 0;
  const inflight = new Set();
  function track(promise) {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
    return promise;
  }

  // Live pairs wait here until the next flush. `pending` maps a pair's id
  // to its sitemap leaf until its response arrives.
  let requestBuffer = [];
  let responseBuffer = [];
  let pending = new Map();

  function request(node, cursor) {
    const { query, asOf, exclusion } = current.context;
    const matching = sitemapScope(current) === "matching";
    return {
      Node: node,
      Cursor: cursor ?? "",
      Limit: FETCH_SIZE,
      Query: query,
      AsOf: query ? (asOf ?? "") : "",
      Matching: matching,
      // The ledger's exclusion goes with each read, so a read never sees
      // an older one while the ledger is still saving it.
      Exclusion: [...exclusion],
    };
  }

  // Reads a page of `node`'s children: the first replaces the level, a
  // later one (by cursor) appends to it.
  function fetchLevel(node, cursor = null) {
    const gen = generation;
    const req = request(node, cursor);
    updateLevel(node, (level) => ({
      children: [],
      cursor: null,
      shown: WINDOW,
      ...level,
      loading: true,
      failed: false,
    }));
    return track(
      api
        .listSitemapChildren(req)
        .then((page) => {
          if (gen !== generation) return;
          const children = page?.Children ?? [];
          update((state) => {
            const level = state.levels[node];
            return {
              ...state,
              complete: page?.Complete ?? true,
              levels: {
                ...state.levels,
                [node]: {
                  ...level,
                  children: cursor ? [...level.children, ...children] : children,
                  cursor: page?.NextCursor ?? null,
                  loading: false,
                  failed: false,
                  stale: false,
                },
              },
            };
          });
        })
        .catch((err) => {
          if (gen !== generation) return;
          console.error(`Reading the sitemap under ${node || "the origins"} failed:`, err);
          updateLevel(node, (level) => ({ ...level, loading: false, failed: true, stale: false }));
        }),
    );
  }

  /**
   * Reads the origins and every open level again, keeping how many each
   * shows; their counts show as stale until the answer lands. One
   * ListSitemapLevels call reads them all (Marasi resolves the query once
   * for the lot), in groups of MAX_LEVELS; a newer reload's answer wins.
   * Closed levels are dropped and read when they next open.
   */
  function reload() {
    const gen = ++generation;
    const { ready, query, asOf } = current.context;
    const names = ["", ...Object.keys(current.levels).filter((name) => name !== "" && current.open[name])];
    const levels = {};
    for (const name of names) {
      const level = current.levels[name];
      if (level) levels[name] = level.children.length ? { ...level, stale: true } : level;
    }
    update((state) => ({ ...state, levels }));
    if (!ready || (query && !asOf)) return Promise.resolve();
    const groups = [];
    for (let i = 0; i < names.length; i += MAX_LEVELS) groups.push(names.slice(i, i + MAX_LEVELS));
    return Promise.all(groups.map((group) => fetchLevels(group, gen)));
  }

  // Reads the first page of each of `names` in one call.
  function fetchLevels(names, gen) {
    const { Node, Cursor, ...shared } = request("", null);
    for (const name of names) {
      updateLevel(name, (level) => ({ children: [], cursor: null, shown: WINDOW, ...level, loading: true, failed: false }));
    }
    return track(
      api
        .listSitemapLevels({ ...shared, Nodes: names, Cursors: {} })
        .then((result) => {
          if (gen !== generation) return;
          if (result?.QueryError) throw new Error(result.QueryError.Message);
          const byNode = new Map((result?.Levels ?? []).map((level) => [level.Node, level]));
          update((state) => {
            const next = { ...state.levels };
            for (const name of names) {
              const page = byNode.get(name);
              next[name] = {
                ...next[name],
                children: page?.Children ?? [],
                cursor: page?.NextCursor ?? null,
                loading: false,
                failed: false,
                stale: false,
              };
            }
            return { ...state, complete: result?.Complete ?? true, levels: next };
          });
        })
        .catch((err) => {
          if (gen !== generation) return;
          console.error("Reading the sitemap levels failed:", err);
          update((state) => {
            const next = { ...state.levels };
            for (const name of names) next[name] = { ...next[name], loading: false, failed: true, stale: false };
            return { ...state, levels: next };
          });
        }),
    );
  }

  function sameContext(a, b) {
    return (
      a.ready === b.ready &&
      a.query === b.query &&
      (!a.query || a.asOf === b.asOf) &&
      a.exclusion.join("\n") === b.exclusion.join("\n")
    );
  }

  /**
   * Follows the ledger: { query, asOf, exclusion, ready }. `query` is the
   * running query ("" in the live view) and `asOf` its results' as_of;
   * `ready` is whether the ledger's first rows have loaded since the
   * project opened. The sitemap reads again when any of them changes,
   * except the live view's as_of, which moves with every new pair.
   */
  function setContext(context) {
    const next = { ...emptyContext(), ...context, exclusion: context.exclusion ?? [] };
    // Once the project's first rows have loaded, later reads of the table
    // don't hold the sitemap back.
    next.ready = current.context.ready || !!next.ready;
    if (sameContext(current.context, next)) {
      if (current.context.asOf !== next.asOf) update((state) => ({ ...state, context: next }));
      return;
    }
    update((state) => ({ ...state, context: next }));
    reload();
  }

  function setScope(scope) {
    if (!SCOPES.includes(scope)) return;
    const before = sitemapScope(current);
    update((state) => ({ ...state, scope }));
    if (sitemapScope(current) !== before) reload();
  }

  /** Opens or closes a node; its children load the first time it opens. */
  function toggle(name) {
    const open = !current.open[name];
    update((state) => ({ ...state, open: { ...state.open, [name]: open } }));
    if (open && !current.levels[name]) fetchLevel(name);
  }

  /** Shows STEP more of a level's children, reading the next page if needed. */
  function showMore(name) {
    const level = current.levels[name];
    if (!level) return;
    const shown = level.shown + STEP;
    updateLevel(name, (l) => ({ ...l, shown }));
    if (shown > level.children.length && level.cursor && !level.loading) {
      fetchLevel(name, level.cursor);
    }
  }

  function collapseAll() {
    update((state) => ({ ...state, open: {} }));
  }

  // sitemap.changed: the stored sitemap changed under the loaded levels.
  let changedTimer = null;
  function onChanged() {
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => {
      changedTimer = null;
      reload();
    }, SITEMAP_SETTLE_MS);
  }

  function clear() {
    clearTimeout(changedTimer);
    changedTimer = null;
    generation++;
    requestBuffer = [];
    responseBuffer = [];
    pending = new Map();
    set(initialState(current.scope));
  }

  // Adds `delta` pairs and `errors` 5xx to `leaf` and its loaded ancestors.
  // A node missing from a fully loaded level joins it; a level with more
  // pages may hold it unseen, so it is left alone.
  function bump(levels, leaf, delta, errors) {
    const names = ancestry(leaf);
    let parent = "";
    for (const [i, name] of names.entries()) {
      const level = levels[parent];
      if (!level) break;
      const hasChildren = i < names.length - 1;
      const at = level.children.findIndex((child) => child.Name === name);
      let children;
      if (at !== -1) {
        const node = level.children[at];
        children = level.children.slice();
        children[at] = {
          ...node,
          Pairs: node.Pairs + delta,
          Errors: node.Errors + errors,
          HasChildren: node.HasChildren || hasChildren,
        };
      } else if (!level.cursor && delta > 0) {
        children = [
          ...level.children,
          { Name: name, Segment: segmentOf(name, parent), Pairs: delta, Errors: errors, HasChildren: hasChildren },
        ];
      } else {
        break;
      }
      levels[parent] = { ...level, children };
      parent = name;
    }
  }

  /**
   * Moves buffered traffic into the counts, in All traffic only: Matching
   * the query follows its results' snapshot.
   */
  function flush() {
    if (requestBuffer.length === 0 && responseBuffer.length === 0) return;
    const requests = requestBuffer;
    const responses = responseBuffer;
    requestBuffer = [];
    responseBuffer = [];
    const live = sitemapScope(current) === "all" && current.context.ready;
    const levels = { ...current.levels };
    for (const req of requests) {
      if (!req?.SitemapNode) continue;
      pending.set(String(req.ID), req.SitemapNode);
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
      if (live) bump(levels, req.SitemapNode, 1, 0);
    }
    for (const res of responses) {
      const leaf = pending.get(String(res.ID));
      if (!leaf) continue;
      pending.delete(String(res.ID));
      if (!live) continue;
      if (hiddenBy(res.ContentType, current.context.exclusion)) {
        bump(levels, leaf, -1, 0);
      } else if (res.StatusCode >= 500) {
        bump(levels, leaf, 0, 1);
      }
    }
    if (live) update((state) => ({ ...state, levels }));
  }

  return {
    subscribe,
    setContext,
    setScope,
    reload,
    toggle,
    showMore,
    collapseAll,
    clear,
    onRequest: (req) => requestBuffer.push(req),
    onResponse: (res) => responseBuffer.push(res),
    onChanged,
    flush,
    async settled() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };
}
