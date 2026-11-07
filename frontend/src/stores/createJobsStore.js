// The open project's Marasi background jobs (search index, sitemap, moving
// prettified copies, the dashboard's intercepted count), for Settings → Maintenance and the Ledger's notices.
// The store polls the jobs while one is incomplete and stops once every job
// is done; jobsStore.js also reads them on the service's job.complete. Backend calls go
// through the injected `api`, so tests run against a fake:
//
//   listJobs() -> [{ Name, Complete, Done, Total, Rebuildable }]
//   rebuildJob(name)
//
// A view that read incomplete results calls watch(group); once the group's
// jobs are complete, onFinished(group) tells it to read again.
import { writable } from "svelte/store";

/** How often the jobs are read while one runs. */
export const POLL_MS = 2000;

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

const realTimer = {
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle),
};

export function createJobsStore(api, { timer = realTimer, onFinished = () => {} } = {}) {
  const initial = () => ({ jobs: [], loaded: false, error: "", rebuilding: null });
  const store = writable(initial());
  let state = initial();
  store.subscribe((value) => (state = value));

  let pending = null;
  let generation = 0;
  // Groups a view saw incomplete and waits on.
  const watched = new Set();

  function schedule() {
    if (pending) timer.cancel(pending);
    pending = timer.schedule(() => {
      pending = null;
      return refresh();
    }, POLL_MS);
  }

  /** Reads the jobs; polls again while one runs or a read failed. */
  async function refresh() {
    const asked = generation;
    let jobs;
    try {
      jobs = (await api.listJobs()) ?? [];
    } catch (error) {
      if (asked !== generation) return;
      store.update((s) => ({ ...s, error: String(error?.message ?? error) }));
      schedule();
      return;
    }
    if (asked !== generation) return;
    store.update((s) => ({ ...s, jobs, loaded: true, error: "" }));
    for (const group of [...watched]) {
      if (!groupBuilding(state, group)) {
        watched.delete(group);
        onFinished(group);
      }
    }
    if (jobs.some((job) => !job.Complete)) schedule();
    else if (pending) {
      timer.cancel(pending);
      pending = null;
    }
  }

  /** A view read incomplete results for `group`; tell it when they finish. */
  function watch(group) {
    watched.add(group);
    if (!pending) schedule();
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

  /** A job.progress: the running `job` replaces its row, or joins the list. */
  function onProgress(job) {
    store.update((s) => {
      const listed = s.jobs.some((j) => j.Name === job.Name);
      return { ...s, jobs: listed ? s.jobs.map((j) => (j.Name === job.Name ? job : j)) : [...s.jobs, job] };
    });
  }

  /** Forgets the project's jobs, on a project switch. */
  function clear() {
    generation += 1;
    watched.clear();
    if (pending) timer.cancel(pending);
    pending = null;
    store.set(initial());
  }

  return { subscribe: store.subscribe, refresh, watch, rebuild, onProgress, clear };
}
