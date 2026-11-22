// The streamed pair messages store: the stream messages of each streamed
// pair whose Messages modal is open, by pair id, with its head, its
// directions and the message still arriving in each. Pairs without an open
// modal keep nothing. Every backend call goes through the injected `api`
// (streamedPairApi.js), so this module loads under node --test.
//
// A pair's view:
//   messages     loaded so far from the start, in arrival order
//   cursor       the last loaded id while older messages are left (hasMore)
//   tail         live messages past the loaded ones: at most MESSAGE_CAP,
//                the newest; while older messages are left (hasMore), after
//                the gap Load more fills
//   trimmed      the tail dropped older live messages since the last read
//                began, so they lie in the gap
//   pair         { ID, Number, Method, Host, Path }, once its head is read
//   codecs       { request, response }: each direction's codec (codecOf),
//                null when unknown, once its head is read
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
  tail: [],
  trimmed: false,
  cursor: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  error: "",
  pair: null,
  codecs: { request: null, response: null },
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
  // A live message usually comes after all the others: append it.
  if (items.length === 1 && !(list.length && items[0].ID <= list[list.length - 1].ID)) return [...list, items[0]];
  const byId = new Map(list.map((m) => [m.ID, m]));
  for (const item of items) byId.set(item.ID, item);
  return [...byId.values()].sort(byArrival);
}

// The tail kept to its newest MESSAGE_CAP: the older ones go to the gap.
function capTail(tail) {
  if (tail.length <= MESSAGE_CAP) return { tail };
  return { tail: tail.slice(-MESSAGE_CAP), trimmed: true };
}

// The loaded messages and the live tail once a read settles: while older
// messages are left (a cursor, or a tail that dropped some since the read
// began), what lies past the last one loaded goes to the tail, after the
// gap; once none are left, the tail joins the messages.
function splitAtCursor(view) {
  if (!view.cursor && !view.trimmed) return { messages: merge(view.messages, view.tail), tail: [], hasMore: false };
  const cursor = view.cursor ?? view.messages[view.messages.length - 1]?.ID ?? null;
  const past = (m) => cursor === null || m.ID > cursor;
  return {
    cursor,
    hasMore: true,
    messages: view.messages.filter((m) => !past(m)),
    ...capTail(merge(view.tail.filter(past), view.messages.filter(past))),
    ...(view.trimmed ? { trimmed: true } : {}),
  };
}

// A live message in a pair's view. It appends to the loaded messages while
// they hold the whole call and fewer than MESSAGE_CAP; otherwise it goes to
// the tail (while pages load, too, so the loaded list holds only what was
// read). A tail past MESSAGE_CAP drops its oldest into the gap. The message
// has arrived, so its direction's progress goes.
function withMessage(view, message) {
  const { [message.Direction]: _arrived, ...progress } = view.progress;
  const reading = view.loading || view.loadingMore;
  if (!view.hasMore && !reading && view.tail.length === 0 && view.messages.length < MESSAGE_CAP) {
    return { ...view, progress, messages: merge(view.messages, [message]) };
  }
  const next = { ...view, progress, ...capTail(merge(view.tail, [message])) };
  // Outside a read, the dropped messages open a gap after the loaded ones.
  if (next.trimmed && !reading && !next.hasMore) {
    next.hasMore = true;
    next.cursor = view.messages[view.messages.length - 1]?.ID ?? null;
  }
  return next;
}

const withProgress = (view, progress) => ({
  ...view,
  progress: { ...view.progress, [progress.Direction]: { Bytes: progress.Bytes, Framing: progress.Framing } },
});

function withStreamedPair(view, event) {
  const directions = directionsFrom(view.directions, event.Streamed, event.Directions);
  return { ...view, directions, progress: liveProgress(view.progress, directions), eventSeen: true };
}

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

  // Reads pages after `cursor` until MESSAGE_CAP more messages are in, none
  // are left, or the read meets the live tail: the tail holds every live
  // message from its first on, so the gap is closed.
  async function readPages(pairId, token, cursor, action) {
    let loaded = 0;
    let next = cursor;
    do {
      const page = await action.step(() => api.messagesPage(pairId, next, action.link));
      if (!current(pairId, token)) return;
      loaded += page.items.length;
      next = page.cursor;
      const first = viewOf(pairId).tail[0]?.ID;
      const metTail = Boolean(first) && page.items.some((m) => m.ID >= first);
      if (metTail) next = null;
      patch(pairId, (view) => ({
        messages: merge(view.messages, page.items),
        cursor: next,
        hasMore: Boolean(next),
        ...(metTail ? { trimmed: false } : {}),
      }));
    } while (next && loaded < MESSAGE_CAP);
    patch(pairId, splitAtCursor);
  }

  async function readHead(pairId, token, action) {
    const read = await action.step(() => api.pair(pairId, action.link));
    if (!current(pairId, token)) return;
    patch(pairId, (view) => ({
      pair: read.pair,
      codecs: read.Codecs ?? { request: null, response: null },
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
      if (current(pairId, token)) patch(pairId, (view) => ({ loading: false, ...splitAtCursor(view) }));
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
    // Whatever the tail dropped before now is stored, so this read meets it.
    patch(pairId, { loadingMore: true, trimmed: false });
    try {
      await readPages(pairId, view.token, view.cursor, actionFor());
    } catch (err) {
      if (!isSuperseded(err) && current(pairId, view.token)) failedRead(pairId, err);
    } finally {
      if (current(pairId, view.token)) patch(pairId, (v) => ({ loadingMore: false, ...splitAtCursor(v) }));
    }
  }

  /**
   * Live events in one store update, in order: each { message }
   * (stream_message), { progress } (stream_message.progress) or
   * { streamedPair } (streamed_pair.started, .updated or .ended,
   * toStreamedPairEvent). Events of a pair without an open modal are
   * dropped.
   */
  function onEvents(events) {
    const state = get(store);
    if (!events.some((e) => state.pairs[(e.message ?? e.progress ?? e.streamedPair)?.PairID])) return;
    update((current) => {
      const pairs = { ...current.pairs };
      for (const { message, progress, streamedPair } of events) {
        const pairId = (message ?? progress ?? streamedPair)?.PairID;
        const view = pairs[pairId];
        if (!view) continue;
        if (message) pairs[pairId] = withMessage(view, message);
        else if (progress) pairs[pairId] = withProgress(view, progress);
        else pairs[pairId] = withStreamedPair(view, streamedPair);
      }
      return { ...current, pairs };
    });
  }

  /** stream_message, for an open pair (withMessage). */
  const onMessage = (message) => onEvents([{ message }]);

  /** stream_message.progress: a message is arriving in a direction. */
  const onProgress = (progress) => onEvents([{ progress }]);

  /** streamed_pair.started, .updated or .ended (toStreamedPairEvent). */
  const onStreamedPair = (streamedPair) => onEvents([{ streamedPair }]);

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
    const message = [...view.messages, ...view.tail].find((m) => m.ID === id);
    setDetail(pairId, id, { Loading: true });
    try {
      const action = actionFor();
      const detail = await action.step(() => api.message(pairId, id, action.link));
      if (!current(pairId, view.token)) return;
      const full = Boolean(message?.PayloadTruncated);
      setDetail(pairId, id, { ...detail, Full: full });
      // The row shows the whole payload from now on.
      if (full) {
        const whole = (list) => list.map((m) => (m.ID === id ? { ...m, Payload: detail.Payload } : m));
        patch(pairId, (v) => ({ messages: whole(v.messages), tail: whole(v.tail) }));
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
    onEvents,
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
