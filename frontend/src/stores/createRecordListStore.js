// The open project's findings or test cases, which follow Marasi's events:
// a record any client changed is read again, one deleted leaves the list.
// `api.list()` reads every record; `api.read(id)` reads one, or null when it
// is gone.
import { writable } from "svelte/store";

export function createRecordListStore(api) {
  const { subscribe, set, update } = writable([]);
  // A clear or a read of the whole list starts a new generation; a record's
  // read from an older one is dropped.
  let generation = 0;
  // The latest read of each record by number; an older reply is dropped.
  const reads = new Map();
  let readSeq = 0;

  async function populate() {
    const at = ++generation;
    const records = await api.list();
    if (at === generation) set(records ?? []);
  }

  function clear() {
    generation++;
    set([]);
  }

  /** Reads the record with `id` again: it changed, or joined the project. */
  async function onChanged(id) {
    const at = generation;
    const seq = ++readSeq;
    reads.set(id, seq);
    const record = await api.read(id);
    if (at !== generation || reads.get(id) !== seq) return;
    reads.delete(id);
    update((records) => {
      if (!record) return records.filter((r) => r.ID !== id);
      // A new record goes first, as v1 put a created one.
      if (!records.some((r) => r.ID === id)) return [record, ...records];
      return records.map((r) => (r.ID === id ? record : r));
    });
  }

  /** The record with `id` was deleted. A read of it on its way is dropped. */
  function onDeleted(id) {
    reads.set(id, ++readSeq);
    update((records) => records.filter((r) => r.ID !== id));
  }

  /** The artifact with `id` was deleted, from whichever record holds it. */
  const onArtifactDeleted = (id) =>
    update((records) =>
      records.map((r) =>
        (r.Artifacts ?? []).some((a) => a.ID === id) ? { ...r, Artifacts: r.Artifacts.filter((a) => a.ID !== id) } : r,
      ),
    );

  return {
    subscribe,
    set,
    update,
    populate,
    // Reads the whole list again, after the event stream reopens.
    reload: populate,
    clear,
    onChanged,
    onDeleted,
    onArtifactDeleted,
  };
}
