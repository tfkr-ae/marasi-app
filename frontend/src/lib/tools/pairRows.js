// The current rows of the pairs on cards, kept live from the service's
// traffic events. A store of { <pair id>: row, or null once the pair is
// deleted }; an id not read yet is absent, and its card shows the row it
// carries (customData.last).
//
// `createPairRows({ read(query) → rows, on(event, handler) → unsubscribe })`
// reads with a Marasi traffic query (`id = "<id>" OR …`); `pairRows` below
// binds it to the service client.
import { writable } from "svelte/store";

const CHUNK = 50;

export function createPairRows({ read, on, settleMs = 150 }) {
  const store = writable({});
  const trackers = new Set();
  let rows = {};
  let unsubscribe = [];
  let timer = null;
  let pendingAll = false;
  const pendingIds = new Set();

  const tracked = () => new Set([...trackers].flatMap((ids) => [...ids]));

  async function readRows(ids) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      let found;
      try {
        found = await read(chunk.map((id) => `id = ${JSON.stringify(String(id))}`).join(" OR "));
      } catch (err) {
        console.error("reading card pairs:", err);
        continue;
      }
      const byId = new Map(found.map((row) => [String(row.ID), row]));
      rows = { ...rows };
      for (const id of chunk) rows[id] = byId.get(String(id)) ?? null;
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

  const forTracked = ({ id } = {}) => {
    if (id != null && tracked().has(String(id))) refresh([id]);
  };

  function listen() {
    unsubscribe = [
      on("traffic.changed", () => refresh()),
      on("traffic.response", forTracked),
      on("metadata.updated", forTracked),
      on("note.updated", forTracked),
      on("note.deleted", forTracked),
    ];
  }

  return {
    subscribe: store.subscribe,
    /** Keeps `ids` live until the returned stop is called. */
    track(ids) {
      const mine = new Set(ids.map(String));
      if (!trackers.size) listen();
      trackers.add(mine);
      const unread = [...mine].filter((id) => !(id in rows));
      if (unread.length) readRows(unread);
      return () => {
        if (!trackers.delete(mine)) return;
        if (!trackers.size) {
          clearTimeout(timer);
          unsubscribe.forEach((stop) => stop?.());
          unsubscribe = [];
        }
      };
    },
  };
}
