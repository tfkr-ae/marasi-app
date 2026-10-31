// Calls a service instance's control API over its Unix domain socket, which
// asks for no token. instances.js takes this as its `call`.
import { request } from "node:http";

// An instance that takes longer than this to answer is unhealthy.
const timeoutMs = 3000;

/**
 * Sends `method path` with the JSON `body` (none when undefined) over the
 * socket at `socketPath`. Resolves to `{status, body}`, where body is the
 * parsed JSON answer or null. A refused dial rejects with its `code`
 * (ECONNREFUSED, or ENOENT for a removed socket).
 */
export function callSocket(socketPath, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method,
        path,
        // Marasi's mux routes on the host-less path; any Host works on the socket.
        headers: { Host: "marasi", ...(payload ? { "Content-Type": "application/json" } : {}) },
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error(`${socketPath} timed out`), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}
