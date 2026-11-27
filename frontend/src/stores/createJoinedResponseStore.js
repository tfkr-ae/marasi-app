// Shared loader and byte-bounded in-memory cache for ended SSE responses
// (`GET /traffic/{id}/response/joined`), shared across the Ledger drawer,
// Launchpad workspace, Armory drawer, and Logbook linked traffic previews.
//
// Each open preview holds a lightweight handle (`createPreview()`) that
// receives updates only while it still displays that pair's response.
// Responses within `maxBytes` live in an LRU cache shared across all views;
// responses larger than `maxBytes` are held only by the active preview(s)
// displaying them and released as soon as those previews close or switch pair.
//
// `clear()` bumps the scope generation and drops every cached entry, active
// value and in-flight state (project switch or service connection change),
// discarding any late results from the previous scope.
import { writable } from "svelte/store";
import { isSuperseded } from "../lib/service/errors.js";

/** Default byte budget for the shared in-memory joined-response cache (16 MiB). */
export const DEFAULT_MAX_CACHE_BYTES = 16 * 1024 * 1024;

// Upper bound on per-pair streamed states remembered from live events so a
// long session never grows without bound.
const MAX_KNOWN_STREAMED = 1000;

function extractResponseDirection(source) {
  if (!source || typeof source !== "object") return null;
  if (source.response && typeof source.response === "object") return source.response;
  if (source.Streamed?.response) return source.Streamed.response;
  if (source.streamed?.response) return source.streamed.response;
  if (source.Metadata?.streamed?.response) return source.Metadata.streamed.response;
  if (source.metadata?.streamed?.response) return source.metadata.streamed.response;
  if (source.directions?.response) return source.directions.response;
  if (source.Directions?.response) return source.Directions.response;
  return null;
}

/**
 * Inspects one or more pair/event/streamed sources and reports whether the
 * pair's response framing is `sse` and whether its response direction has
 * ended (`complete`, `cancelled`, `reset`, `cut short`, or any non-empty ending).
 */
export function sseResponseState(...sources) {
  let isSSE = false;
  let ending = null;
  for (const source of sources) {
    if (!source) continue;
    if (typeof source.isSSE === "boolean") {
      if (source.isSSE) isSSE = true;
      if (source.ending) ending = ending ?? String(source.ending);
      continue;
    }
    const dir = extractResponseDirection(source);
    if (!dir) continue;
    const framing = dir.framing ?? dir.Framing ?? "";
    if (framing !== "sse") continue;
    isSSE = true;
    const end = dir.ending ?? dir.Ending ?? null;
    if (end) ending = ending ?? String(end);
  }
  return { isSSE, ended: Boolean(ending), ending };
}

/**
 * Whether a joined SSE response contains at least one complete captured event
 * after the HTTP status line and headers.
 */
export function hasJoinedSSEEvents(text) {
  if (typeof text !== "string" || !text) return false;
  const crlf = text.indexOf("\r\n\r\n");
  if (crlf >= 0) return text.slice(crlf + 4).length > 0;
  const lf = text.indexOf("\n\n");
  if (lf >= 0) return text.slice(lf + 2).length > 0;
  return false;
}

const isStreamResponseOpen = (err) => err?.code === "stream_response_open";
const isNotFound = (err) =>
  err?.status === 404 || err?.code === "not_found" || err?.code === "response_not_sse";

const decoder = new TextDecoder();

