// Match counts for a menu's queries, read after a project load so the menu
// opens with numbers, and again while it is open; a change while it is
// closed only marks them stale until it opens. The store holds { [query]: count }: { count,
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
  let scheduledRun = null;
  let again = false;
  /**
   * Loads after `delay`, once for a burst of calls, such as a project load or
   * a resync, so the menu opens with numbers. A scheduled load never stops one
   * already running: a call meanwhile waits for it to finish, then for
   * `delay` again, so steady traffic can't keep every run from finishing.
   */
  function schedule() {
    if (scheduledRun) {
      again = true;
      return;
    }
    if (pending !== null) return;
    pending = timers.setTimeout(() => {
      pending = null;
      const thisRun = load();
      scheduledRun = thisRun;
      thisRun.finally(() => {
        if (scheduledRun !== thisRun) return;
        scheduledRun = null;
        if (again) {
          again = false;
          schedule();
        }
      });
    }, delay);
  }

  let open = false;
  /** Whether the menu showing the counts is open; only an open menu recounts on a change. */
  function setOpen(value) {
    open = Boolean(value);
  }

  /**
   * After new traffic or another client's change: every count is marked
   * stale, and only an open menu recounts. A closed menu recounts when it
   * opens, so counts nobody is looking at never keep Marasi busy.
   */
  function changed() {
    update((counts) =>
      Object.fromEntries(Object.entries(counts).map(([q, c]) => [q, c && !c.stale ? { ...c, stale: true } : c])),
    );
    if (open) schedule();
  }

  /** Forgets every count and stops counting, as a project switch does. */
  function clear() {
    run++;
    if (pending !== null) timers.clearTimeout(pending);
    pending = null;
    scheduledRun = null;
    again = false;
    update(() => ({}));
  }

  return { subscribe, load, schedule, changed, setOpen, clear };
}
