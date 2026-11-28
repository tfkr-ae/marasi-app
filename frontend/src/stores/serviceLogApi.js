// The Service log's api over the service client: the service's own log, the
// extensions' names its lines carry, and the number of the pair a line
// names. toLog maps both GET /logs and the log.added event.
import { NO_BODIES, pairQuery } from "./trafficApi.js";

/** The most log lines the Service log reads at once (the service's page limit). */
export const LOG_LIMIT = 500;

/** A log line, from GET /logs or log.added, in the Service log's fields. */
export function toLog(log) {
  return {
    ID: log.id,
    Timestamp: log.timestamp,
    Level: log.level,
    Message: log.message,
    Context: log.context ?? {},
    RequestID: log.request_id ?? null,
    ExtensionID: log.extension_id ?? null,
  };
}

export function createServiceLogApi(client) {
  return {
    // Newest first from the service; oldest first for the drawer.
    async logs() {
      const page = await client.get("/logs", { limit: LOG_LIMIT });
      return (page.items ?? []).map(toLog).reverse();
    },
    async extensionNames() {
      const list = await client.get("/extension");
      return Object.fromEntries((list.items ?? []).map((ext) => [ext.id, ext.name]));
    },
    // The pair's number, without its bodies.
    async pairNumber(id) {
      const pair = await client.get(`/traffic/${id}`, pairQuery(NO_BODIES));
      return pair?.number ?? null;
    },
  };
}
