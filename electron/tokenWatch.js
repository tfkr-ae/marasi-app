// Follows a window's connection for a rotated control token. Rotation closes
// every network connection that used the old token, with no event on the
// network stream, so:
// - a local connection follows the instance's events on its socket, which
//   does see `control_listener.token_rotated`, and reads the new token
//   through the socket without asking;
// - a remote connection keeps its own /events stream open, and when it
//   ends, checks the token; a refused one is the researcher's to replace.
// A 401 the window got (`refused()`) is handled the same way.
import { readToken, socketPath } from "./instances.js";

const pauseMs = 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Watches `connection` ({instance, origin, token, remote}) and updates its
 * token in place. `streamSocket(socketPath, path, onEvent)` and
 * `call` reach a local instance's socket (socket.js), `fetch` a remote
 * one. `onRefused()` runs once, when a remote refuses the token.
 */
export function watchToken(connection, { configDir, streamSocket, call, fetch, onRefused = () => {}, sleep = wait }) {
  let stopped = false;
  let asked = false;
  let current = null;

  async function reread() {
    connection.token = await readToken({ configDir, instance: connection.instance, call });
  }

  function ask() {
    if (asked) return;
    asked = true;
    stopped = true;
    current?.close();
    onRefused();
  }

  // Whether the remote still takes the token: false only on a 401.
  async function tokenWorks() {
    try {
      const answer = await fetch(`${connection.origin}/service/status`, {
        headers: { Authorization: `Bearer ${connection.token}` },
      });
      return answer.status !== 401;
    } catch {
      return true;
    }
  }

  async function followRemote() {
    const controller = new AbortController();
    current = { close: () => controller.abort() };
    try {
      const answer = await fetch(`${connection.origin}/events`, {
        headers: { Authorization: `Bearer ${connection.token}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (answer.body) for await (const _chunk of answer.body) if (stopped) break;
    } catch {
      // A dropped stream is checked below like an ended one.
    }
    if (stopped) return;
    if (!(await tokenWorks())) ask();
  }

  async function followLocal() {
    const stream = streamSocket(socketPath(configDir, connection.instance), "/events", (event) => {
      if (event.name === "control_listener.token_rotated") reread().catch(() => {});
    });
    current = stream;
    await stream.closed;
  }

  (async () => {
    while (!stopped) {
      await (connection.remote ? followRemote() : followLocal()).catch(() => {});
      if (stopped) return;
      await sleep(pauseMs);
    }
  })();

  return {
    /** Handles a 401 the window got from the connection's origin. */
    async refused() {
      if (stopped) return;
      if (connection.remote) ask();
      else await reread().catch(() => {});
    },
    stop() {
      stopped = true;
      current?.close();
    },
  };
}