export function createJoinedResponseStore(api, { maxBytes = DEFAULT_MAX_CACHE_BYTES } = {}) {
  // Bumped on clear(); late results from an earlier project or connection are discarded.
  let scope = 0;
  // Bound connection handle for the current scope so a direct client.use()
  // switch clears cached entries even before projectData.clear() runs.
  let scopeLink = api.bind?.() ?? null;
  // LRU cache: id -> { text, bytes }, insertion order = oldest -> newest.
  const cache = new Map();
  let cachedBytes = 0;
  // Deduplicated in-flight reads: id -> { scope, promise, responseArrivedDuringFetch, retriedAfterConflict }.
  const inflight = new Map();
  // Pair ids that returned 404 in this scope (older service or non-SSE/missing).
  const unavailable = new Set();
  // Pair ids that returned 409 stream_response_open and await traffic.response / reopen / resync.
  const awaitingFinalResponse = new Set();
  // Bounded map of pair id -> { isSSE, ended, ending } learned from live events.
  const knownStreamed = new Map();
  // Active preview handles currently mounted across all views.
  const previews = new Set();

  function rememberStreamed(id, next) {
    if (!next.isSSE) return;
    const prev = knownStreamed.get(id);
    const merged = {
      isSSE: true,
      ended: Boolean(prev?.ended || next.ended),
      ending: prev?.ending ?? next.ending ?? null,
    };
    knownStreamed.delete(id);
    knownStreamed.set(id, merged);
    while (knownStreamed.size > MAX_KNOWN_STREAMED) {
      knownStreamed.delete(knownStreamed.keys().next().value);
    }
  }

  function cacheGet(id) {
    if (!cache.has(id)) return undefined;
    const entry = cache.get(id);
    cache.delete(id);
    cache.set(id, entry);
    return entry.text;
  }

  function cachePut(id, text, bytes) {
    if (cache.has(id)) {
      cachedBytes -= cache.get(id).bytes;
      cache.delete(id);
    }
    if (bytes > maxBytes) return false;
    while (cachedBytes + bytes > maxBytes && cache.size > 0) {
      const oldest = cache.keys().next().value;
      cachedBytes -= cache.get(oldest).bytes;
      cache.delete(oldest);
    }
    cache.set(id, { text, bytes });
    cachedBytes += bytes;
    return true;
  }

  function deliver(id, text) {
    for (const handle of previews) {
      if (handle.id === id) {
        handle.failedInAttachment = false;
        handle.setText(text);
      }
    }
  }

  function markAttemptFailed(id) {
    for (const handle of previews) {
      if (handle.id === id) handle.failedInAttachment = true;
    }
  }

  function clearAttemptFailed(id) {
    for (const handle of previews) {
      if (handle.id === id) handle.failedInAttachment = false;
    }
  }

  function activeHandlesFor(id) {
    const list = [];
    for (const handle of previews) {
      if (handle.id === id) list.push(handle);
    }
    return list;
  }

  function ensureScope() {
    if (scopeLink && !scopeLink.live()) clear();
    if (!scopeLink && api.bind) scopeLink = api.bind();
  }

  function fetchJoined(id, { isConflictRetry = false } = {}) {
    ensureScope();
    const cached = cacheGet(id);
    if (cached !== undefined) {
      deliver(id, cached);
      return Promise.resolve(cached);
    }
    if (!isConflictRetry && inflight.has(id)) {
      return inflight.get(id).promise;
    }
    const mine = scope;
    const link = api.bind?.() ?? null;
    const entry = {
      scope: mine,
      responseArrivedDuringFetch: false,
      retriedAfterConflict: isConflictRetry,
      promise: null,
    };
    const run = async () => {
      try {
        const raw = await api.readJoinedResponse(id, link ?? undefined);
        if (mine !== scope || (link && !link.live())) return null;
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw ?? 0);
        const text = decoder.decode(bytes);
        awaitingFinalResponse.delete(id);
        unavailable.delete(id);
        cachePut(id, text, bytes.byteLength);
        deliver(id, text);
        return text;
      } catch (err) {
        if (mine !== scope || isSuperseded(err) || (link && !link.live())) return null;
        if (isStreamResponseOpen(err)) {
          if (entry.responseArrivedDuringFetch && !entry.retriedAfterConflict) {
            if (inflight.get(id) === entry) inflight.delete(id);
            return fetchJoined(id, { isConflictRetry: true });
          }
          awaitingFinalResponse.add(id);
          markAttemptFailed(id);
          return null;
        }
        if (isNotFound(err)) {
          unavailable.add(id);
          return null;
        }
        markAttemptFailed(id);
        console.error("Reading the joined SSE response failed:", err);
        return null;
      } finally {
        if (inflight.get(id) === entry) inflight.delete(id);
      }
    };
    entry.promise = run();
    inflight.set(id, entry);
    return entry.promise;
  }

  /**
   * Creates a preview handle for one response view. Subscribe to it for the
   * joined response text (or `null` when unavailable/not SSE/still loading),
   * call `sync(...)` reactively with the displayed pair, and `destroy()` on unmount.
   */
  function createPreview() {
    const store = writable(null);
    const handle = {
      id: null,
      text: null,
      sse: { isSSE: false, ended: false, ending: null },
      hasResponse: false,
      failedInAttachment: false,
      setText(value) {
        if (handle.text === value) return;
        handle.text = value;
        store.set(value);
      },
    };
    previews.add(handle);

    return {
      subscribe: store.subscribe,

      sync({ id = null, active = true, hasResponse = false, streamed = null, sources = [] } = {}) {
        ensureScope();
        const nextId = active && id != null ? String(id) : null;
        const changed = nextId !== handle.id;
        if (changed) {
          handle.id = nextId;
          handle.failedInAttachment = false;
          handle.setText(null);
        }
        handle.hasResponse = Boolean(hasResponse);
        if (!nextId) {
          handle.sse = { isSSE: false, ended: false, ending: null };
          return;
        }
        const combined = sseResponseState(...sources, streamed, knownStreamed.get(nextId));
        handle.sse = combined;
        if (combined.isSSE) rememberStreamed(nextId, combined);

        const cached = cacheGet(nextId);
        if (cached !== undefined) {
          handle.setText(cached);
          return;
        }
        if (handle.text !== null) return;
        if (!combined.isSSE || !combined.ended) return;
        if (unavailable.has(nextId) || handle.failedInAttachment) return;
        fetchJoined(nextId);
      },

      destroy() {
        previews.delete(handle);
        handle.id = null;
        handle.failedInAttachment = false;
        handle.setText(null);
      },
    };
  }

  /** Handles `streamed_pair.started`, `.updated` and `.ended` events. */
  function onStreamedPair(event) {
    ensureScope();
    const rawId = event?.pair_id ?? event?.PairID ?? event?.ID;
    if (rawId == null) return;
    const id = String(rawId);
    const state = sseResponseState(event?.streamed, event?.Streamed, event?.directions, event?.Directions);
    if (!state.isSSE) return;
    rememberStreamed(id, state);
    const handles = activeHandlesFor(id);
    if (!handles.length) return;
    for (const h of handles) h.sse = sseResponseState(h.sse, state);
    if (!state.ended) return;
    const cached = cacheGet(id);
    if (cached !== undefined) {
      deliver(id, cached);
      return;
    }
    if (unavailable.has(id)) return;
    if (handles.every((h) => h.text !== null)) return;
    clearAttemptFailed(id);
    fetchJoined(id);
  }

  /**
   * Handles `traffic.response` events: triggers joined-response loading for
   * newly ended SSE pairs, retries pairs that previously returned
   * `409 stream_response_open`, or flags an in-flight GET to retry once after
   * a conflict.
   */
  function onTrafficResponse(event) {
    ensureScope();
    const rawId = event?.id ?? event?.ID;
    if (rawId == null) return;
    const id = String(rawId);
    const state = sseResponseState(
      event?.streamed,
      event?.Streamed,
      event?.metadata?.streamed,
      event?.Metadata?.streamed,
    );
    if (state.isSSE) rememberStreamed(id, state);
    unavailable.delete(id);

    const pending = inflight.get(id);
    if (pending) {
      pending.responseArrivedDuringFetch = true;
      return;
    }

    const wasAwaiting = awaitingFinalResponse.delete(id);
    const handles = activeHandlesFor(id);
    if (!handles.length) return;
    for (const h of handles) {
      h.hasResponse = true;
      if (state.isSSE) h.sse = sseResponseState(h.sse, state);
    }
    if (handles.every((h) => h.text !== null)) return;

    const cached = cacheGet(id);
    if (cached !== undefined) {
      deliver(id, cached);
      return;
    }

    const known = knownStreamed.get(id);
    const shouldFetch =
      wasAwaiting ||
      (state.isSSE && state.ended) ||
      (known?.isSSE && known?.ended) ||
      handles.some((h) => h.sse.isSSE && h.sse.ended);
    if (!shouldFetch) return;
    clearAttemptFailed(id);
    fetchJoined(id);
  }

  /**
   * Rechecks every currently visible preview after a stream reset/resync:
   * - ended SSE pairs awaiting retry or not yet fetched fetch immediately;
   * - live SSE or still-pending pairs recheck their streamed state from the
   *   service first (avoiding joined-response GETs while still live).
   */
  async function resync() {
    ensureScope();
    const mine = scope;
    const link = api.bind?.() ?? null;
    const visible = new Map();
    for (const handle of previews) {
      if (!handle.id || handle.text !== null) continue;
      if (!visible.has(handle.id)) visible.set(handle.id, []);
      visible.get(handle.id).push(handle);
    }
    await Promise.all(
      [...visible.entries()].map(async ([id, handles]) => {
        if (mine !== scope || (link && !link.live())) return;
        const cached = cacheGet(id);
        if (cached !== undefined) {
          deliver(id, cached);
          return;
        }
        const known = knownStreamed.get(id);
        const ended =
          awaitingFinalResponse.has(id) ||
          (known?.isSSE && known?.ended) ||
          handles.some((h) => h.sse.isSSE && h.sse.ended);
        if (ended) {
          if (unavailable.has(id)) return;
          awaitingFinalResponse.delete(id);
          clearAttemptFailed(id);
          await fetchJoined(id);
          return;
        }
        const needsStateCheck =
          handles.some((h) => (h.sse.isSSE && !h.sse.ended) || !h.hasResponse);
        if (!needsStateCheck || !api.readPairStreamed) return;
        let streamed;
        try {
          streamed = await api.readPairStreamed(id, link ?? undefined);
        } catch (err) {
          if (!isSuperseded(err)) console.error("Rechecking streamed pair state failed:", err);
          return;
        }
        if (mine !== scope || (link && !link.live())) return;
        const state = sseResponseState(streamed);
        if (!state.isSSE) return;
        rememberStreamed(id, state);
        const currentHandles = activeHandlesFor(id);
        for (const h of currentHandles) h.sse = sseResponseState(h.sse, state);
        if (!state.ended || !currentHandles.length || unavailable.has(id)) return;
        clearAttemptFailed(id);
        await fetchJoined(id);
      }),
    );
  }

  /** Clears cached responses and discards late results from the previous scope. */
  function clear() {
    scope++;
    scopeLink = api.bind?.() ?? null;
    cache.clear();
    cachedBytes = 0;
    inflight.clear();
    unavailable.clear();
    awaitingFinalResponse.clear();
    knownStreamed.clear();
    for (const handle of previews) {
      handle.failedInAttachment = false;
      handle.setText(null);
    }
  }

  /** Waits until all currently in-flight joined-response GETs have settled. */
  async function settled() {
    while (inflight.size > 0) {
      await Promise.allSettled([...inflight.values()].map((entry) => entry.promise));
    }
  }

  /** Cache and lifecycle counters for tests. */
  function stats() {
    return {
      cachedCount: cache.size,
      cachedBytes,
      inflightCount: inflight.size,
      previewCount: previews.size,
    };
  }

  return {
    createPreview,
    onStreamedPair,
    onTrafficResponse,
    resync,
    clear,
    settled,
    stats,
  };
}
