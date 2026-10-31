// Local service instances: finding them by their sockets in Marasi's config
// directory, and connecting to one. Every call goes through `call`, which
// sends an HTTP request over an instance's socket, so tests pass a fake
// (socket.js has the real one). The socket asks for no token.
import { join } from "node:path";

// A dial an instance's socket refuses: its instance has stopped.
const STOPPED = new Set(["ECONNREFUSED", "ENOENT"]);

/** The instances directory in Marasi config directory `configDir`. */
export const instancesDir = (configDir) => join(configDir, "instances");

// Marasi's instance name rules (marasi cmd/marasi/root.go resolveInstancePath).
function socketPath(configDir, instance) {
  if (
    typeof instance !== "string" ||
    !instance ||
    /[\\/]/.test(instance) ||
    instance === "." ||
    instance === ".." ||
    instance.endsWith(".sock")
  ) {
    throw new Error(`${JSON.stringify(instance)} is not an instance name`);
  }
  return join(instancesDir(configDir), `${instance}.sock`);
}

// Calls `method path` on `instance`, and returns the answer's body. A
// refusal throws Marasi's code and message.
async function callInstance(call, configDir, instance, method, path, body) {
  let answer;
  try {
    answer = await call(socketPath(configDir, instance), method, path, body);
  } catch (err) {
    if (STOPPED.has(err?.code)) throw Object.assign(new Error(`${instance} isn't running`), { stopped: true });
    throw err;
  }
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  const code = answer.body?.error ?? `HTTP ${answer.status}`;
  const message = answer.body?.message;
  throw new Error(`${method} ${path}: ${code}${message ? `: ${message}` : ""}`);
}

/**
 * The instances running on this machine, by name: each one's
 * `/service/status`, or `{status: "unhealthy", instance}` when it answered
 * badly. A socket that refuses the dial is a stopped instance's and is
 * left out, as `marasi service list` does.
 */
export async function listLocalInstances({ configDir, readdir, call }) {
  let files;
  try {
    files = await readdir(instancesDir(configDir));
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const names = files
    .filter((file) => file.endsWith(".sock"))
    .map((file) => file.slice(0, -".sock".length))
    .sort();
  const items = await Promise.all(
    names.map(async (instance) => {
      try {
        return await callInstance(call, configDir, instance, "GET", "/service/status");
      } catch (err) {
        if (err.stopped) return null;
        return { status: "unhealthy", instance };
      }
    }),
  );
  return items.filter(Boolean);
}

// The origin to reach a control listener `ip:port` at. One bound to every
// address is reached at loopback.
function originOf(listener) {
  const host = listener.replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[::\]:/, "[::1]:");
  return `http://${host}`;
}

/**
 * Connects to local `instance`: its network address, turning one on at
 * loopback when it has none, and its control token, read through the
 * socket. Resolves to `{instance, origin, token, loopbackTurnedOn}`.
 */
export async function connectLocal({ configDir, instance, call }) {
  const status = await callInstance(call, configDir, instance, "GET", "/service/status");
  let listener = status.control_listener;
  const loopbackTurnedOn = !listener;
  if (!listener) {
    const started = await callInstance(call, configDir, instance, "POST", "/service/control-listener/start", {
      address: "127.0.0.1",
      port: 0,
    });
    listener = started.control_listener;
  }
  const token = await readToken({ configDir, instance, call });
  return { instance, origin: originOf(listener), token, loopbackTurnedOn };
}

/** Reads local `instance`'s control token through its socket. */
export async function readToken({ configDir, instance, call }) {
  const { token } = await callInstance(call, configDir, instance, "GET", "/service/control-listener/token");
  return token;
}

/** Asks local `instance` to stop, through its socket. */
export async function stopLocal({ configDir, instance, call }) {
  await callInstance(call, configDir, instance, "POST", "/service/stop");
}
