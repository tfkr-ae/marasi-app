// Start Chrome: the frontend reads the active connection's proxy listener
// and certificate through the service client, and Go's StartBrowser launches
// Chrome on this machine with them (chrome.go). The service's own
// POST /chrome/start is never called. createStartChrome takes its
// collaborators so tests pass fakes; chrome.js binds the app's.
import { codeIDs } from "./errorCodes.js";

/**
 * Returns `startChrome(profile)`. `client` is the service client,
 * `connection()` the connection store's state, and `launch` Go's
 * StartBrowser.
 */
export function createStartChrome({ client, connection, launch }) {
  return async function startChrome(profile = "") {
    const [listener, certificate] = await Promise.all([client.get("/listener/status"), client.get("/certificate")]);
    const state = connection();
    return launch({
      profile,
      connectionKind: state.connection.kind,
      connectionURL: state.url ?? "",
      proxyListener: listener?.status === "active" ? (listener.proxy_listener ?? "") : "",
      spkiHash: certificate?.spki_hash ?? "",
    });
  };
}

/**
 * The toast text for a failed Chrome call: why Go refused it, Marasi's
 * "invalid configuration" error as is (the Chrome settings reread the
 * machine config), and otherwise `fallback`.
 */
export function chromeErrorText(error, fallback) {
  if (codeIDs(error, "listener_inactive")) return "Start the proxy listener first";
  if (codeIDs(error, "listener_loopback")) return "Can't reach the proxy: it listens on the service's loopback only";
  const text = String(error);
  return text.includes("invalid configuration") ? text : fallback;
}
