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
import { get, writable } from "svelte/store";
import { boundAction } from "../lib/service/boundAction.js";
import { isSuperseded } from "../lib/service/errors.js";
import { MESSAGE_CAP } from "./streamedPairApi.js";

const DIRECTIONS = ["request", "response"];

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

  // Loads the pair's head and its messages from the start.
  async function load(pairId) {
    const { token } = viewOf(pairId);
    const action = actionFor();
    patch(pairId, { loading: true, error: "" });
    try {
      await Promise.all([readHead(pairId, token, action), readPages(pairId, token, null, action)]);
    } catch (err) {
      if (!isSuperseded(err) && current(pairId, token)) patch(pairId, { error: String(err) });
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
      if (!isSuperseded(err) && current(pairId, view.token)) patch(pairId, { error: String(err) });
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
  // { Loading } on its way, { Error } when it failed (a later select retries).
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
      if (current(pairId, view.token)) setDetail(pairId, id, { ...detail, Full: Boolean(message?.PayloadTruncated) });
    } catch (err) {
      if (!current(pairId, view.token)) return;
      // A connection switch stopped it: selecting again reads it anew.
      if (isSuperseded(err)) setDetail(pairId, id, undefined);
      else setDetail(pairId, id, { Error: String(err) });
    }
  }

  return {
    subscribe,
    open,
    close,
    loadMore,
    select,
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
