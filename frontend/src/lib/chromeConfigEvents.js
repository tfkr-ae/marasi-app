// The service's chrome.* events, for the pages that show Chrome paths and
// profiles (Settings → Browser, Home's Start Chrome). Those live in Marasi's
// marasi_config.yaml on the machine that runs the service. The app reads
// this machine's copy (chrome_config.go), so the events say it changed
// (such as `marasi chrome …` from the CLI) only on the local connection; a
// remote's describe the remote host's file and are ignored.

/**
 * The handlers by event name. `connectionKind()` gives the active
 * connection's kind; `onPaths` and `onProfiles` reread that list.
 */
export function chromeConfigEvents({ connectionKind, onPaths, onProfiles }) {
  const local = (reread) => () => {
    if (connectionKind() === "local") reread();
  };
  return {
    "chrome.path.added": local(onPaths),
    "chrome.path.removed": local(onPaths),
    "chrome.profile.added": local(onProfiles),
    "chrome.profile.removed": local(onProfiles),
  };
}

/** Subscribes the handlers through `on(name, handler)`; returns the unsubscribe. */
export function followChromeConfig(on, options) {
  const stops = Object.entries(chromeConfigEvents(options)).map(([name, handler]) => on(name, handler));
  return () => stops.forEach((stop) => stop());
}
