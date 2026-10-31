// Keeps the window's event stream on the instance it is connected to, and
// reloads the stores when the stream reopens (marasiEvents.js wires both up).
import { isNotPorted } from "./bindings/notPorted.js";

/**
 * Opens a stream with `startStream(eventsURL)` on the connection in
 * `windowConnection` (the window connection store), stops it when the
 * connection ends or moves, and opens one on the new one. Returns a stop.
 */
export function followConnection(windowConnection, startStream) {
  let stream = null;
  let baseURL = null;
  const unsubscribe = windowConnection.subscribe(({ connection }) => {
    const next = connection?.baseURL ?? null;
    if (next === baseURL) return;
    stream?.stop();
    stream = null;
    baseURL = next;
    if (baseURL) stream = startStream(`${baseURL}/events`);
  });
  return () => {
    unsubscribe();
    stream?.stop();
    stream = null;
    baseURL = null;
  };
}

/**
 * Calls every store's reload() and waits for them all. A failed reload is
 * logged with `log.error`, except a store whose bindings aren't ported yet.
 */
export async function reloadStores(stores, log = console) {
  const results = await Promise.allSettled(stores.map((store) => store.reload()));
  for (const result of results) {
    if (result.status === "rejected" && !isNotPorted(result.reason)) {
      log.error("Reloading after the event stream reopened failed:", result.reason);
    }
  }
}
