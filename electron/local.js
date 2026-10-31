// Each window's connection to a local service instance, and the instances
// the app started. Marasi runs through `run(file, args)`, which resolves to
// the command's {stdout} (execFile in main.js), and the sockets through
// `call` (socket.js), so tests pass fakes for both.
import { connectLocal, readToken, stopLocal } from "./instances.js";

/** The default instance, which startup connects to (see GLOSSARY.md). */
export const defaultInstance = "default";

// Why a `--json` start failed: Marasi prints {"error"} on stdout.
function startRefusal(err) {
  try {
    const { error } = JSON.parse(err.stdout);
    if (error) return error;
  } catch {
    // Not Marasi's JSON: it didn't run, or it crashed.
  }
  return String(err.stderr || "").trim() || err.message;
}

/**
 * The windows' connections on Marasi config directory `configDir`.
 * `marasiBin()` names the Marasi that Start runs: the one the researcher
 * chose, or the bundled one. Windows are keyed by their webContents id.
 */
export function createLocalConnections({ configDir, run, call, marasiBin }) {
  // Each window's {instance, origin, token, loopbackTurnedOn}.
  const connections = new Map();
  // The instances the app started and hasn't been disconnected from:
  // quitting stops these, and only these.
  const started = new Set();
  // The windows startup has run for: a window connects to the default
  // instance once, so after a disconnect and a reload it stays unconnected.
  const launched = new Set();

  // Starts local `instance` on `project` (the scratchpad when null) with a
  // loopback network address and the proxy listener `listener` asks for
  // (extra start arguments), and connects to it at the address the start
  // command printed.
  async function startInstance(instance, project, listener = []) {
    const args = ["--config-dir", configDir, "--instance", instance, "--json", "service", "start"];
    args.push("--control-address", "127.0.0.1:0", ...listener);
    if (project) args.push("--project", project);
    let stdout;
    try {
      ({ stdout } = await run(marasiBin(), args));
    } catch (err) {
      throw new Error(startRefusal(err));
    }
    const output = JSON.parse(stdout);
    started.add(instance);
    const token = await readToken({ configDir, instance, call });
    return { instance, origin: `http://${output.control_listener}`, token, loopbackTurnedOn: false };
  }

  // Starts the default instance on Marasi's default proxy listener. When
  // that fails, as when another program holds the port, it starts on a
  // free port. (v1 opened with its listener off, but Marasi's start can't
  // start without one yet: see the ticket 05 gap.)
  async function startDefault() {
    try {
      return await startInstance(defaultInstance, null);
    } catch (err) {
      return startInstance(defaultInstance, null, ["--port", "0"]).catch(() => {
        throw err;
      });
    }
  }

  /**
   * Connects window `id` at launch: to the default instance, starting it
   * on the scratchpad when it isn't running. A window that has a
   * connection keeps it, as after a reload, and one that already launched
   * gets null.
   */
  async function startup(id) {
    if (connections.has(id)) return connections.get(id);
    if (launched.has(id)) return null;
    launched.add(id);
    let connection;
    try {
      connection = await connectLocal({ configDir, instance: defaultInstance, call });
    } catch (err) {
      if (!err.stopped) throw err;
      connection = await startDefault();
    }
    connections.set(id, connection);
    return connection;
  }

  /** Stops the instances the app started; resolves to their names. */
  async function quit() {
    const names = [...started];
    started.clear();
    await Promise.all(names.map((instance) => stopLocal({ configDir, instance, call }).catch(() => {})));
    return names;
  }

  /** Connects window `id` to running local `instance`. */
  async function connect(id, instance) {
    const connection = await connectLocal({ configDir, instance, call });
    connections.set(id, connection);
    return connection;
  }

  /**
   * Starts local `instance` on `project` (an absolute .marasi path, or
   * null for the scratchpad) and connects window `id` to it. Its proxy
   * listener takes a free port, as the default instance usually holds
   * Marasi's default one.
   */
  async function start(id, { instance, project }) {
    const connection = await startInstance(instance, project, ["--port", "0"]);
    connections.set(id, connection);
    return connection;
  }

  /**
   * Ends window `id`'s connection and leaves its instance running, even at
   * quit, unless another window is still connected to it.
   */
  function disconnect(id) {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id);
    if (![...connections.values()].some((other) => other.instance === connection.instance)) {
      started.delete(connection.instance);
    }
  }

  // A closed window: its connection goes, but an instance the app started
  // for it still stops at quit, as closing a window isn't a disconnect.
  const forget = (id) => connections.delete(id);

  return { startup, connect, start, disconnect, forget, quit, get: (id) => connections.get(id) };
}
