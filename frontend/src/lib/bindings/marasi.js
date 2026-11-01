// The Marasi client module: the renderer's one way to reach the connected
// service instance. It makes plain fetch calls to the connection's base URL;
// the main process adds the control token outside the page, so the renderer
// never holds it (docs/adr/2026-10-31-v2-reaches-marasi-only-through-the-control-api.md).
//
// Marasi refuses with a JSON body, {error: "<code>", message?, …}. The
// client turns it into an error whose text the app's code helpers read
// (errorCodes.js): "<method> <path>: <code> (<id>, <id>): <message>". A
// route the instance doesn't have gets Go's plain-text 404 or 405 rather
// than a JSON body, and reads "Needs a newer Marasi".

/** The text of a call to a route the connected instance doesn't have. */
export const needsNewerMarasiText = "Needs a newer Marasi";

// The ids a refusal names, by the field Marasi names them in:
// launch_pending's pairs, selection_incomplete's jobs and
// checkpoint_items_held's items.
function refusalIDs(body) {
  const ids = body.request_ids ?? body.jobs ?? body.items ?? [];
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => (id && typeof id === "object" ? id.id : id)).filter((id) => id != null);
}

/** An error Marasi answered a call with. */
export class MarasiError extends Error {
  /**
   * `what` is the call ("POST /project/open"), `status` its HTTP status,
   * and `body` Marasi's refusal ({error, message?, …}), or null when the
   * answer wasn't one.
   */
  constructor(what, status, body) {
    const code = body?.error ?? null;
    const ids = body ? refusalIDs(body) : [];
    const cause = body?.message || (code ? `HTTP ${status}` : `HTTP ${status} from Marasi`);
    const text = code ? `${what}: ${code}${ids.length ? ` (${ids.join(", ")})` : ""}: ${cause}` : `${what}: ${cause}`;
    super(text);
    this.name = "MarasiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }

  // The app's error helpers show String(error), as Wails rejected with text.
  toString() {
    return this.message;
  }
}

/** The error a call to a route the connected instance doesn't have rejects with. */
export class NeedsNewerMarasi extends Error {
  constructor(what, status) {
    super(`${what}: ${needsNewerMarasiText}`);
    this.name = "NeedsNewerMarasi";
    this.status = status;
  }

  toString() {
    return needsNewerMarasiText;
  }
}

/** Whether `error` is a call to a route the connected instance doesn't have. */
export function isNeedsNewerMarasi(error) {
  return error instanceof NeedsNewerMarasi;
}

async function readRefusal(response) {
  if (!response.headers.get("Content-Type")?.includes("application/json")) return null;
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body : null;
}

/**
 * A client for the instance at `baseURL`. `fetch` is the global fetch
 * unless given. Each method resolves to the answer's JSON (null for no
 * content) and rejects with a MarasiError or NeedsNewerMarasi.
 */
export function createMarasiClient({ baseURL, fetch = globalThis.fetch.bind(globalThis) }) {
  const base = String(baseURL).replace(/\/+$/, "");

  // The answer to `init` on `path`, once Marasi accepted it.
  async function accepted(method, path, init = {}) {
    const response = await fetch(base + path, { method, headers: {}, ...init });
    const what = `${method} ${path.split("?")[0]}`;
    if (!response.ok) {
      const refusal = await readRefusal(response);
      if (!refusal && (response.status === 404 || response.status === 405)) {
        throw new NeedsNewerMarasi(what, response.status);
      }
      throw new MarasiError(what, response.status, refusal);
    }
    return response;
  }

  const answerOf = async (response) => {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };

  async function request(method, path, body) {
    const init = body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    return answerOf(await accepted(method, path, init));
  }

  // Sends `bytes` as the body, as an artifact upload takes them.
  const sendBytes = async (method, path, bytes, contentType) =>
    answerOf(await accepted(method, path, { headers: { "Content-Type": contentType }, body: bytes }));

  // A route's body as bytes, such as an artifact's content.
  const readBytes = async (path) => new Uint8Array(await (await accepted("GET", path)).arrayBuffer());

  return {
    baseURL: base,
    request,
    sendBytes,
    readBytes,
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path, body) => request("DELETE", path, body),
  };
}

// The window's connection's client, once it has one.
let connected = null;

/** Points the window's client at the instance at `baseURL`, and returns it. */
export function useConnection(baseURL) {
  connected = createMarasiClient({ baseURL });
  return connected;
}

// The window's client, which a call before a connection can't use.
function client() {
  if (!connected) throw new Error("Not connected to Marasi");
  return connected;
}

/** The window's connected instance's control API, as createMarasiClient's methods. */
export const marasi = {
  request: (method, path, body) => client().request(method, path, body),
  get: (path) => client().get(path),
  post: (path, body) => client().post(path, body),
  put: (path, body) => client().put(path, body),
  delete: (path, body) => client().delete(path, body),
  sendBytes: (method, path, bytes, contentType) => client().sendBytes(method, path, bytes, contentType),
  readBytes: (path) => client().readBytes(path),
};
