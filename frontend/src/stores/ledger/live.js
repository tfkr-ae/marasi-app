// Live traffic and other clients' changes: buffered request and response events, flushes, and in-place row patches from the stream.
import { webSocketMetadataPatch } from "../../lib/websocket/metadataPatch.js";
import { hiddenBy } from "../../lib/ledger/contentTypes.js";
import { pairIDSet, sameID } from "../../lib/ledger/pairs.js";
import { mapChunks, tableRows, withoutBodies } from "./state.js";
import { newMatchesKind } from "./selectors.js";
import { MAX_WINDOW_ROWS } from "./window.js";

/** How often buffered request and response events reach the table. */
export const FLUSH_INTERVAL_MS = 200;

/**
 * How long the Ledger waits after another client's bulk change
 * (traffic.changed) before reading the rows again, so a burst reads once.
 */
export const EVENT_SETTLE_MS = 300;

// Past this many buffered events, they reach the table at once.
const MAX_BUFFERED = 500;

/** The stream's traffic over the window `win`; `setSelection` replaces the selection. */
export function createLive(core, api, win, { setSelection }) {
  const { update, updateResults, track } = core;
  const { trim, scheduleNewMatches, readInPlace, refresh } = win;

  // Request and response events wait here until the next flush, so a burst
  // of traffic updates the table once.
  let requestBuffer = [];
  let responseBuffer = new Map();

  /**
   * Moves buffered requests and responses into the table. Responses fill in
   * loaded rows in place. At the top of the newest-first live view, new
   * pairs join at the top; anywhere else, new matches are counted.
   *
   * Live pairs joining the top leave the results' as_of alone, so the pages
   * below still agree; they raise `shownAsOf` instead. Once they push the
   * window past MAX_WINDOW_ROWS, the top page is read again in place under
   * a new as_of, so the oldest rows go and load back by cursor.
   */
  function flush() {
    if (requestBuffer.length === 0 && responseBuffer.size === 0) return;
    const live = newMatchesKind(core.current) === "top";
    // A read under way replaces the rows; pairs arriving meanwhile wait
    // for it, so the ones it leaves out still join the top.
    if (live && win.reading) return;
    const requests = requestBuffer;
    const responses = responseBuffer;
    requestBuffer = [];
    responseBuffer = new Map();

    const r = core.current.results;
    const showAtTop =
      live && !r.loading && !r.hasBefore && win.viewport.atTop && r.newCount === 0;
    const exclusion = core.current.exclusion;

    updateResults((r) => {
      let chunks = r.chunks;
      if (responses.size > 0) {
        chunks = mapChunks(chunks, (item) => {
          const res = responses.get(item.ID);
          if (!res) return item;
          const next = withoutBodies({ ...item, ...res });
          // The live view drops a pair once its response shows the
          // exclusion hides it.
          return live && hiddenBy(next.ContentType, exclusion) ? null : next;
        });
      }
      if (!showAtTop || requests.length === 0) return { ...r, chunks };
      // A pair joins once, however many times its request event came.
      const loaded = pairIDSet(tableRows({ results: { chunks } }));
      const fresh = requests.filter((req) => {
        if (loaded.has(String(req.ID))) return false;
        loaded.add(String(req.ID));
        return true;
      });
      const arrived = fresh
        .map((req) => withoutBodies(responses.has(req.ID) ? { ...req, ...responses.get(req.ID) } : req))
        .filter((pair) => !hiddenBy(pair.ContentType, exclusion))
        .sort((a, b) => (String(a.ID) < String(b.ID) ? 1 : -1));
      if (arrived.length === 0) return { ...r, chunks };
      const [top, ...rest] = chunks.length ? chunks : [{ items: [], first: null, last: null }];
      const newest = String(arrived[0].ID);
      return trim({
        ...r,
        chunks: [{ ...top, items: [...arrived, ...top.items] }, ...rest],
        shownAsOf: r.shownAsOf && r.shownAsOf > newest ? r.shownAsOf : newest,
        count: r.count && { ...r.count, count: r.count.count + (r.count.capped ? 0 : arrived.length) },
      });
    });
    if (!showAtTop) scheduleNewMatches();
    else if (tableRows(core.current).length > MAX_WINDOW_ROWS) track(readInPlace({ asOf: "" }));
  }

  // A live response carries no body; the drawer's copy of the focused
  // pair's response gains its raw text and prettified copy from the full
  // pair. Dropped when the drawer has moved on meanwhile.
  async function readIncomingBody(res) {
    if (!api.getRawDetails) return;
    let details;
    try {
      details = await api.getRawDetails(res.ID);
    } catch (err) {
      console.error("Reading the response failed:", err);
      return;
    }
    const incoming = core.current.selection.incomingResponse;
    if (!details || incoming?.ID !== res.ID) return;
    setSelection({
      ...core.current.selection,
      incomingResponse: {
        ...incoming,
        Raw: details.Response?.Raw ?? "",
        Prettified: details.Prettified?.Response ?? "",
      },
    });
  }

  /**
   * Merges `patch` into the Metadata of the loaded pair with this ID.
   */
  function patchMetadata(id, patch) {
    patchPairs([String(id)], (item) => ({ ...item, Metadata: { ...(item.Metadata || {}), ...patch } }));
  }

  // Applies `fn` to the loaded rows with these IDs, and to the drawer's pair
  // when a jump opened it outside them. `fn` returns the item itself when
  // nothing changes.
  function patchPairs(ids, fn) {
    const wanted = new Set(ids);
    update((state) => {
      const chunks = mapChunks(state.results.chunks, (item) => (wanted.has(String(item.ID)) ? fn(item) : item));
      const outside = state.focusRow;
      const focusRow = outside && wanted.has(String(outside.ID)) ? fn(outside) : outside;
      if (chunks === state.results.chunks && focusRow === outside) return state;
      return { ...state, results: { ...state.results, chunks }, focusRow };
    });
  }

  // Another client's bulk change (traffic.changed: a highlight, note,
  // metadata, link, unlink or delete) names its selection but not the new
  // values, so the rows are read again in place once the burst settles,
  // keeping the scroll, selection and drawer.
  let changedTimer = null;
  function onTrafficChanged() {
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => {
      changedTimer = null;
      refresh();
    }, EVENT_SETTLE_MS);
  }

  // metadata.updated carries the pair's whole stored metadata. The table
  // never holds prettified copies, which the drawer reads itself.
  function onMetadataUpdated({ id, metadata }) {
    const { prettified, ...shown } = metadata ?? {};
    patchPairs([String(id)], (item) => ({ ...item, Metadata: shown }));
  }

  // A note event makes a new row even when has_note stays, so an open
  // drawer reads the new text (unless its note editor holds an edit).
  const onNoteUpdated = ({ id, note }) => patchMetadata(id, { has_note: note ? 1 : 0 });
  const onNoteDeleted = ({ id }) => patchMetadata(id, { has_note: 0 });

  // The search index finished: results read while it was building may miss
  // older pairs, so those are read again.
  function onIndexComplete() {
    const r = core.current.results;
    if (r.indexComplete || r.loading) return;
    track(refresh());
  }

  return {
    flush,
    patchMetadata,
    patchPairs,
    onTrafficChanged,
    onMetadataUpdated,
    onNoteUpdated,
    onNoteDeleted,
    onIndexComplete,

    // Traffic events. They reach the table on the next flush, or at once
    // when the buffer is full.
    onRequest: (req) => {
      requestBuffer.push(req);
      if (requestBuffer.length > MAX_BUFFERED) flush();
    },
    onResponse: (res) => {
      if (sameID(core.current.selection.focus, res.ID)) {
        setSelection({ ...core.current.selection, incomingResponse: res });
        track(readIncomingBody(res));
      }
      responseBuffer.set(res.ID, res);
      if (responseBuffer.size > MAX_BUFFERED) flush();
    },
    // A ws-open, ws-close or ws-state event changes its upgrade row.
    patchWebSocketMetadata: (conn) => {
      if (!conn?.RequestID) return;
      // The upgrade request may still be waiting in the buffer; a failed
      // handshake's ws-state arrives right behind it.
      flush();
      patchMetadata(conn.RequestID, webSocketMetadataPatch(conn));
    },

    // A project switch: buffered events and a pending reread go.
    reset: () => {
      clearTimeout(changedTimer);
      changedTimer = null;
      requestBuffer = [];
      responseBuffer = new Map();
    },
  };
}
