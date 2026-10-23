// The Checkpoint store: the held Checkpoint items in hold order, the
// selected one, and the researcher's edits, kept per item in memory until
// the item leaves. Every backend call goes through the injected `api` (see
// checkpointStore.js for the Wails one), so this module loads under
// node --test.
import { get, writable } from "svelte/store";

function initialState() {
  // items: Checkpoint items as GetCheckpointItems returns them, each with
  // `text`, its held raw request or response, or its WebSocket payload.
  // editsById: the edited text by item id; parseErrorsById: why an edited
  // HTTP item's text doesn't parse, by item id.
  // picked: ids picked with ⌘-click or shift-click; anchor: where a
  // shift-click range starts.
  return {
    items: [],
    selectedId: null,
    picked: [],
    anchor: null,
    editsById: {},
    parseErrorsById: {},
  };
}

/** Why the item's edit doesn't parse, or "" when it does or isn't edited. */
export function parseErrorOf(state, id) {
  return isDirty(state, id) ? (state.parseErrorsById[id] ?? "") : "";
}

/** The picked ids in hold order. */
export function pickedIds(state) {
  const picked = new Set(state.picked);
  return state.items.map((item) => item.ID).filter((id) => picked.has(id));
}

// The selection after a click on `id`. A plain click selects only it. With
// `toggle` (⌘-click) it joins or leaves the picks, which start from the
// selected item. With `range` (shift-click) the picks become the items from
// the anchor to it in `order`. The clicked item is always the selected one.
function picking(state, id, { toggle = false, range = false, order }) {
  if (range) {
    const from = order.indexOf(state.anchor);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      const picked = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      return { ...state, selectedId: id, picked };
    }
  }
  if (toggle) {
    const start = state.picked.length
      ? state.picked
      : [state.selectedId].filter((picked) => picked !== null && picked !== id);
    const picked = start.includes(id) ? start.filter((p) => p !== id) : [...start, id];
    return { ...state, selectedId: id, picked, anchor: id };
  }
  return { ...state, selectedId: id, picked: [], anchor: id };
}

// Wails sends a Go []byte as base64.
function decode(bytes) {
  if (!bytes) return "";
  if (typeof bytes !== "string") return new TextDecoder().decode(Uint8Array.from(bytes));
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)));
  } catch {
    return bytes;
  }
}

const withText = (item) => ({
  ...item,
  text: decode(item.Type === "websocket" ? item.Payload : item.Raw),
});

// CodeMirror rewrites \r\n to \n, so texts compare without them.
const normalise = (text) => (text ?? "").replace(/\r\n/g, "\n");

const itemOf = (state, id) => state.items.find((item) => item.ID === id);

/** The item's text as the researcher sees it: their edit, else as held. */
export function textOf(state, id) {
  return state.editsById[id] ?? itemOf(state, id)?.text ?? "";
}

/** True when the item has an edit that differs from its held text. */
export function isDirty(state, id) {
  const edit = state.editsById[id];
  const item = itemOf(state, id);
  return edit !== undefined && item !== undefined && normalise(edit) !== normalise(item.text);
}

// Keeps only the entries of `byId` whose item is still held as the same
// kind: a response held under its forwarded request's id starts clean.
function keptFor(byId, before, items) {
  const kept = {};
  for (const [id, value] of Object.entries(byId)) {
    const was = before.find((item) => item.ID === id);
    const now = items.find((item) => item.ID === id);
    if (was && now && was.Type === now.Type) kept[id] = value;
  }
  return kept;
}

// The item that takes the selection when `id` leaves: the next one in
// `order` that stays, else the previous one, else none.
function neighbourOf(order, id, stays) {
  const at = order.indexOf(id);
  if (at < 0) return null;
  for (let i = at + 1; i < order.length; i++) if (stays(order[i])) return order[i];
  for (let i = at - 1; i >= 0; i--) if (stays(order[i])) return order[i];
  return null;
}

// Moves the selection off items that left. A selected item that stays
// keeps it; only when nothing is selected does the oldest item take it.
function withItems(state, items) {
  const held = new Set(items.map((item) => item.ID));
  let { selectedId } = state;
  if (selectedId !== null && !held.has(selectedId)) {
    const order = state.items.map((item) => item.ID);
    selectedId = neighbourOf(order, selectedId, (id) => held.has(id));
  }
  if (selectedId === null) selectedId = items[0]?.ID ?? null;
  return {
    ...state,
    items,
    selectedId,
    picked: state.picked.filter((id) => held.has(id)),
    editsById: keptFor(state.editsById, state.items, items),
    parseErrorsById: keptFor(state.parseErrorsById, state.items, items),
  };
}

// The state without the items in `gone`.
function without(state, gone) {
  return withItems(state, state.items.filter((item) => !gone.has(item.ID)));
}

