// The listener modal's interfaces are the service host's (GET
// /listener/interfaces), so a remote connection offers the remote's
// addresses. IPv4 comes first, as the service lists them.

/** The service host's addresses. */
export async function listenerAddresses(client) {
  const answer = await client.get("/listener/interfaces");
  return (answer?.items ?? []).map((item) => item.address);
}

/** The index of `address` in `list`, or 0 when it isn't there. */
export function startingInterface(list, address) {
  return Math.max(0, list.indexOf(address));
}

/**
 * Where the listener modal starts: the running listener, or the app's
 * default listener (default_address, default_port) when it is off.
 */
export function listenerStart(listener, config) {
  if (listener?.status) return { address: listener.address, port: listener.port };
  return { address: config?.DefaultAddress || "127.0.0.1", port: config?.DefaultPort || "8080" };
}
