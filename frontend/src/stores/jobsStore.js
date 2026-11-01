// The app's background-jobs store, bound to the Wails backend. The logic
// lives in createJobsStore.js, which tests load with a fake API. When the
// Ledger or the sitemap reads incomplete results, the store polls the jobs
// and reloads that view once they finish, so its notice goes away.
import { ListJobs, RebuildJob } from "../lib/wailsjs/go/main/App";
import { createJobsStore } from "./createJobsStore.js";
import { ledgerStore } from "./ledgerStore";
import { sitemapStore } from "./sitemapStore";

export { groupBuilding, jobLabel, jobStatus } from "./createJobsStore.js";

export const jobsStore = createJobsStore(
  {
    listJobs: () => ListJobs(),
    rebuildJob: (name) => RebuildJob(name),
  },
  {
    onFinished: (group) => {
      // refresh() keeps the view where it is.
      if (group === "index") ledgerStore.refresh();
      if (group === "sitemap") sitemapStore.reload();
    },
  },
);

ledgerStore.subscribe((state) => {
  if (!state.results.loading && state.results.indexComplete === false) jobsStore.watch("index");
});
sitemapStore.subscribe((state) => {
  if (state.complete === false) jobsStore.watch("sitemap");
});