// "Forwarded 6 · 1 skipped · 1 gone", leaving out counts of zero.
function bulkText(kind, { done, skipped, gone }) {
  const parts = [`${kind === "forward" ? "Forwarded" : "Dropped"} ${done}`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (gone) parts.push(`${gone} gone`);
  return parts.join(" · ");
}

/**
 * `interceptFlag` is the app's Intercept all flag, which the Marasi menu
 * and the Checkpoint page share.
 */
export function createCheckpointStore(api, { interceptFlag = writable(false) } = {}) {
  const store = writable(initialState());
  // Each read of the queue gets a number; an older reply is ignored.
  let readSeq = 0;

  async function refresh() {
    const seq = ++readSeq;
    const items = ((await api.getItems()) ?? []).map(withText);
    if (seq !== readSeq) return;
    store.update((state) => withItems(state, items));
  }

  // Removes the items that left, at once, then reads the queue again: a
  // response held under a forwarded request's id comes back that way.
  async function settled(ids) {
    readSeq++;
    store.update((state) => without(state, new Set(ids)));
    await refresh();
  }

  /**
   * Selects the item. `toggle` (⌘-click) adds it to the picks or removes
   * it; `range` (shift-click) picks from the anchor to it in `order`, the
   * ids as the view lists them, hold order by default.
   */
  function pick(id, { toggle = false, range = false, order = null } = {}) {
    store.update((state) =>
      picking(state, id, { toggle, range, order: order ?? state.items.map((item) => item.ID) }),
    );
  }

  // The latest parse check by item id; an older reply is ignored.
  const parseSeq = {};

  /**
   * Keeps the researcher's text for the item until it leaves, and checks
   * that an HTTP item's text parses. Resolves once the check is back.
   */
  async function edit(id, text) {
    store.update((state) => ({ ...state, editsById: { ...state.editsById, [id]: text } }));
    const item = itemOf(get(store), id);
    if (!item || item.Type === "websocket") return;
    const seq = (parseSeq[id] = (parseSeq[id] ?? 0) + 1);
    const error = (await api.checkParse(text, item.Type)) ?? "";
    if (seq !== parseSeq[id] || itemOf(get(store), id)?.Type !== item.Type) return;
    store.update((state) => ({
      ...state,
      parseErrorsById: { ...state.parseErrorsById, [id]: error },
    }));
  }

  /**
   * Forwards the item, edited if it is dirty, else as held. Resolves to
   * false, without forwarding, when its edit doesn't parse.
   */
  async function forward(id, { interceptResponse = false } = {}) {
    const state = get(store);
    if (parseErrorOf(state, id)) return false;
    const body = isDirty(state, id) ? state.editsById[id] : "";
    await api.forward(id, body, interceptResponse);
    await settled([id]);
    return true;
  }

  async function drop(id) {
    await api.drop(id);
    await settled([id]);
  }

  /**
   * Forward n or Drop n over `ids`, frozen at the click: items held during
   * it stay held. Forward skips items whose edit doesn't parse. Resolves to
   * { done, skipped, gone, text }, where gone counts items that had already
   * left and text reads like "Forwarded 6 · 1 skipped · 1 gone".
   */
  async function bulk(kind, ids) {
    const snapshot = [...ids];
    const state = get(store);
    const skipped = kind === "forward" ? snapshot.filter((id) => parseErrorOf(state, id)) : [];
    const sent = snapshot.filter((id) => !skipped.includes(id));
    let result = { Done: 0, Gone: 0 };
    if (sent.length) {
      try {
        result =
          kind === "forward"
            ? await api.forwardMany(
                sent.map((id) => ({ ID: id, Body: isDirty(state, id) ? state.editsById[id] : "" })),
              )
            : await api.dropMany(sent);
      } catch (err) {
        // Some items failed; the queue says which are still held.
        await refresh();
        throw err;
      }
      await settled(sent);
    }
    const counts = { done: result.Done, skipped: skipped.length, gone: result.Gone };
    return { ...counts, text: bulkText(kind, counts) };
  }

  const abandonListeners = new Set();

  /** Calls `listener` with each abandon report. Returns the unsubscribe function. */
  function onAbandon(listener) {
    abandonListeners.add(listener);
    return () => abandonListeners.delete(listener);
  }

  // The checkpoint-abandoned event: Marasi dropped the item because its
  // client left. Returns { item, editLost }, or null for an unknown id.
  function onAbandoned({ ID } = {}) {
    const state = get(store);
    const item = itemOf(state, ID);
    if (!item) return null;
    const report = { item, editLost: isDirty(state, ID) };
    readSeq++;
    store.update((current) => without(current, new Set([ID])));
    refresh().catch((err) => console.error("reading Checkpoint items:", err));
    for (const listener of abandonListeners) listener(report);
    return report;
  }

  // Reads the queue and the Intercept all flag.
  async function populate() {
    const [flag] = await Promise.all([api.getInterceptFlag(), refresh()]);
    interceptFlag.set(flag);
  }

  /** Turns Intercept all on or off. Resolves to the new state. */
  async function toggleIntercept() {
    const flag = await api.toggleIntercept();
    interceptFlag.set(flag);
    return flag;
  }

  // Forgets the project's items and edits, and ignores replies still on
  // their way, before another project opens.
  function clear() {
    readSeq++;
    for (const id of Object.keys(parseSeq)) parseSeq[id]++;
    store.set(initialState());
  }

  return {
    subscribe: store.subscribe,
    populate,
    clear,
    toggleIntercept,
    onIntercepted: refresh,
    onAbandoned,
    onAbandon,
    pick,
    edit,
    forward,
    drop,
    bulk,
  };
}
