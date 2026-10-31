// The dev server's stand-in for Electron's main process, so the frontend
// runs in a plain browser against a real local instance (verification
// only; the app itself never loads it). It lists and connects to the
// instances in a Marasi config directory, as the main process does, and
// proxies the page's calls to the connected one, adding the control token
// on the way, so the page never holds it, as in Electron
// (docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
// One dev server has one connection, shared by every tab on it.
import { request } from "node:http";
import { connectLocal, listLocalInstances } from "../electron/instances.js";

/** Where the bridge answers on the dev server. */
export const bridgePath = "/__marasi";
// The connected instance's control API, as the page reaches it.
const instancePath = `${bridgePath}/instance`;

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : null);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJSON(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

// Verification uses a throwaway config directory, so the bridge reaches
// none unless one is named, never the researcher's own.
const noConfigDir = "Start the dev server with MARASI_CONFIG_DIR=DIR to reach the instances in DIR";

/**
 * The bridge for Marasi config directory `configDir` (none when null). `call` and `readdir`
 * are the socket call and directory read that electron/instances.js takes.
 * `handle(req, res, next)` is Connect middleware, as Vite's server takes.
 */
export function createDevBridge({ configDir, call, readdir }) {
  // {instance, origin, token, loopbackTurnedOn}, or null.
  let connection = null;

  const shown = (c) => c && { instance: c.instance, baseURL: instancePath, loopbackTurnedOn: c.loopbackTurnedOn };

  // Sends the page's request on to the connected instance with its token,
  // and streams the answer back, so /events stays open.
  function proxy(req, res, path) {
    const target = new URL(path, connection.origin);
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => !["authorization", "host", "cookie"].includes(name)),
    );
    headers.authorization = `Bearer ${connection.token}`;
    const upstream = request(target, { method: req.method, headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", (err) => {
      if (!res.headersSent) sendJSON(res, 502, { message: `${connection?.instance}: ${err.message}` });
      else res.destroy(err);
    });
    // A page that closes its event stream closes the instance's too.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }

  const routes = {
    "GET /instances": () => listLocalInstances({ configDir, readdir, call }),
    "GET /connection": () => shown(connection),
    "POST /connect": async (req) => {
      const { instance } = (await readJSON(req)) ?? {};
      connection = await connectLocal({ configDir, instance, call });
      return shown(connection);
    },
    "POST /disconnect": () => {
      connection = null;
      return null;
    },
  };

  async function handle(req, res, next) {
    const url = new URL(req.url, "http://dev");
    if (url.pathname === instancePath || url.pathname.startsWith(`${instancePath}/`)) {
      if (!connection) return sendJSON(res, 503, { message: "Not connected to Marasi" });
      return proxy(req, res, url.pathname.slice(instancePath.length) + url.search);
    }
    const route = url.pathname.startsWith(`${bridgePath}/`) && routes[`${req.method} ${url.pathname.slice(bridgePath.length)}`];
    if (!route) return next();
    try {
      if (!configDir) throw new Error(noConfigDir);
      sendJSON(res, 200, (await route(req)) ?? null);
    } catch (err) {
      sendJSON(res, 500, { message: err.message });
    }
  }

  return { handle };
}
