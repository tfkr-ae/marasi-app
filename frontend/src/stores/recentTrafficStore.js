// The recent-traffic store, bound to the Wails backend. The logic lives in
// createRecentTrafficStore.js, which tests load with a fake API.
import { QueryTraffic } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { createRecentTrafficStore, RECENT_TRAFFIC_FLUSH_MS } from "./createRecentTrafficStore.js";

export const recentTraffic = createRecentTrafficStore({
  queryTraffic: (request) => QueryTraffic(request),
});

if (typeof window !== "undefined") {
  setInterval(recentTraffic.flush, RECENT_TRAFFIC_FLUSH_MS);
}
