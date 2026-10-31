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

/**
 * Follows the server-sent events at `path` on the socket at `socketPath`,
 * calling `onEvent({name, data})` for each. Returns `{closed, close}`:
 * `closed` resolves when the stream ends, fails or is closed.
 */
export function streamSocket(socketPath, path, onEvent) {
  let req;
  const closed = new Promise((resolve) => {
    req = request({ socketPath, method: "GET", path, headers: { Host: "marasi", Accept: "text/event-stream" } }, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk.replace(/\r\n?/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = sseEvent(block);
          if (event) onEvent(event);
        }
      });
      res.on("end", resolve);
      res.on("close", resolve);
      res.on("error", resolve);
    });
    req.on("error", resolve);
    req.on("close", resolve);
    req.end();
  });
  return { closed, close: () => req.destroy() };
}

// One server-sent event block as {name, data}, or null for a comment.
function sseEvent(block) {
  let name = "message";
  const data = [];
  let any = false;
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") name = value;
    else if (field === "data") data.push(value);
    else continue;
    any = true;
  }
  return any ? { name, data: data.join("\n") } : null;
}
