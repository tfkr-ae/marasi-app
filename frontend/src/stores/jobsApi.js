// The jobs store's api over the service client, in the shape createJobsStore
// reads: GET /jobs's {name, complete, done, total} as {Name, Complete, Done,
// Total, Rebuildable}.

/** The jobs the service rebuilds; it refuses the rest with not_rebuildable. */
export const REBUILDABLE_JOBS = new Set(["traffic_index", "annotation_index", "sitemap"]);

/** A job from GET /jobs, in the store's fields. */
export function toJob(job) {
  return {
    Name: job.name,
    Complete: job.complete,
    Done: job.done ?? 0,
    Total: job.total ?? 0,
    Rebuildable: REBUILDABLE_JOBS.has(job.name),
  };
}

export function createJobsApi(client) {
  return {
    async listJobs() {
      const answer = await client.get("/jobs");
      return (answer?.items ?? []).map(toJob);
    },
    rebuildJob: (name) => client.post(`/jobs/${encodeURIComponent(name)}/rebuild`),
  };
}
