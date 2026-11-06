// The app's sitemap store over the service client, following the Ledger
// store. The logic lives in createSitemapStore.js and the API shapes in
// sitemapApi.js.
import { service } from "../lib/service/index.js";
import { createSitemapStore } from "./createSitemapStore.js";
import { createSitemapApi } from "./sitemapApi.js";
import { FLUSH_INTERVAL_MS } from "./createLedgerStore.js";
import { contentTypeExclusion, ledgerStore } from "./ledgerStore";
import { toRequestEvent, toResponseEvent } from "./trafficApi.js";
import { projectData } from "./projectData.js";

export { hostCountLabel, sitemapRows, sitemapScope, STEP, WINDOW } from "./createSitemapStore.js";

export const sitemapStore = createSitemapStore(createSitemapApi(service, { exclusion: contentTypeExclusion }));

// The sitemap reads once the Ledger's context is ready (below), so a load
// only clears it; a resync reads the open levels again in place.
projectData.register("sitemap", {
  clear: sitemapStore.clear,
  load: async () => {},
  resync: () => sitemapStore.reload(),
});

service.on("traffic.request", (data) => sitemapStore.onRequest(toRequestEvent(data)));
service.on("traffic.response", (data) => sitemapStore.onResponse(toResponseEvent(data)));

// The running query, its results' as_of and the exclusion, which each read
// passes along. The sitemap waits for the ledger's first rows, so it never
// delays them, and for the project's exclusion.
ledgerStore.subscribe((state) =>
  sitemapStore.setContext({
    query: state.query.ranQuery,
    asOf: state.results.asOf,
    exclusion: state.exclusion,
    ready: !state.results.loading && state.exclusionLoaded,
  }),
);

if (typeof window !== "undefined") {
  setInterval(sitemapStore.flush, FLUSH_INTERVAL_MS);
}
