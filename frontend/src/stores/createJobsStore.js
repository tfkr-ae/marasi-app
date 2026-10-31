// The open project's Marasi background jobs (search index, sitemap, moving
// prettified copies, the dashboard's intercepted count), for Settings → Maintenance and the Ledger's notices.
// The store reads ListJobs, then follows Marasi's job.progress and
// job.complete events; the event stream's reload reads the jobs again for
// the events it missed. Backend calls go through the injected `api`, so
// tests run against a fake:
//
//   listJobs() -> [{ Name, Complete, Done, Total, Rebuildable }]
//   rebuildJob(name)
//
// A view that read incomplete results calls watch(group); once the group's
// jobs are complete, onFinished(group) tells it to read again.
import { get, writable } from "svelte/store";

/** The jobs behind each notice and Rebuild button. */
export const JOB_GROUPS = {
  index: ["traffic_index", "annotation_index"],
  sitemap: ["sitemap"],
  prettified: ["prettified_move"],
  intercepted: ["intercepted_count"],
};

const JOB_NAMES = {
  traffic_index: "Search index: traffic",
  annotation_index: "Search index: notes and metadata",
  sitemap: "Sitemap",
  prettified_move: "Formatted bodies",
  intercepted_count: "Intercepted count",
};

/** A job's display name. */
export function jobLabel(name) {
  return JOB_NAMES[name] ?? name;
}

/** "Complete", "Building", or "Building · done of total". */
export function jobStatus(job) {
  if (job.Complete) return "Complete";
  if (!job.Total) return "Building";
  const n = (value) => Number(value).toLocaleString();
  return `Building · ${n(job.Done)} of ${n(job.Total)}`;
}

/** True when any of the group's jobs is known to be incomplete. */
export function groupBuilding(state, group) {
  const names = JOB_GROUPS[group] ?? [];
  return state.jobs.some((job) => names.includes(job.Name) && !job.Complete);
}

export function createJobsStore(api, { onFinished = () => {} } = {}) {
  const initial = () => ({ jobs: [], loaded: false, error: "", rebuilding: null });
  const store = writable(initial());

  let generation = 0;
  // Groups a view saw incomplete and waits on.
  const watched = new Set();

  // Tells each view whose group is now complete.
  function finishWatched() {
    for (const group of [...watched]) {
      if (!groupBuilding(get(store), group)) {
        watched.delete(group);
        onFinished(group);
      }
    }
  }

  // The job changes each read in flight has missed: an event that arrives
  // while a read is answered may be newer than the answer.
  const reads = new Set();

  // `jobs` with `change` applied to the named job.
  const changed = (jobs, { name, change }) =>
    jobs.map((job) => (job.Name === name ? { ...job, ...change } : job));

  /** Reads the jobs. */
  async function refresh() {
    const asked = generation;
    const arrived = [];
    reads.add(arrived);
    let jobs;
    try {
      jobs = (await api.listJobs()) ?? [];
    } catch (error) {
      if (asked !== generation) return;
      store.update((s) => ({ ...s, error: String(error?.message ?? error) }));
      return;
    } finally {
      reads.delete(arrived);
    }
    if (asked !== generation) return;
    store.update((s) => ({ ...s, jobs: arrived.reduce(changed, jobs), loaded: true, error: "" }));
    finishWatched();
  }

  // Applies `change` to the named job, if the store has read it.
  function updateJob(name, change) {
    for (const arrived of reads) arrived.push({ name, change });
    store.update((s) => ({ ...s, jobs: changed(s.jobs, { name, change }) }));
  }

  /** A job.progress event: {name, project, done, total}. */
  function onJobProgress({ name, done, total }) {
    updateJob(name, { Complete: false, Done: done, Total: total });
  }

  /** A job.complete event: {name, project}. */
  function onJobComplete({ name }) {
    updateJob(name, { Complete: true });
    finishWatched();
  }

  /** A view read incomplete results for `group`; tell it when they finish. */
  function watch(group) {
    if (watched.has(group)) return;
    watched.add(group);
    refresh();
  }

  /** Rebuilds a group's jobs ("index" or "sitemap") and follows them. */
  async function rebuild(group) {
    store.update((s) => ({ ...s, rebuilding: group, error: "" }));
    try {
      for (const name of JOB_GROUPS[group]) await api.rebuildJob(name);
    } finally {
      store.update((s) => ({ ...s, rebuilding: null }));
    }
    watched.add(group);
    await refresh();
  }

  /** Forgets the project's jobs, on a project switch. */
  function clear() {
    generation += 1;
    watched.clear();
    reads.clear();
    store.set(initial());
  }

  // reload reads the jobs again, after the event stream reopens.
  return {
    subscribe: store.subscribe,
    refresh,
    reload: refresh,
    onJobProgress,
    onJobComplete,
    watch,
    rebuild,
    clear,
  };
}
