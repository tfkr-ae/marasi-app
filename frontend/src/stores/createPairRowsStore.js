// The current rows of the pairs on a drawing's cards, kept live from the
// service's traffic events. A store of { <pair id>: row, or null once the
// pair is deleted }; an id not read yet is absent, and its card shows the
// row it carries (customData.last). The page tracks the ids on its drawing;
// with nothing tracked, events read nothing, but the rows they may have
// changed are read again once tracked.
//
// `createPairRowsStore(api)` takes createToolTrafficApi's api; the app's
// instance, its events and its projectData entry are in pairRowsStore.js.
import { writable } from "svelte/store";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";
import { PAIR_ROWS_CHUNK } from "./toolTrafficApi.js";

export function createPairRowsStore(api, { settleMs = 150 } = {}) {
  const store = writable({});
  const trackers = new Set();
  let rows = {};
  let timer = null;
  let pendingAll = false;
  const pendingIds = new Set();
  // Rows kept while no card tracked them, through an event that may have
  // changed them: read again when next tracked.
  const stale = new Set();
  // Bumped by clear(), so a read under way for the last project writes nothing.
  let generation = 0;

  const tracked = () => new Set([...trackers].flatMap((ids) => [...ids]));

  async function readRows(ids) {
    const mine = generation;
    const action = boundAction(api.bind?.());
    for (let i = 0; i < ids.length; i += PAIR_ROWS_CHUNK) {
      const chunk = ids.slice(i, i + PAIR_ROWS_CHUNK);
      let found;
      try {
        found = await action.step(() => api.readPairs(chunk));
      } catch (err) {
        if (isSuperseded(err)) return;
        console.error("reading card pairs:", err);
        continue;
      }
      if (mine !== generation) return;
      const byId = new Map(found.map((row) => [String(row.ID), row]));
      rows = { ...rows };
      for (const id of chunk) {
        rows[id] = byId.get(String(id)) ?? null;
        stale.delete(id);
      }
      store.set(rows);
    }
  }

  // Reads the named ids (or every tracked one) once events settle.
  function refresh(ids = null) {
    if (ids) ids.forEach((id) => pendingIds.add(String(id)));
    else pendingAll = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = tracked();
      const wanted = pendingAll ? [...now] : [...pendingIds].filter((id) => now.has(id));
      pendingAll = false;
      pendingIds.clear();
      if (wanted.length) readRows(wanted);
    }, settleMs);
  }

  const readTracked = () => readRows([...tracked()]);

  return {
    subscribe: store.subscribe,

    /** Keeps `ids` live until the returned stop is called. */
    track(ids) {
      const mine = new Set(ids.map(String));
      trackers.add(mine);
      const unread = [...mine].filter((id) => !(id in rows) || stale.has(id));
      if (unread.length) readRows(unread);
      return () => {
        trackers.delete(mine);
        if (!trackers.size) clearTimeout(timer);
      };
    },

    /** traffic.changed: any tracked pair may have changed or gone. */
    onTrafficChanged() {
      const now = tracked();
      for (const id of Object.keys(rows)) if (!now.has(id)) stale.add(id);
      if (trackers.size) refresh();
    },

    /** traffic.response, metadata.updated, note.updated and note.deleted, for one pair. */
    onPairEvent({ id } = {}) {
      if (id == null) return;
      if (tracked().has(String(id))) refresh([id]);
      else if (String(id) in rows) stale.add(String(id));
    },

    /**
     * streamed_pair.started, .updated or .ended ({ ID, Streamed }): the
     * event carries the pair's whole streamed state, so a held row takes it
     * without a read.
     */
    onStreamedPair({ ID, Streamed } = {}) {
      const id = String(ID);
      if (ID == null || !rows[id]) return;
      rows = { ...rows, [id]: { ...rows[id], Streamed } };
      store.set(rows);
    },

    /** Forgets the last project's rows. */
    clear() {
      generation++;
      clearTimeout(timer);
      pendingAll = false;
      pendingIds.clear();
      stale.clear();
      rows = {};
      store.set(rows);
    },

    /** Reads every tracked pair afresh; the trackers stay. */
    load: readTracked,
    resync: readTracked,
  };
}
