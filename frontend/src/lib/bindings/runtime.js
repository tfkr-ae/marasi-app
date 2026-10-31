// The parts of the Wails runtime the frontend uses. Marasi's events arrive
// on the connection's event stream once it is ported, so until then a
// subscription hears nothing, and the window and browser calls use the page.

const unsubscribe = () => {};

/** Subscribes `callback` to the event `name`; returns its unsubscribe. */
export function EventsOn(name, callback) {
  return unsubscribe;
}

/** Subscribes `callback` to the next event `name`; returns its unsubscribe. */
export function EventsOnce(name, callback) {
  return unsubscribe;
}

/** Unsubscribes every callback from the events `names`. */
export function EventsOff(...names) {}

/** Sends the event `name` to the backend: nothing listens yet. */
export function EventsEmit(name, ...data) {}

/** Names the window. */
export function WindowSetTitle(title) {
  document.title = title;
}

/** Opens `url` in the default browser: the main process sends new windows there. */
export function BrowserOpenURL(url) {
  window.open(url, "_blank", "noopener");
}
