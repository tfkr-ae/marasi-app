// The raw messages of the pairs on a drawing's cards, which a card needs for
// its first lines and a Drawing's Artifact for its images. A store of
// { <pair id>: { Request, Response } (LF line endings, Response "" while
// the pair has none), or null once the pair is deleted }; an id not read
// yet is absent. A card asks with need(id, row) when it shows; a pair read
// while pending is read again once its row shows a response.
//
// `createPairRawStore(api)` takes createToolTrafficApi's api; the app's
// instance and its projectData entry are in pairRawStore.js.
import { writable } from "svelte/store";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";

export function createPairRawStore(api) {
  const store = writable({});
  let held = {};
  // Reads under way, by id, so a card shown twice reads once.
  const reading = new Map();
  // Bumped by clear(), so a read under way for the last project writes nothing.
  let generation = 0;

  function read(id) {
    if (reading.has(id)) return reading.get(id);
    const mine = generation;
    const action = boundAction(api.bind?.());
    const done = action
      .step(() => api.readRaw(id))
      .then(
        (raw) => {
          if (mine !== generation) return;
          held = { ...held, [id]: raw };
          store.set(held);
        },
        (err) => {
          if (!isSuperseded(err)) console.error("reading a card's pair:", err);
        },
      )
      .finally(() => {
        if (reading.get(id) === done) reading.delete(id);
      });
    reading.set(id, done);
    return done;
  }

  return {
    subscribe: store.subscribe,

    /**
     * Pair `id`'s card shows, with the pair's `row` now: reads its raw
     * messages unless held, or again when they were read before its
     * response arrived and the row now shows one.
     */
    need(id, row) {
      const key = String(id);
      const raw = held[key];
      if (raw === undefined) read(key);
      else if (raw && !raw.Response && Number(row?.StatusCode) > 0) read(key);
    },

    /** Reads every pair in `ids` not held yet; resolves once all are. */
    async ensure(ids) {
      await Promise.all(ids.map(String).filter((id) => held[id] === undefined).map(read));
    },

    /** Forgets the last project's messages. */
    clear() {
      generation++;
      reading.clear();
      held = {};
      store.set(held);
    },
  };
}
