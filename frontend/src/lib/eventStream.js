// The window's one event stream: an EventSource on the connected instance's
// /events. The main process adds the control token to its request, as it
// does to every call (lib/bindings/marasi.js). Marasi doesn't replay events,
// so after the stream drops and opens again the window reloads what it
// shows.

/** How long to wait before each reopen in a row, the last one repeating. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

const realTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

/**
 * Follows the event stream at `url`. Each event's JSON payload goes to
 * `handlers[name]`. When the stream drops, it reopens after a growing
 * delay, and calls `onReconnect` once it is open again. Returns `{stop}`.
 */
export function createEventStream({
  url,
  handlers,
  onReconnect = () => {},
  EventSource = globalThis.EventSource,
  timer = realTimer,
}) {
  let source = null;
  let reopenTimer = null;
  // The drops since the stream was last open, which pick the next delay.
  let drops = 0;
  let wasOpen = false;
  let stopped = false;

  function open() {
    reopenTimer = null;
    source = new EventSource(url);
    source.addEventListener("open", () => {
      drops = 0;
      if (wasOpen) onReconnect();
      wasOpen = true;
    });
    // EventSource reopens on its own only after some failures, and with no
    // backoff, so the stream closes it and reopens itself.
    source.addEventListener("error", () => {
      source.close();
      if (stopped) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(drops, RECONNECT_DELAYS_MS.length - 1)];
      drops++;
      reopenTimer = timer.set(open, delay);
    });
    for (const [name, handler] of Object.entries(handlers)) {
      source.addEventListener(name, (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          console.error(`Reading the ${name} event failed:`, err);
          return;
        }
        handler(payload);
      });
    }
  }

  open();

  return {
    /** Closes the stream for good. */
    stop() {
      stopped = true;
      if (reopenTimer !== null) timer.clear(reopenTimer);
      reopenTimer = null;
      source?.close();
    },
  };
}
