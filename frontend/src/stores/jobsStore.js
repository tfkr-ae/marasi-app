// The app's background-jobs store over the service client. The logic lives
// in createJobsStore.js and the API shapes in jobsApi.js. When the
// Ledger or the sitemap reads incomplete results, the store polls the jobs
// and reloads that view once they finish, so its notice goes away.
import { service } from "../lib/service/index.js";
import { createJobsApi, progressJob } from "./jobsApi.js";
import { createJobsStore } from "./createJobsStore.js";
import { projectData } from "./projectData.js";
import { ledgerStore } from "./ledgerStore";
import { sitemapStore } from "./sitemapStore";

export { groupBuilding, jobLabel, jobStatus } from "./createJobsStore.js";

export const jobsStore = createJobsStore(
  createJobsApi(service),
  {
    onFinished: (group) => {
      // refresh() keeps the view where it is.
      if (group === "index") ledgerStore.refresh();
      if (group === "sitemap") sitemapStore.reload();
    },
  },
);

projectData.register("jobs", { clear: jobsStore.clear, load: jobsStore.refresh });
// A finished job shows at once, without waiting for the next poll.
service.on("job.complete", () => jobsStore.refresh());
// A running job's progress shows as it goes, as Settings → Maintenance lists it.
service.on("job.progress", (progress) => jobsStore.onProgress(progressJob(progress)));

ledgerStore.subscribe((state) => {
  if (!state.results.loading && state.results.indexComplete === false) jobsStore.watch("index");
});
sitemapStore.subscribe((state) => {
  if (state.complete === false) jobsStore.watch("sitemap");
});
