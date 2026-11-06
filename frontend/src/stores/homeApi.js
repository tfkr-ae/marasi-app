// Home's api over the service client: each call reads a control API route
// and maps its snake_case answer to the shape createHomeStore keeps, which
// is what Dashboard.svelte and LogTable.svelte read. The mappers for stream
// events (toLog, toListener) live here too, so one file knows the API's
// shapes.

/** The most log lines Home reads at once (the service's page limit). */
export const LOG_LIMIT = 500;

/** A log line, from GET /logs or log.added, in the log table's fields. */
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

/**
 * The proxy listener as `{status, address, port}` from its "host:port"
 * address (null when it's off).
 */
export function toListener(proxyListener) {
  if (!proxyListener) return { status: false, address: "", port: "" };
  const colon = proxyListener.lastIndexOf(":");
  return {
    status: true,
    address: proxyListener.slice(0, colon).replace(/^\[(.*)\]$/, "$1"),
    port: proxyListener.slice(colon + 1),
  };
}

export function createHomeApi(client) {
  return {
    async dashboard() {
      const d = await client.get("/dashboard");
      return {
        requests: d.pairs,
        notes: d.notes,
        launchpads: d.launchpads,
        intercepted: d.intercepted,
        interceptedComplete: d.intercepted_count?.complete !== false,
      };
    },
    async scope() {
      const s = await client.get("/scope");
      return { defaultAllow: s.default_allow, includeCount: s.include.length, excludeCount: s.exclude.length };
    },
    // Newest first from the service; oldest first for the table.
    async logs() {
      const page = await client.get("/logs", { limit: LOG_LIMIT });
      return (page.items ?? []).map(toLog).reverse();
    },
    async extensionNames() {
      const list = await client.get("/extension");
      return Object.fromEntries((list.items ?? []).map((ext) => [ext.id, ext.name]));
    },
    async listener() {
      const status = await client.get("/listener/status");
      return toListener(status.status === "active" ? status.proxy_listener : null);
    },
  };
}
