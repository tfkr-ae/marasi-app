// The streamed pair messages store: the stream messages of each streamed
// pair whose Messages modal is open, by pair id, with its head, its
// directions and the message still arriving in each. Pairs without an open
// modal keep nothing. Every backend call goes through the injected `api`
// (streamedPairApi.js), so this module loads under node --test.
//
// A pair's view:
//   messages     loaded so far, in arrival order
//   cursor       the last loaded id while older messages are left (hasMore)
//   pair         { ID, Number, Method, Host, Path }, once its head is read
//   directions   { request, response }: null for a direction not streamed
//                (or not yet known), else { Framing, Ending, Messages,
//                ResetCode, Trailers }; Ending and Messages are null while live
//   progress     { [direction]: { Bytes, Framing } } while a message arrives
//   details      the single read of each selected message, by id
//   inject       { pending, held }: an inject on its way, and whether
//                Checkpoint holds it
//   draft        the Inject tab's { direction, text, neverCompress }
import { get, writable } from "svelte/store";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";
import { TEXT_FORM_FRAMINGS } from "../lib/messages/streamMessage.js";
import { MESSAGE_CAP } from "./streamedPairApi.js";

const DIRECTIONS = ["request", "response"];


function utf8Base64(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const live = (direction) => Boolean(direction) && !direction.Ending;

/** The directions an inject can go into: streamed and not yet ended. */
export const openDirections = (directions) => DIRECTIONS.filter((name) => live(directions?.[name]));

/**
 * Whether the call is live, so Cancel is offered: some streamed direction
 * hasn't ended. Marasi stamps every direction's ending as the pair ends, so
 * until one carries its ending, a direction not known yet (null: not
 * streamed, or a response whose head isn't admitted) may still come, such as
 * a server-streaming call's response.
 */
export function canCancel(directions) {
  const known = DIRECTIONS.map((name) => directions?.[name]).filter(Boolean);
  return known.some((d) => !d.Ending) || (known.length < DIRECTIONS.length && !known.some((d) => d.Ending));
}

// Why an inject was refused: { code, error }, with the toast for a refusal
// the app names, or the line, column and Marasi's reason for a text form it
// couldn't encode ("line 2 column 5: …"); { superseded } after a connection
// switch. Any other refusal's error goes to toastError.
export function injectRefusal(err) {
  if (isSuperseded(err)) return { superseded: true };
  const code = err?.code ?? "";
  if (code === "stream_not_open") return { code, error: err, toast: "Stream closed" };
  if (code === "stream_inject_refused") return { code, error: err, toast: "Length is fixed" };
  const at = code === "invalid_stream_request" && String(err?.body?.message ?? "").match(TEXT_ERROR);
  if (at) return { code, error: err, line: Number(at[1]), column: Number(at[2]), message: at[3] };
  return { code, error: err };
}

// protoscope's syntax error, after Marasi's prefix: "line L column C: why:
// syntax error". The column counts bytes.
const TEXT_ERROR = /line (\d+) column (\d+): (.*?)(?:: syntax error)?$/;

/** The list's line when the messages couldn't be read. */
export const READ_FAILED = "Couldn't read the messages";

let tokens = 0;

const emptyPair = () => ({
  token: ++tokens,
  messages: [],
  cursor: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  error: "",
  pair: null,
  directions: { request: null, response: null },
  progress: {},
  details: {},
  inject: { pending: false, held: false },
  // The Inject tab's editor, kept while the modal is open: direction null
  // until one is chosen.
  draft: { direction: null, text: "", neverCompress: false },
  // Set once a streamed_pair event lands, so a slower head read can't undo it.
  eventSeen: false,
});

// Messages in arrival order: by id, a UUIDv7, so the text order is the time
// order. There is no sequence field.
const byArrival = (a, b) => (a.ID < b.ID ? -1 : a.ID > b.ID ? 1 : 0);

// `list` with `items` added or replacing those with their id, in arrival order.
function merge(list, items) {
  const byId = new Map(list.map((m) => [m.ID, m]));
  for (const item of items) byId.set(item.ID, item);
  return [...byId.values()].sort(byArrival);
}

// While older messages are left to load, nothing past the last one loaded
// is kept: Load more reads it in its place.
const upToCursor = (messages, cursor) => (cursor ? messages.filter((m) => m.ID <= cursor) : messages);

// The directions from a streamed state ({request, response} of {framing,
// ending}) and the ended directions' details, where an event or read has
// them. A direction's earlier details stay until newer ones come.
function directionsFrom(previous, streamed, ended = {}) {
  return Object.fromEntries(
    DIRECTIONS.map((name) => {
      const state = streamed?.[name];
      const details = ended[name];
      if (!state && !details) return [name, previous?.[name] ?? null];
      const before = previous?.[name] ?? {};
      return [
        name,
        {
          Framing: details?.Framing || state?.framing || before.Framing || "",
          Ending: details?.Ending ?? state?.ending ?? null,
          Messages: details?.Messages ?? before.Messages ?? null,
          ResetCode: details?.ResetCode ?? before.ResetCode ?? "",
          Trailers: details?.Trailers ?? before.Trailers ?? [],
        },
      ];
    }),
  );
}

// `progress` without the directions that have ended.
function liveProgress(progress, directions) {
  return Object.fromEntries(Object.entries(progress).filter(([name]) => !directions[name]?.Ending));
}

export function createStreamedPairStore(api) {
  const store = writable({ pairs: {} });
  const { subscribe, set, update } = store;

  const viewOf = (pairId) => get(store).pairs[pairId];
  // Whether the view `token` was made for still shows the pair.
  const current = (pairId, token) => viewOf(pairId)?.token === token;

  function patch(pairId, change) {
    update((state) => {
      const view = state.pairs[pairId];
      if (!view) return state;
      const next = typeof change === "function" ? change(view) : change;
      return { ...state, pairs: { ...state.pairs, [pairId]: { ...view, ...next } } };
    });
  }

  // An action of several calls, bound to the connection it began on: after
  // a switch its next call never starts (boundAction.js).
  function actionFor() {
    const link = api.bind();
    const action = boundAction(link);
    return { step: action.step, link: link ?? undefined };
  }

  // Reads pages after `cursor` until MESSAGE_CAP more messages are in or
  // none are left, and adds them.
  async function readPages(pairId, token, cursor, action) {
    let loaded = 0;
    let next = cursor;
    do {
      const page = await action.step(() => api.messagesPage(pairId, next, action.link));
      if (!current(pairId, token)) return;
      loaded += page.items.length;
      next = page.cursor;
      patch(pairId, (view) => ({ messages: merge(view.messages, page.items), cursor: next, hasMore: Boolean(next) }));
    } while (next && loaded < MESSAGE_CAP);
    patch(pairId, (view) => ({ messages: upToCursor(view.messages, view.cursor) }));
  }

  async function readHead(pairId, token, action) {
    const read = await action.step(() => api.pair(pairId, action.link));
    if (!current(pairId, token)) return;
    patch(pairId, (view) => ({
      pair: read.pair,
      directions: view.eventSeen ? view.directions : directionsFrom(view.directions, read.Streamed, read.Directions),
    }));
  }

  // A failed messages read: the list says so; the cause goes to the console.
  function failedRead(pairId, err) {
    console.error("Reading stream messages failed:", err);
    patch(pairId, { error: READ_FAILED });
  }

  // Each open pair's action, bound to the connection its view was loaded
  // from: inject and cancel go through it, so after a switch they send
  // nothing until the view loads again.
  const actions = new Map();
  const actionOf = (pairId) => actions.get(pairId) ?? actionFor();

  // Loads the pair's head and its messages from the start.
  async function load(pairId) {
    const { token } = viewOf(pairId);
    const action = actionFor();
    actions.set(pairId, action);
    patch(pairId, { loading: true, error: "" });
    try {
      await Promise.all([readHead(pairId, token, action), readPages(pairId, token, null, action)]);
    } catch (err) {
      if (!isSuperseded(err) && current(pairId, token)) failedRead(pairId, err);
    } finally {
      if (current(pairId, token)) patch(pairId, { loading: false });
    }
  }

  // How many open modals show each pair: the pair is kept while any does.
  const openCounts = new Map();

  /** The modal opened on `pairId`: loads its head and messages. */
  async function open(pairId) {
    openCounts.set(pairId, (openCounts.get(pairId) ?? 0) + 1);
    if (viewOf(pairId)) return;
    update((state) => ({ ...state, pairs: { ...state.pairs, [pairId]: emptyPair() } }));
    await load(pairId);
  }

  /** The modal on `pairId` closed: once none shows it, its messages go. */
  function close(pairId) {
    const count = (openCounts.get(pairId) ?? 0) - 1;
    if (count > 0) {
      openCounts.set(pairId, count);
      return;
    }
    openCounts.delete(pairId);
    actions.delete(pairId);
    update((state) => {
      const { [pairId]: _released, ...rest } = state.pairs;
      return { ...state, pairs: rest };
    });
  }

  /** The Load more row: the next MESSAGE_CAP messages. */
  async function loadMore(pairId) {
    const view = viewOf(pairId);
    if (!view?.hasMore || view.loadingMore) return;
    patch(pairId, { loadingMore: true });
    try {
      await readPages(pairId, view.token, view.cursor, actionFor());
    } catch (err) {
      if (!isSuperseded(err) && current(pairId, view.token)) failedRead(pairId, err);
    } finally {
      if (current(pairId, view.token)) patch(pairId, { loadingMore: false });
    }
  }

  /**
   * stream_message: kept only for an open pair whose loaded messages reach
   * the live tail. The message has arrived, so its direction's progress goes.
   */
  function onMessage(message) {
    const view = viewOf(message?.PairID);
    if (!view) return;
    const { [message.Direction]: _arrived, ...progress } = view.progress;
    const keep = !view.hasMore || view.loading || view.loadingMore;
    patch(message.PairID, (v) => ({ progress, ...(keep ? { messages: merge(v.messages, [message]) } : {}) }));
  }

  /** stream_message.progress: a message is arriving in a direction. */
  function onProgress(progress) {
    if (!viewOf(progress?.PairID)) return;
    patch(progress.PairID, (view) => ({
      progress: { ...view.progress, [progress.Direction]: { Bytes: progress.Bytes, Framing: progress.Framing } },
    }));
  }

  /** streamed_pair.started, .updated or .ended (toStreamedPairEvent). */
  function onStreamedPair(event) {
    if (!viewOf(event?.PairID)) return;
    patch(event.PairID, (view) => {
      const directions = directionsFrom(view.directions, event.Streamed, event.Directions);
      return { directions, progress: liveProgress(view.progress, directions), eventSeen: true };
    });
  }

  // Each message's single read, by id: { Text, Payload, Full } once read,
  // { Loading } on its way, { Error: true } when it failed (a later select
  // retries).
  function setDetail(pairId, id, detail) {
    patch(pairId, (view) => ({ details: { ...view.details, [id]: detail } }));
  }

  /** Reads the selected message once for its text form and whole payload. */
  async function select(pairId, id) {
    const view = viewOf(pairId);
    const known = view?.details[id];
    if (!view || (known && !known.Error)) return;
    const message = view.messages.find((m) => m.ID === id);
    setDetail(pairId, id, { Loading: true });
    try {
      const action = actionFor();
      const detail = await action.step(() => api.message(pairId, id, action.link));
      if (!current(pairId, view.token)) return;
      const full = Boolean(message?.PayloadTruncated);
      setDetail(pairId, id, { ...detail, Full: full });
      // The row shows the whole payload from now on.
      if (full) {
        patch(pairId, (v) => ({ messages: v.messages.map((m) => (m.ID === id ? { ...m, Payload: detail.Payload } : m)) }));
      }
    } catch (err) {
      if (!current(pairId, view.token)) return;
      // A connection switch stopped it: selecting again reads it anew.
      if (isSuperseded(err)) setDetail(pairId, id, undefined);
      else {
        console.error("Reading a stream message failed:", err);
        setDetail(pairId, id, { Error: true });
      }
    }
  }

  /**
   * Injects `text` into `direction`: as the text form for gRPC, gRPC-Web
   * and Connect, otherwise as the payload, its UTF-8 bytes. neverCompress
   * sends it uncompressed. The call stays pending while Checkpoint holds
   * the message. Resolves to { ok: true, message } or { ok: false, ...why }
   * (injectRefusal); a connection switch resolves { ok: false, superseded }.
   */
  async function inject(pairId, { direction, text, neverCompress = false }) {
    const view = viewOf(pairId);
    if (!view || view.inject.pending) return { ok: false, busy: true };
    const framing = view.directions[direction]?.Framing ?? "";
    const body = {
      direction,
      ...(TEXT_FORM_FRAMINGS.has(framing) ? { text } : { payload: utf8Base64(text) }),
      compress: neverCompress ? "never" : "auto",
    };
    const action = actionOf(pairId);
    patch(pairId, { inject: { pending: true, held: false } });
    try {
      const message = await action.step(() => api.inject(pairId, body, action.link));
      if (current(pairId, view.token)) onMessage(message);
      return { ok: true, message };
    } catch (err) {
      return { ok: false, ...injectRefusal(err) };
    } finally {
      if (current(pairId, view.token)) patch(pairId, { inject: { pending: false, held: false } });
    }
  }

  /**
   * checkpoint.held (toHeldStreamItem): an injected message of a pair with
   * an inject on its way is that inject, held until it is forwarded or
   * dropped.
   */
  function onCheckpointHeld(item) {
    const view = viewOf(item?.PairID);
    if (!view?.inject.pending || !item.Injected) return;
    patch(item.PairID, { inject: { ...view.inject, held: true } });
  }

  /**
   * Cancels the live call (POST /stream/{pair}/cancel); its endings come
   * with streamed_pair.ended. Resolves to { ok: true } or { ok: false,
   * ...why } as inject does.
   */
  async function cancel(pairId) {
    if (!viewOf(pairId)) return { ok: false };
    const action = actionOf(pairId);
    try {
      await action.step(() => api.cancel(pairId, action.link));
      return { ok: true };
    } catch (err) {
      return { ok: false, ...injectRefusal(err) };
    }
  }

  /** Changes the Inject tab's draft: some of { direction, text, neverCompress }. */
  function setDraft(pairId, change) {
    patch(pairId, (view) => ({ draft: { ...view.draft, ...change } }));
  }

  return {
    subscribe,
    open,
    onCheckpointHeld,
    setDraft,
    cancel,
    close,
    loadMore,
    select,
    inject,
    onMessage,
    onProgress,
    onStreamedPair,
    /**
     * A project or connection switch: every open pair starts again empty
     * and reloads, and an answer from before the switch is dropped.
     */
    async resync() {
      const ids = Object.keys(get(store).pairs);
      update((state) => ({
        ...state,
        pairs: Object.fromEntries(ids.map((id) => [id, emptyPair()])),
      }));
      await Promise.all(ids.map((id) => load(id)));
    },
    /** Forgets every pair's messages; open modals keep their count. */
    clear() {
      const ids = Object.keys(get(store).pairs);
      set({ pairs: Object.fromEntries(ids.map((id) => [id, { ...emptyPair(), loading: false }])) });
    },
  };
}
