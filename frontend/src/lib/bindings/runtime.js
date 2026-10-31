// The parts of the Wails runtime the frontend uses. The main process's own
// events (the updater's) arrive through the preload's `onUpdateEvent`.
// Marasi's events arrive on the connection's event stream
// (lib/marasiEvents.js), so a subscription to any other name hears nothing,
// and the window and browser calls use the page.

// The events the main process sends, by name.
const mainEvents = new Set(["update-available", "update-progress", "update-installed", "update-failed"]);
const listeners = new Map();
let following = false;

// Follows the main process's events once, the first time one is wanted.
function followMain() {
  const onEvent = globalThis.window?.marasiApp?.onUpdateEvent;
  if (following || !onEvent) return;
  following = true;
  onEvent((name, payload) => {
    for (const callback of [...(listeners.get(name) ?? [])]) callback(payload);
  });
}

/** Subscribes `callback` to the event `name`; returns its unsubscribe. */
export function EventsOn(name, callback) {
  if (!mainEvents.has(name)) return () => {};
  followMain();
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(callback);
  return () => listeners.get(name)?.delete(callback);
}

/** Subscribes `callback` to the next event `name`; returns its unsubscribe. */
export function EventsOnce(name, callback) {
  const stop = EventsOn(name, (payload) => {
    stop();
    callback(payload);
  });
  return stop;
}

/** Unsubscribes every callback from the events `names`. */
export function EventsOff(...names) {
  for (const name of names) listeners.delete(name);
}

/** Sends the event `name` to the backend: nothing listens. */
export function EventsEmit(name, ...data) {}

/** Names the window. */
export function WindowSetTitle(title) {
  document.title = title;
}

/** Opens `url` in the default browser: the main process sends new windows there. */
export function BrowserOpenURL(url) {
  window.open(url, "_blank", "noopener");
}
