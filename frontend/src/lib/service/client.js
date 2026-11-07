// The service client: the one frontend module that calls the Marasi control
// API of the active connection. Nothing else calls `fetch` for the service.
//
//   const client = createServiceClient({ fetch, EventSource });
//   client.use({ url, password });          // the connection to reach
//   await client.get("/dashboard");          // JSON in and out
//   const stop = client.on("log.added", (log) => …);
//   client.openEvents({ onOpen, onDrop });   // one GET /events stream
//
// Every call carries `Authorization: Bearer <password>`, unless the
// connection has no password. A refusal rejects with a ServiceError whose
// text carries the code the frontend's error helpers read (errors.js). The
// stream's events reach the handlers registered with on(), by event name.
//
// `fetch` and `EventSource` are passed in so tests use fakes. EventSource is
// EventSource-like: `new EventSource(url, {headers})`, with onopen, onerror,
// addEventListener(name, listener) whose event has `data` as text, and
// close(). The app passes the fetch-based reader in sse.js, since a native
// EventSource can't send the password.
import { serviceError } from "./errors.js";

export function createServiceClient({ fetch, EventSource }) {
  let connection = null;
  // event name -> Set of handlers
  const handlers = new Map();
  let stream = null;

  function authHeaders() {
    return connection?.password ? { Authorization: `Bearer ${connection.password}` } : {};
  }

  function urlFor(path, query) {
    if (!connection) throw new Error("No Marasi connection is active.");
    const url = new URL(path, connection.url.replace(/\/*$/, "/"));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
    }
    return url.toString();
  }

  /**
   * Calls `method path` and resolves to the parsed JSON answer, or null for
   * an empty one. `body` is sent as JSON; `query` values may be arrays,
   * which repeat the parameter. For the routes that aren't JSON, `raw`
   * (bytes, such as an artifact) is sent as the body with `contentType`,
   * and `as: "bytes"` resolves to the answer's bytes (a Uint8Array).
   */
  async function request(method, path, { query, body, raw, contentType, as } = {}) {
    const headers = { ...authHeaders() };
    const init = { method, headers };
    if (raw !== undefined) {
      headers["Content-Type"] = contentType || "application/octet-stream";
      init.body = raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(urlFor(path, query), init);
    if (as === "bytes" && response.ok) return new Uint8Array(await response.arrayBuffer());
    const text = await response.text();
    const isJSON = (response.headers.get("content-type") ?? "").includes("application/json");
    let parsed = null;
    if (text && isJSON) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) throw serviceError({ method, path, status: response.status, body: parsed, text });
    return parsed;
  }

  function dispatch(name, data) {
    for (const handler of handlers.get(name) ?? []) {
      try {
        handler(data);
      } catch (err) {
        console.error(`Handling the service's ${name} event failed:`, err);
      }
    }
  }

  // Listens on the open stream for `name`, once per stream.
  function listen(name) {
    if (!stream || stream.names.has(name)) return;
    stream.names.add(name);
    stream.source.addEventListener(name, (event) => {
      let data = null;
      try {
        data = event.data ? JSON.parse(event.data) : null;
      } catch (err) {
        console.error(`The service's ${name} event isn't JSON:`, err);
        return;
      }
      dispatch(name, data);
    });
  }

  return {
    /** Points the client at `{url, password}`, or at nothing with null. */
    use(next) {
      connection = next ? { url: next.url, password: next.password ?? "" } : null;
    },
    /** The active connection's `{url, password}`, or null. */
    connection: () => connection,
    request,
    get: (path, query) => request("GET", path, { query }),
    post: (path, body, query) => request("POST", path, { body, query }),
    put: (path, body, query) => request("PUT", path, { body, query }),
    del: (path, body, query) => request("DELETE", path, { body, query }),

    /**
     * Routes the stream's `name` events to `handler`, which gets the event's
     * parsed data. Returns a function that removes this handler.
     */
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
      listen(name);
      return () => handlers.get(name)?.delete(handler);
    },

    /**
     * Opens GET /events on the active connection, closing any stream open
     * before. onOpen runs once the service answers; onDrop runs once when
     * the stream ends or fails, with `{status}` when the service refused it
     * (401 for a refused password). The client never reconnects by itself.
     */
    openEvents({ onOpen = () => {}, onDrop = () => {} } = {}) {
      this.closeEvents();
      const source = new EventSource(urlFor("/events"), { headers: authHeaders() });
      const current = { source, names: new Set(), dropped: false };
      stream = current;
      source.onopen = () => {
        if (stream === current) onOpen();
      };
      source.onerror = (event) => {
        if (stream !== current || current.dropped) return;
        current.dropped = true;
        stream = null;
        source.close();
        onDrop({ status: event?.status ?? null });
      };
      for (const name of handlers.keys()) listen(name);
    },

    /** Closes the stream without reporting a drop. */
    closeEvents() {
      if (!stream) return;
      stream.source.close();
      stream = null;
    },
  };
}
