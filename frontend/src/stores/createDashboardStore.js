// Home's dashboard counts: requests, notes, launchpads and intercepted, as
// CountNotes reads them. While Marasi's intercepted_count job still counts
// the pairs captured before the project kept the count, the intercepted
// figure is a floor, so the store reads again on that job's job.complete.
import { get, writable } from "svelte/store";

/**
 * The dashboard store. `api` is `{countNotes()}`, resolving `{Requests,
 * Notes, Launchpads, Interceptions, InterceptionsComplete}`.
 */
export function createDashboardStore(api) {
  const store = writable({ loading: true, counts: null });
  // Each read's number, so an older one's answer is dropped.
  let reads = 0;
  // The read in flight, whose answer may predate a job.complete.
  let reading = null;

  /** Reads the counts again; a newer read wins over a slower older one. */
  function reload() {
    reading = read();
    return reading;
  }

  async function read() {
    const asked = ++reads;
    store.update((state) => ({ ...state, loading: true }));
    try {
      const counts = await api.countNotes();
      if (asked === reads) store.set({ loading: false, counts });
    } catch (error) {
      if (asked === reads) store.update((state) => ({ ...state, loading: false }));
      throw error;
    }
  }

  /** A job.complete event: {name, project}. */
  async function onJobComplete({ name }) {
    if (name !== "intercepted_count") return;
    await reading?.catch(() => {});
    if (get(store).counts?.InterceptionsComplete !== false) return;
    await reload();
  }

  return { subscribe: store.subscribe, reload, onJobComplete };
}
