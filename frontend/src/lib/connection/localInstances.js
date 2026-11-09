// The instances the Marasi CLI lists on this machine (Go's LocalInstances),
// as the add form offers them: the ones no saved local connection names yet.

/** Listed instances that no local connection in `connections` names. */
export function unsavedInstances(instances, connections) {
  const saved = new Set(
    (connections ?? []).filter((c) => c.kind === "local").map((c) => c.instance || "default"),
  );
  return (instances ?? []).filter((i) => i.instance && !saved.has(i.instance));
}

/** A listener's port ("127.0.0.1:8080" → 8080), or 0 when it has none. */
export function listenerPort(listener) {
  const port = Number(String(listener ?? "").split(":").pop());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

/** A project path's file name without `.marasi`. */
export function projectName(path) {
  const file = String(path ?? "").split(/[\\/]/).pop();
  return file.replace(/\.marasi$/, "");
}

/** What a listed instance adds as: named for it, on its current proxy port. */
export const connectionFor = (instance) => ({
  name: instance.instance,
  instance: instance.instance,
  port: listenerPort(instance.proxy_listener),
});
