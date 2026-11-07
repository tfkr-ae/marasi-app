// The service client: the one frontend module that calls the Marasi control
// API of the active connection. Nothing else calls `fetch` for the service.
//
//   const client = createServiceClient({ fetch, EventSource });
//   client.use({ url, password });          // the connection to reach
//   await client.get("/dashboard");          // JSON in and out
//   const stop = client.on("log.added", (log) => …);
//   client.openEvents({ onOpen, onDrop });   // one GET /events stream
//   client.openEvents({ resume: true, onReset }); // after a drop: the missed events
//
// Every call carries `Authorization: Bearer <password>`, unless the
// connection has no password. A refusal rejects with a ServiceError whose
// text carries the code the frontend's error helpers read (errors.js). The
// stream's events reach the handlers registered with on(), by event name.
//
// The client keeps the last event id the stream carried (`<run_id>.<seq>`,
// opaque). openEvents({resume: true}) sends it as `?last_event_id=`, since
// an EventSource can't set Last-Event-ID, and the service replays what was
// missed before going live. When it can't (the id expired from its replay
// buffer, is from another run, or isn't its own), the first event is
// `stream.reset` and onReset gets its reason: "expired", "restarted" or
// "invalid". A resume with no id to send, because the stream it follows
// carried no event, can't replay either: onReset gets "none" once the new
// stream is open. A fresh openEvents() forgets the id.
//
// Each use() begins a new connection generation. bind() captures the
// current one: its calls reject with a `superseded` ServiceError
// (isSuperseded in errors.js) instead of being sent once use() has moved
// on, and so does an answer that lands after it moved. A caller that awaits
// before a write binds first, so its write never reaches the next
// connection; it treats superseded as a no-op.
//
// holdWrites(true) refuses every call but GETs and /service/ routes with a
// project_changed ServiceError, before it reaches the service: the
// connection store holds them while the service has another project open
// than the one the pages show.
//
// `fetch` and `EventSource` are passed in so tests use fakes. EventSource is
// EventSource-like: `new EventSource(url, {headers})`, with onopen, onerror,
// addEventListener(name, listener) whose event has `data` as text and
// `lastEventId`, a `lastEventId` of its own, and close(). The app passes the fetch-based reader in sse.js, since a native
// EventSource can't send the password.
import { ServiceError, serviceError, superseded, unreachable } from "./errors.js";

export function createServiceClient({ fetch, EventSource }) {
  let connection = null;
  // Bumped by every use(): which connection a bound call belongs to.
  let generation = 0;
  // event name -> Set of handlers
  const handlers = new Map();
  let stream = null;
  let writesHeld = false;
  // The id of the last event a stream carried, to resume from.
  let lastEventId = "";

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
   * `timeout` (ms) gives up on a service that doesn't answer. Either way a
   * call that gets no answer rejects with a ServiceError coded
   * `unreachable` or `timeout` whose text names the address.
   */
  async function request(method, path, { query, body, raw, contentType, as, timeout, bound } = {}) {
    const stale = () => bound !== undefined && bound !== generation;
    if (stale()) throw superseded(method, path);
    if (writesHeld && method !== "GET" && !path.startsWith("/service/")) {
      throw new ServiceError(`${method} ${path}: project_changed: load the service's project first`, {
        code: "project_changed",
        ids: [],
      });
    }
    const headers = { ...authHeaders() };
    const init = { method, headers };
    if (raw !== undefined) {
      headers["Content-Type"] = contentType || "application/octet-stream";
      init.body = raw;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const url = urlFor(path, query);
    // `timeout` (ms) bounds the wait for the answer's headers: a host that
    // drops packets would otherwise keep the call open for minutes.
    const abort = timeout ? new AbortController() : null;
    let timedOut = false;
    const timer = abort
      ? setTimeout(() => {
          timedOut = true;
          abort.abort();
        }, timeout)
      : null;
    if (abort) init.signal = abort.signal;
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (stale()) throw superseded(method, path);
      throw unreachable(url, err, { timedOut });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    if (stale()) throw superseded(method, path);
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

  function keepLastEventId(source) {
    if (source.lastEventId) lastEventId = source.lastEventId;
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
      generation++;
    },
    /**
     * The client's calls bound to the connection it points at now:
     * `{live(), request, get, post, put, del}`. Once use() moves on,
     * live() is false and each call rejects as superseded, unsent.
     */
    bind() {
      const bound = generation;
      const call = (method, path, options = {}) => request(method, path, { ...options, bound });
      return {
        live: () => bound === generation,
        request: call,
        get: (path, query) => call("GET", path, { query }),
        post: (path, body, query) => call("POST", path, { body, query }),
        put: (path, body, query) => call("PUT", path, { body, query }),
        del: (path, body, query) => call("DELETE", path, { body, query }),
      };
    },
    /** Refuses project writes (true) or lets them through again (false). */
    holdWrites(on) {
      writesHeld = Boolean(on);
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
    openEvents({ onOpen = () => {}, onDrop = () => {}, onReset = () => {}, resume = false } = {}) {
      this.closeEvents();
      if (!resume) lastEventId = "";
      const query = lastEventId ? { last_event_id: lastEventId } : undefined;
      const unresumable = resume && !lastEventId;
      const source = new EventSource(urlFor("/events", query), { headers: authHeaders() });
      const current = { source, names: new Set(), dropped: false };
      stream = current;
      source.onopen = () => {
        if (stream !== current) return;
        onOpen();
        if (unresumable) onReset("none");
      };
      source.onerror = (event) => {
        if (stream !== current || current.dropped) return;
        current.dropped = true;
        keepLastEventId(source);
        stream = null;
        source.close();
        onDrop({ status: event?.status ?? null });
      };
      source.addEventListener("stream.reset", (event) => {
        if (stream !== current) return;
        keepLastEventId(source);
        let reason = null;
        try {
          reason = JSON.parse(event.data)?.reason ?? null;
        } catch {}
        onReset(reason);
      });
      for (const name of handlers.keys()) listen(name);
    },

    /** Closes the stream without reporting a drop; a resume continues from it. */
    closeEvents() {
      if (!stream) return;
      keepLastEventId(stream.source);
      stream.source.close();
      stream = null;
    },
  };
}
