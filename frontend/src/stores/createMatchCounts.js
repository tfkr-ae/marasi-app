// Match counts for a menu's queries, read in the background so the menu
// opens with its numbers. The store holds { [query]: count }: { count,
// capped }, { error } for a query Marasi rejects, or null when it couldn't
// be counted; `stale: true` marks the last run's count while a recount
// reads its new one. A query without an entry hasn't been counted yet.
// The Saved queries, Highlights and Marks menus each keep one.
import { writable } from "svelte/store";

// How many queries count at once: enough that a menu fills fast, few enough
// that the Ledger's own reads aren't held up.
const CONCURRENCY = 4;
// How long schedule waits, so a burst of traffic or edits counts once.
export const COUNT_DELAY_MS = 1500;

/**
 * `queries()` lists the queries to count at the start of each run;
 * `count(query)` resolves to { count, capped }, { error } or null, and a
 * count that throws shows as null.
 */
export function createMatchCounts({ queries, count, timers = globalThis, delay = COUNT_DELAY_MS }) {
  const { subscribe, update } = writable({});

  let run = 0;
  /**
   * Counts every query, CONCURRENCY at a time, filling the store as each
   * returns. The last run's counts stay, marked stale, until their new ones
   * arrive, so a recount never blanks a number; a query no longer listed
   * loses its count. A newer load, or clear, stops this one.
   */
  async function load() {
    const thisRun = ++run;
    const list = [...new Set(queries())];
    update((counts) =>
      Object.fromEntries(list.filter((q) => counts[q]).map((q) => [q, { ...counts[q], stale: true }])),
    );
    let next = 0;
    async function worker() {
      while (next < list.length && thisRun === run) {
        const query = list[next++];
        let result = null;
        try {
          result = (await count(query)) ?? null;
        } catch (error) {
          console.error(`counting ${query}:`, error);
        }
        if (thisRun !== run) return;
        update((counts) => ({ ...counts, [query]: result }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  }

  let pending = null;
  /**
   * Loads after `delay`, once for a burst of calls: a project load, a
   * resync, new traffic or another client's change, so the menu opens with
   * numbers.
   */
  function schedule() {
    if (pending !== null) return;
    pending = timers.setTimeout(() => {
      pending = null;
      load();
    }, delay);
  }

  /** Forgets every count and stops counting, as a project switch does. */
  function clear() {
    run++;
    if (pending !== null) timers.clearTimeout(pending);
    pending = null;
    update(() => ({}));
  }

  return { subscribe, load, schedule, clear };
}
