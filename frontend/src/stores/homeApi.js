// Home's api over the service client: each call reads a control API route
// and maps its snake_case answer to the shape createHomeStore keeps, which
// is what Home's Overview (lib/home/) reads. The mappers for stream events
// (toListener, toScope) live here too, so one file knows the API's shapes.

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

/** GET /scope, or a scope.updated event, as Home's rule counts. */
export function toScope(s) {
  return { defaultAllow: s.default_allow, includeCount: s.include?.length ?? 0, excludeCount: s.exclude?.length ?? 0 };
}

/** The status classes Home breaks responses down by, in order. */
export const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"];

/** No responses in any status class. */
export const noStatusClasses = () => Object.fromEntries(STATUS_CLASSES.map((key) => [key, 0]));

/**
 * GET /traffic/count/by-field?field=status_code's `items` as the pairs per
 * status class, by the code's first digit. Other values (1xx, no response
 * yet, anything not a code) count in no class.
 */
export function toStatusClasses(items) {
  const classes = noStatusClasses();
  for (const { value, count } of items ?? []) {
    const key = /^[2-5]\d\d$/.test(String(value)) ? `${String(value)[0]}xx` : null;
    if (key) classes[key] += count;
  }
  return classes;
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
    async statusClasses() {
      const counts = await client.get("/traffic/count/by-field", { field: "status_code" });
      return toStatusClasses(counts.items);
    },
    async scope() {
      return toScope(await client.get("/scope"));
    },
    async listener() {
      const status = await client.get("/listener/status");
      return toListener(status.status === "active" ? status.proxy_listener : null);
    },
    // Starts the proxy listener on address:port, or moves it there when it
    // runs, and returns the listener the service reports.
    async setListener(address, port, active) {
      const call = client.bind?.() ?? client;
      const status = await call.post(active ? "/listener/update" : "/listener/start", {
        address,
        port: Number(port),
      });
      return toListener(status.status === "active" ? status.proxy_listener : null);
    },
    // Stops the proxy listener without stopping the service.
    async stopListener() {
      const call = client.bind?.() ?? client;
      const status = await call.post("/listener/stop");
      return toListener(status?.status === "active" ? status.proxy_listener : null);
    },
  };
}
