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
 * Where the listener starts: the running listener, else the last active
 * listener in this session, else the app's default listener
 * (default_address, default_port).
 */
export function listenerStart(listener, config, lastListener = null) {
  if (listener?.status) return { address: listener.address, port: listener.port };
  if (lastListener?.address && lastListener?.port) {
    return { address: lastListener.address, port: String(lastListener.port) };
  }
  return { address: config?.DefaultAddress || "127.0.0.1", port: config?.DefaultPort || "8080" };
}
