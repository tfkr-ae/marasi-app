// The Launchpad store: launchpads, their entries, and one Launchpad draft per
// launchpad. Every backend call goes through the injected `api` (see
// launchpadStore.js for the Wails one), so this module loads under node --test.
import { writable } from "svelte/store";
import { COMPARE_SIDES } from "../lib/launchpad/compare.js";
import { entrySearchQuery } from "../lib/launchpad/entrySearch.js";
import * as selecting from "../lib/launchpad/entrySelection.js";
import { leavesOrder, marasiMoveRefusal } from "../lib/launchpad/entryMove.js";
import { launchingIds, pendingLaunchIDs } from "../lib/launchPending.js";

// Entry search through Marasi: `matches` holds entry ids by launchpad id,
// `status` is idle, loading, done or error.
const IDLE_SEARCH = { status: "idle", matches: null, error: null };

/** Milliseconds the search box waits after a keystroke before asking Marasi. */
export const ENTRY_SEARCH_DELAY = 250;

// The draft an empty launchpad starts from.
export const BLANK_REQUEST = "GET / HTTP/1.1\nHost: \n\n";

// The state maps keyed by launchpad id. A deleted launchpad leaves all of them.
const PER_LAUNCHPAD_KEYS = [
  "entriesByLaunchpad",
  "selectedEntryByLaunchpad",
  "draftsByLaunchpad",
  "unseenByLaunchpad",
];

function initialState(projectStateVersion = 0) {
  return {
    projectStateVersion,
    launchpads: [],
    ...Object.fromEntries(PER_LAUNCHPAD_KEYS.map((key) => [key, {}])),
    // Launches by launch id, which is also their entry's UUID (Marasi
    // docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md): { ID, LaunchpadID, Status, Reason }.
    launchesById: {},
    detailsById: {},
    selectedLaunchpadId: null,
    // The Entry selection (entrySelection.js): one launchpad at a time.
    entrySelection: selecting.NO_ENTRY_SELECTION,
    search: "",
    entrySearch: IDLE_SEARCH,
    compare: null,
  };
}

// Applies `fn` to every per-launchpad map in state.
function mapPerLaunchpad(state, fn) {
  return Object.fromEntries(
    PER_LAUNCHPAD_KEYS.map((key) => [key, fn(state[key])]),
  );
}

// A Launchpad draft: the raw request, the entry it was seeded from (null for
// a blank one), and whether it launches over HTTPS.
function makeDraft(raw, seededFrom, previous) {
  return { raw, seededFrom, useHttps: previous?.useHttps ?? true };
}

// CodeMirror rewrites \r\n to \n, so drafts compare without them.
const normalise = (raw) => (raw ?? "").replace(/\r\n/g, "\n");

/** The raw request a launchpad's draft was seeded from. */
export function seededRaw(state, launchpadId) {
  const draft = state.draftsByLaunchpad[launchpadId];
  if (!draft?.seededFrom) return BLANK_REQUEST;
  return state.detailsById[draft.seededFrom]?.Request?.Raw ?? "";
}

/** True when the launchpad's draft differs from the request it was seeded from. */
export function isDraftDirty(state, launchpadId) {
  const draft = state.draftsByLaunchpad[launchpadId];
  if (!draft) return false;
  if (draft.seededFrom && !state.detailsById[draft.seededFrom]) return false;
  return normalise(draft.raw) !== normalise(seededRaw(state, launchpadId));
}

/** IDs of launchpads whose draft would be lost by closing the project. */
export function dirtyLaunchpadIds(state) {
  return Object.keys(state.draftsByLaunchpad).filter((id) =>
    isDraftDirty(state, id),
  );
}

/** True when the entry is in the Entry selection. */
export function isEntrySelected(state, launchpadId, entryId) {
  const selection = state.entrySelection;
  return selection.launchpadId === launchpadId && selection.ids.includes(entryId);
}

/** The Entry selection's entry ids in entry order. */
export function selectedEntryIds(state) {
  const { launchpadId, ids } = state.entrySelection;
  const selected = new Set(ids);
  return entryIdsOf(state, launchpadId).filter((id) => selected.has(id));
}

/**
 * How the entry's launch went: { Status, Reason } with Status pending,
 * completed, cancelled or failed, or null for an entry that was not
 * launched. Live launch events win over the outcome stored in the entry's
 * metadata (`launch.{status,reason}`). Pass the entry when you have it.
 */
export function launchOf(state, entryId, entry = undefined) {
  const live = state.launchesById[entryId];
  if (live) return { Status: live.Status, Reason: live.Reason || "" };
  const found =
    entry ??
    Object.values(state.entriesByLaunchpad)
      .flat()
      .find((item) => item.ID === entryId);
  const stored =
    found?.Metadata?.launch ?? state.detailsById[entryId]?.Metadata?.launch;
  if (!stored?.status) return null;
  return { Status: stored.status, Reason: stored.reason || "" };
}

/**
 * The ids of `ids` still launching from `launchpadId`: their launch is
 * pending and was launched from it. Marasi refuses to move such an entry to
 * another launchpad or remove it (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md).
 */
export function pendingEntryIds(state, launchpadId, ids) {
  return launchingIds(Object.values(state.launchesById), ids, launchpadId);
}

/** The launchpad's newest pending launch, or null. */
export function pendingLaunchOf(state, launchpadId) {
  return (
    Object.values(state.launchesById)
      .filter((launch) => launch.LaunchpadID === launchpadId && launch.Status === "pending")
      .at(-1) ?? null
  );
}

// Records a launch. A late "pending" never overrides a terminal state, since
// the binding's reply can arrive after the launch-finished event.
function recordLaunch(state, launch) {
  if (!launch?.ID) return state;
  const known = state.launchesById[launch.ID];
  if (known && known.Status !== "pending" && launch.Status === "pending") {
    return state;
  }
  return {
    ...state,
    launchesById: {
      ...state.launchesById,
      [launch.ID]: {
        ID: launch.ID,
        LaunchpadID: launch.LaunchpadID ?? known?.LaunchpadID,
        Status: launch.Status,
        Reason: launch.Reason || "",
      },
    },
  };
}

// Selects a launched entry and reseeds the draft from the request as sent,
// unless the researcher edited the draft after launching.
function selectLaunched(state, launchpadId, entryId, sentRaw, launchedRaw) {
  const draft = state.draftsByLaunchpad[launchpadId];
  return {
    ...state,
    selectedEntryByLaunchpad: {
      ...state.selectedEntryByLaunchpad,
      [launchpadId]: entryId,
    },
    draftsByLaunchpad: {
      ...state.draftsByLaunchpad,
      [launchpadId]: makeDraft(
        draft?.raw === launchedRaw ? sentRaw : draft?.raw,
        entryId,
        draft,
      ),
    },
  };
}

// The launchpad's entry ids in entry order.
const entryIdsOf = (state, launchpadId) =>
  (state.entriesByLaunchpad[launchpadId] || []).map((entry) => entry.ID);

function without(map, key) {
  const copy = { ...map };
  delete copy[key];
  return copy;
}

// The entry-list row for a request that has not been answered yet.
function entryFromRequest(request) {
  return {
    ID: request.ID,
    Number: request.Number,
    Scheme: request.Scheme,
    Method: request.Method,
    Host: request.Host,
    Path: request.Path,
    Status: "",
    StatusCode: 0,
    ContentType: "",
    Length: "",
    Metadata: request.Metadata || {},
    RequestedAt: request.RequestedAt,
    RespondedAt: null,
    Note: "",
  };
}

// Updates one launchpad's summary: EntryCount and LastStatusCode come from
// Marasi's launchpad list, and NewestEntryID names the entry LastStatusCode
// follows once a live arrival made it the newest.
function updateSummary(launchpads, launchpadId, fields) {
  return launchpads.map((launchpad) =>
    launchpad.ID === launchpadId ? { ...launchpad, ...fields } : launchpad,
  );
}

// The newest of `entries` by capture: the highest pair number. Entry order
// is the researcher's, so the last entry need not be the newest. Among
// entries without a number, the later one wins.
function newestByCapture(entries) {
  const rank = (entry) => entry.Number ?? -Infinity;
  return (entries || []).reduce(
    (newest, entry) => (!newest || rank(entry) >= rank(newest) ? entry : newest),
    null,
  );
}

/** The launchpad's newest loaded entry by capture, or null. */
export function newestEntryOf(state, launchpadId) {
  return newestByCapture(state.entriesByLaunchpad[launchpadId]);
}

// The summary of a freshly loaded entry list. Like Marasi's LastStatusCode,
// it follows the newest entry by capture, and a status code of 0 or below
// (awaiting, or -1 for a launch that ended without a response) is none.
function summaryOfEntries(entries) {
  const newest = newestByCapture(entries);
  return {
    EntryCount: entries.length,
    LastStatusCode: newest?.StatusCode > 0 ? newest.StatusCode : null,
    NewestEntryID: newest?.ID ?? null,
  };
}

// The launchpad a launched pair belongs to, from its launch: launch events
// and this store's own launches name it. Pair metadata is not read, since
// Marasi leaves it stale when an entry moves.
const launchpadOfLaunch = (state, id) => state.launchesById[id]?.LaunchpadID;

// A request from the layout's "request" event. A launched request goes to its
// launch's launchpad; anything else is ignored.
function arriveRequest(state, request) {
  const launchpadId = launchpadOfLaunch(state, request?.ID);
  if (!launchpadId) return state;
  const launchpad = state.launchpads.find((item) => item.ID === launchpadId);
  if (!launchpad) return state;
  const entries = state.entriesByLaunchpad[launchpadId];
  if (entries?.some((entry) => entry.ID === request.ID)) return state;
  if (state.detailsById[request.ID]) return state;
  return {
    ...state,
    launchpads: updateSummary(state.launchpads, launchpadId, {
      EntryCount: (launchpad.EntryCount ?? entries?.length ?? 0) + 1,
      LastStatusCode: null,
      NewestEntryID: request.ID,
    }),
    detailsById: {
      ...state.detailsById,
      [request.ID]: { Request: request, Response: null, Metadata: {} },
    },
    // Unloaded entry lists pick the request up when they load.
    entriesByLaunchpad: entries
      ? {
          ...state.entriesByLaunchpad,
          [launchpadId]: [...entries, entryFromRequest(request)],
        }
      : state.entriesByLaunchpad,
    unseenByLaunchpad:
      launchpadId === state.selectedLaunchpadId
        ? state.unseenByLaunchpad
        : {
            ...state.unseenByLaunchpad,
            [launchpadId]: (state.unseenByLaunchpad[launchpadId] || 0) + 1,
          },
  };
}

// A response from the layout's "response" event, matched to an arrived request.
function arriveResponse(state, response) {
  const details = state.detailsById[response?.ID];
  const launchpadId = details && launchpadOfLaunch(state, response.ID);
  if (!launchpadId) return state;
  const entries = state.entriesByLaunchpad[launchpadId];
  const newest = state.launchpads.find((item) => item.ID === launchpadId)?.NewestEntryID;
  return {
    ...state,
    launchpads:
      newest === response.ID
        ? updateSummary(state.launchpads, launchpadId, {
            LastStatusCode: response.StatusCode || null,
          })
        : state.launchpads,
    detailsById: {
      ...state.detailsById,
      [response.ID]: { ...details, Response: response },
    },
    entriesByLaunchpad: entries
      ? {
          ...state.entriesByLaunchpad,
          [launchpadId]: entries.map((entry) =>
            entry.ID === response.ID
              ? {
                  ...entry,
                  Status: response.Status,
                  StatusCode: response.StatusCode,
                  ContentType: response.ContentType,
                  Length: response.Length,
                  RespondedAt: response.RespondedAt,
                }
              : entry,
          ),
        }
      : state.entriesByLaunchpad,
  };
}

export function createLaunchpadStore(api) {
  let projectStateVersion = 0;
  // Launches from this store whose entry has not arrived yet, by launch id:
  // { launchpadId, raw }. Their entry is selected when it arrives.
  const awaitingEntry = new Map();
  let current = initialState();
  const { subscribe, set: setStore } = writable(current);

  function set(next) {
    current = next;
    setStore(next);
  }
  function update(fn) {
    set(fn(current));
  }

  // Entry search: one debounced Marasi query per settled term. Every new
  // term bumps searchSeq, so an older answer arriving late is dropped.
  let searchTimer = null;
  let searchSeq = 0;

  function setEntrySearch(entrySearch) {
    update((state) => ({ ...state, entrySearch }));
  }

  function setSearch(search) {
    clearTimeout(searchTimer);
    searchTimer = null;
    const seq = ++searchSeq;
    const { query, error } = entrySearchQuery(search);
    update((state) => ({
      ...state,
      search,
      entrySearch: query
        ? // Earlier matches stay listed until the new answer replaces them.
          { ...state.entrySearch, status: "loading", error: null }
        : error
          ? { status: "error", matches: null, error }
          : IDLE_SEARCH,
    }));
    if (query) searchTimer = setTimeout(() => runEntrySearch(seq, query), ENTRY_SEARCH_DELAY);
  }

  async function runEntrySearch(seq, query) {
    const version = projectStateVersion;
    const fresh = () => seq === searchSeq && version === projectStateVersion;
    let result;
    try {
      result = await api.searchEntries(query);
    } catch (err) {
      if (fresh()) setEntrySearch({ status: "error", matches: null, error: `Entry search failed: ${err}` });
      return;
    }
    if (!fresh()) return;
    if (result?.QueryError) {
      setEntrySearch({ status: "error", matches: null, error: result.QueryError.Message });
      return;
    }
    const matches = result?.EntriesByLaunchpad || {};
    setEntrySearch({ status: "done", matches, error: null });
    // Matching rows need their launchpad's entries for numbering.
    await Promise.all(
      Object.keys(matches)
        .filter((id) => !current.entriesByLaunchpad[id])
        .map((id) => loadEntries(id)),
    );
  }

  // Selects a launch's entry once it is in the store. A launch that ended
  // before Marasi sent its request event (cancelled early, for example) is
  // stored without one, so its launchpad's entries are reloaded.
  async function selectArrivedLaunch(launchId) {
    const awaiting = awaitingEntry.get(launchId);
    if (!awaiting) return;
    const { launchpadId, raw } = awaiting;
    const version = projectStateVersion;
    let details = current.detailsById[launchId];
    if (!details) {
      if (current.launchesById[launchId]?.Status === "pending") return;
      const entries = await loadEntries(launchpadId);
      if (version !== projectStateVersion) return;
      if (!entries.some((entry) => entry.ID === launchId)) return;
      details = await ensureDetails(launchId);
      if (version !== projectStateVersion) return;
    }
    const sent = sentRaw(launchId, details);
    if (!awaitingEntry.delete(launchId)) return;
    update((state) => selectLaunched(state, launchpadId, launchId, sent, raw));
  }

  // The request an entry sent, from its details `row`. A launch from this
  // store whose request Marasi has not stored yet sent the draft it launched.
  const sentRaw = (entryId, row) => row?.Request?.Raw ?? awaitingEntry.get(entryId)?.raw;

  // Replaces the pending launches with Marasi's list. A launch this store
  // still thinks pending but Marasi no longer lists ended unseen; read it.
  async function loadPendingLaunches() {
    const version = projectStateVersion;
    const pending = (await api.pendingLaunches()) || [];
    if (version !== projectStateVersion) return;
    const listed = new Set(pending.map((launch) => launch.ID));
    const stale = Object.values(current.launchesById).filter(
      (launch) => launch.Status === "pending" && !listed.has(launch.ID),
    );
    update((state) => pending.reduce(recordLaunch, state));
    const settled = await Promise.all(
      stale.map((launch) => api.getLaunch(launch.ID).catch(() => null)),
    );
    if (version !== projectStateVersion) return;
    // One Marasi no longer knows is forgotten, so its Cancel does not stick.
    update((state) =>
      stale.reduce(
        (next, launch, index) =>
          settled[index]
            ? recordLaunch(next, settled[index])
            : { ...next, launchesById: without(next.launchesById, launch.ID) },
        state,
      ),
    );
  }

  async function ensureDetails(id) {
    if (!id || current.detailsById[id]) return current.detailsById[id];
    const version = projectStateVersion;
    const row = await api.getRawDetails(id);
    if (version !== projectStateVersion || !row) return row;
    update((state) => ({
      ...state,
      detailsById: { ...state.detailsById, [id]: row },
    }));
    return row;
  }

  async function loadEntries(launchpadId) {
    const version = projectStateVersion;
    const entries = (await api.getEntries(launchpadId)) || [];
    if (version !== projectStateVersion) return [];
    update((state) => ({
      ...state,
      launchpads: updateSummary(state.launchpads, launchpadId, summaryOfEntries(entries)),
      entriesByLaunchpad: { ...state.entriesByLaunchpad, [launchpadId]: entries },
    }));
    return entries;
  }

  // Selects the entry and replaces the launchpad's draft with its request.
  // The new draft keeps `previous`'s HTTPS choice, the launchpad's own
  // draft's by default.
  async function seedDraft(launchpadId, entryId, previous = current.draftsByLaunchpad[launchpadId]) {
    const version = projectStateVersion;
    const row = await ensureDetails(entryId);
    if (version !== projectStateVersion) return;
    update((state) => ({
      ...state,
      selectedEntryByLaunchpad: {
        ...state.selectedEntryByLaunchpad,
        [launchpadId]: entryId,
      },
      draftsByLaunchpad: {
        ...state.draftsByLaunchpad,
        [launchpadId]: makeDraft(sentRaw(entryId, row) ?? "", entryId, previous),
      },
    }));
  }

  // Opens the launchpad without seeding: its unseen arrivals count as seen.
  function openLaunchpad(launchpadId) {
    update((state) => ({
      ...state,
      selectedLaunchpadId: launchpadId,
      compare: null,
      unseenByLaunchpad: launchpadId
        ? { ...state.unseenByLaunchpad, [launchpadId]: 0 }
        : state.unseenByLaunchpad,
    }));
  }

  async function selectLaunchpad(launchpadId) {
    openLaunchpad(launchpadId);
    if (!launchpadId) return;
    const version = projectStateVersion;
    const entries =
      current.entriesByLaunchpad[launchpadId] ?? (await loadEntries(launchpadId));
    if (version !== projectStateVersion) return;
    // A draft survives launchpad switches; only a missing one is seeded.
    if (current.draftsByLaunchpad[launchpadId]) return;
    await seedFromLast(launchpadId, entries);
  }

  // Seeds the launchpad's draft from its last entry, or a blank one with no
  // entry selected when it has none. The new draft keeps `previous`'s HTTPS
  // choice, the launchpad's own draft's by default.
  async function seedFromLast(launchpadId, entries, previous = current.draftsByLaunchpad[launchpadId]) {
    if (entries.length > 0) {
      await seedDraft(launchpadId, entries[entries.length - 1].ID, previous);
      return;
    }
    update((state) => ({
      ...state,
      selectedEntryByLaunchpad: without(state.selectedEntryByLaunchpad, launchpadId),
      draftsByLaunchpad: {
        ...state.draftsByLaunchpad,
        [launchpadId]: makeDraft(BLANK_REQUEST, null, previous),
      },
    }));
  }

  // Returns { needsConfirm: true } instead of replacing a dirty draft.
  // Re-selecting the entry a dirty draft came from keeps the draft.
  async function selectEntry(launchpadId, entryId, { force = false } = {}) {
    const draft = current.draftsByLaunchpad[launchpadId];
    const dirty = isDraftDirty(current, launchpadId);
    const sameEntry = draft?.seededFrom === entryId;
    if (!force && !sameEntry && dirty) {
      return { needsConfirm: true };
    }
    if (current.selectedLaunchpadId !== launchpadId) {
      openLaunchpad(launchpadId);
      if (!current.entriesByLaunchpad[launchpadId]) await loadEntries(launchpadId);
    }
    if (sameEntry && dirty) {
      update((state) => ({
        ...state,
        selectedEntryByLaunchpad: {
          ...state.selectedEntryByLaunchpad,
          [launchpadId]: entryId,
        },
      }));
    } else {
      await seedDraft(launchpadId, entryId);
    }
    // A click selects just this entry.
    updateEntrySelection(() => selecting.selectOnly(launchpadId, entryId));
    return { needsConfirm: false };
  }

  function updateEntrySelection(fn) {
    update((state) => ({ ...state, entrySelection: fn(state.entrySelection, state) }));
  }

  function updateDraftFields(launchpadId, fields) {
    update((state) => {
      const draft = state.draftsByLaunchpad[launchpadId];
      if (!draft) return state;
      return {
        ...state,
        draftsByLaunchpad: {
          ...state.draftsByLaunchpad,
          [launchpadId]: { ...draft, ...fields },
        },
      };
    });
  }

  function updateCompare(fields) {
    update((state) =>
      state.compare
        ? { ...state, compare: { ...state.compare, ...fields } }
        : state,
    );
  }

  // Loads the launchpad list. Drafts, entries and selection of launchpads
  // that still exist are kept, so the page can call this on every visit.
  // `prefer` opens that launchpad instead of the current one, if it exists.
  async function populate(prefer = null) {
    const version = projectStateVersion;
    const launchpads = (await api.getLaunchpads()) || [];
    if (version !== projectStateVersion) return;
    update((state) => {
      const ids = new Set(launchpads.map((launchpad) => launchpad.ID));
      const keep = (map) =>
        Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
      // Fresh summaries; the newest live arrival stays known for its response.
      const newest = Object.fromEntries(
        state.launchpads.map((launchpad) => [launchpad.ID, launchpad.NewestEntryID]),
      );
      return {
        ...state,
        launchpads: launchpads.map((launchpad) =>
          newest[launchpad.ID] ? { ...launchpad, NewestEntryID: newest[launchpad.ID] } : launchpad,
        ),
        ...mapPerLaunchpad(state, keep),
        compare: ids.has(state.compare?.launchpadId) ? state.compare : null,
        entrySelection: ids.has(state.entrySelection.launchpadId)
          ? state.entrySelection
          : selecting.NO_ENTRY_SELECTION,
      };
    });
    const exists = (id) => launchpads.some((launchpad) => launchpad.ID === id);
    const selected = [prefer, current.selectedLaunchpadId].find(exists) ?? launchpads[0]?.ID ?? null;
    await Promise.all([selectLaunchpad(selected), loadPendingLaunches()]);
  }

  // Jump to Launchpad: refreshes the list, opens `launchpadId` and selects
  // its newest entry, which may have been linked since its entries loaded.
  // `found` is false for an unknown id; the selection is then as populate
  // left it. `needsConfirm` is selectEntry's dirty-draft guard.
  async function jumpTo(launchpadId) {
    await populate(launchpadId);
    if (!launchpadId || current.selectedLaunchpadId !== launchpadId) {
      return { found: false, entryId: null, needsConfirm: false };
    }
    const entryId = (await loadEntries(launchpadId)).at(-1)?.ID ?? null;
    if (!entryId) return { found: true, entryId, needsConfirm: false };
    const { needsConfirm } = await selectEntry(launchpadId, entryId);
    return { found: true, entryId, needsConfirm };
  }

  // The draft follows its entry: the source's draft, dirty or not, replaces
  // the target's, and the source starts a fresh one from what it has left,
  // over the same scheme. The workspace follows the draft: an open source
  // opens the target.
  async function carryDraft(sourceId, targetId) {
    if (current.selectedLaunchpadId === sourceId) openLaunchpad(targetId);
    const draft = current.draftsByLaunchpad[sourceId];
    update((state) => ({
      ...state,
      selectedEntryByLaunchpad: {
        ...without(state.selectedEntryByLaunchpad, sourceId),
        [targetId]: draft.seededFrom,
      },
      draftsByLaunchpad: {
        ...without(state.draftsByLaunchpad, sourceId),
        [targetId]: draft,
      },
    }));
    await seedFromLast(sourceId, current.entriesByLaunchpad[sourceId] || [], draft);
  }

  // Move: takes `ids` (in entry order) out of `sourceId` and puts them
  // before `before` in `targetId`, at the end when `before` is null; the
  // target may be the source. Marasi moves all or none. Both launchpads are
  // reloaded either way, and after a move the Entry selection is the moved
  // entries. Returns { moved, refused }: the moved ids in entry order, or
  // why Marasi refused (its view was stale). Other failures throw.
  // The draft follows its entry (carryDraft). When that would replace a
  // dirty target draft, it returns { needsConfirm: true } without moving
  // unless `force` is set.
  async function moveEntries({ sourceId, targetId, ids, before = null }, { force = false } = {}) {
    if (sourceId === targetId && leavesOrder(entryIdsOf(current, sourceId), ids, before)) {
      return { moved: ids, refused: null };
    }
    const draft = current.draftsByLaunchpad[sourceId];
    const followsDraft = sourceId !== targetId && Boolean(draft?.seededFrom) && ids.includes(draft.seededFrom);
    if (followsDraft && !force && isDraftDirty(current, targetId)) {
      return { moved: null, refused: null, needsConfirm: true };
    }
    const version = projectStateVersion;
    const reload = () =>
      Promise.all([...new Set([sourceId, targetId])].map((id) => loadEntries(id)));
    let moved;
    try {
      moved = (await api.moveEntries(sourceId, targetId, ids, before ?? "")) || [];
    } catch (err) {
      const nameOf = (id) => current.launchpads.find((launchpad) => launchpad.ID === id)?.Name ?? "";
      const refused = marasiMoveRefusal(err, { sourceName: nameOf(sourceId), targetName: nameOf(targetId) });
      if (!refused) throw err;
      await Promise.all([reload(), loadPendingLaunches()]);
      return { moved: null, refused };
    }
    if (version !== projectStateVersion) return { moved, refused: null };
    await reload();
    if (version !== projectStateVersion) return { moved, refused: null };
    if (followsDraft) await carryDraft(sourceId, targetId);
    updateEntrySelection((selection) => ({
      launchpadId: targetId,
      ids: moved,
      anchor: moved.includes(selection.anchor) ? selection.anchor : moved[0] ?? null,
    }));
    return { moved, refused: null };
  }

  return {
    subscribe,
    clear: () => {
      awaitingEntry.clear();
      clearTimeout(searchTimer);
      searchSeq += 1;
      set(initialState(++projectStateVersion));
    },
    populate,
    jumpTo,
    loadEntries,
    ensureDetails,
    selectLaunchpad,
    selectEntry,

    // Entry selection beyond a plain click (selectEntry). None of these
    // reseeds a draft or changes the open launchpad.
    // Just this entry, as when a drag starts on an unselected one.
    selectOnlyEntry: (launchpadId, entryId) =>
      updateEntrySelection(() => selecting.selectOnly(launchpadId, entryId)),
    toggleEntry: (launchpadId, entryId) =>
      updateEntrySelection((selection) => selecting.toggle(selection, launchpadId, entryId)),
    // `order` is the entry ids the tree shows, for a range under Group by
    // status or a search; the launchpad's entry order otherwise.
    extendEntrySelection: (launchpadId, entryId, order = null) =>
      updateEntrySelection((selection, state) =>
        selecting.extend(selection, launchpadId, entryId, order ?? entryIdsOf(state, launchpadId)),
      ),
    // Every entry, including those behind "Show more".
    selectAllEntries: (launchpadId) =>
      updateEntrySelection((selection, state) =>
        selecting.selectAll(selection, launchpadId, entryIdsOf(state, launchpadId)),
      ),
    collapseEntrySelection: () => updateEntrySelection(selecting.collapse),

    // Remove from launchpad: unlinks the entries; their pairs stay in the
    // project. The launchpad reloads, refused or not: a refusal means this
    // view was stale, and one for a pending launch also reads the pending
    // launches, so the menu shows them launching. Removing the entry the
    // draft was seeded from, or the selected one, reseeds the draft as a
    // move does; when that would replace a dirty draft, it returns
    // { needsConfirm: true } without removing unless `force` is set.
    // Returns { removed, needsConfirm }: how many Marasi removed. The error
    // goes on.
    removeEntries: async (launchpadId, ids, { force = false } = {}) => {
      const removed = new Set(ids);
      const reseeds = () =>
        removed.has(current.draftsByLaunchpad[launchpadId]?.seededFrom) ||
        removed.has(current.selectedEntryByLaunchpad[launchpadId]);
      if (!force && reseeds() && isDraftDirty(current, launchpadId)) {
        return { removed: 0, needsConfirm: true };
      }
      const version = projectStateVersion;
      let count;
      try {
        count = await api.unlinkEntries(launchpadId, ids);
      } catch (err) {
        await Promise.all([loadEntries(launchpadId), pendingLaunchIDs(err) ? loadPendingLaunches() : null]);
        throw err;
      }
      const entries = await loadEntries(launchpadId);
      if (version !== projectStateVersion) return { removed: count, needsConfirm: false };
      updateEntrySelection(() => selecting.NO_ENTRY_SELECTION);
      if (reseeds()) await seedFromLast(launchpadId, entries);
      return { removed: count, needsConfirm: false };
    },

    // Links or unlinks the entries' pairs and a finding or test case: `kind`
    // is "finding" or "test_case", `recordId` the record's ID. The
    // launchpads don't change. Returns how many pairs Marasi changed; the
    // error goes on.
    linkEntries: (ids, kind, recordId) => api.linkTraffic({ ids }, { Kind: kind, ID: recordId }),
    unlinkEntries: (ids, kind, recordId) => api.unlinkTraffic({ ids }, { Kind: kind, ID: recordId }),

    // Drag and drop and the entry menu both move through this.
    moveEntries,

    updateDraft: (launchpadId, raw) => {
      if (current.draftsByLaunchpad[launchpadId]?.raw === raw) return;
      updateDraftFields(launchpadId, { raw });
    },
    revertDraft: (launchpadId) =>
      updateDraftFields(launchpadId, { raw: seededRaw(current, launchpadId) }),
    setUseHttps: (launchpadId, useHttps) =>
      updateDraftFields(launchpadId, { useHttps }),

    // Launches are tracked (marasi docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md): the binding returns the launch
    // id, which is the new entry's UUID, or throws when the launch could not
    // start. The launch stays pending until onLaunchFinished; its entry is
    // selected when it arrives. Returns the launch id.
    launch: async (launchpadId) => {
      const draft = current.draftsByLaunchpad[launchpadId];
      if (!draft) return null;
      const version = projectStateVersion;
      const id = await api.launch(draft.raw, launchpadId, draft.useHttps);
      if (version !== projectStateVersion || !id) return id;
      update((state) =>
        recordLaunch(state, { ID: id, LaunchpadID: launchpadId, Status: "pending" }),
      );
      awaitingEntry.set(id, { launchpadId, raw: draft.raw });
      await selectArrivedLaunch(id);
      return id;
    },

    // Cancels the launchpad's pending launch. A launch that ended first comes
    // back in its final state, which is recorded like any other.
    cancelLaunch: async (launchpadId) => {
      const pending = pendingLaunchOf(current, launchpadId);
      if (!pending) return;
      const launch = await api.cancelLaunch(pending.ID);
      update((state) => recordLaunch(state, launch));
    },

    onLaunchStarted: (launch) => update((state) => recordLaunch(state, launch)),
    onLaunchFinished: async (launch) => {
      update((state) => recordLaunch(state, launch));
      await selectArrivedLaunch(launch?.ID);
    },

    // Names and descriptions match locally at once; entries through Marasi.
    setSearch,

    createLaunchpad: async ({ name, description = "" }) => {
      const id = await api.createLaunchpad(name, description);
      update((state) => ({
        ...state,
        launchpads: [
          ...state.launchpads,
          { ID: id, Name: name, Description: description, EntryCount: 0, LastStatusCode: null },
        ],
        entriesByLaunchpad: { ...state.entriesByLaunchpad, [id]: [] },
      }));
      await selectLaunchpad(id);
      return id;
    },

    updateLaunchpad: async (id, { name, description = "" }) => {
      await api.updateLaunchpad(id, name, description);
      update((state) => ({
        ...state,
        launchpads: state.launchpads.map((launchpad) =>
          launchpad.ID === id
            ? { ...launchpad, Name: name, Description: description }
            : launchpad,
        ),
      }));
    },

    // Deletes without asking: confirming a dirty draft is the page's job.
    // Marasi refuses while a launch from it is pending (marasi docs/adr/2026-10-18-a-pending-launchs-pair-stays-in-its-launchpad.md);
    // the store then learns that launch, so Delete shows it launching.
    deleteLaunchpad: async (id) => {
      try {
        await api.deleteLaunchpad(id);
      } catch (err) {
        if (pendingLaunchIDs(err)) await loadPendingLaunches();
        throw err;
      }
      const index = current.launchpads.findIndex((launchpad) => launchpad.ID === id);
      update((state) => ({
        ...state,
        launchpads: state.launchpads.filter((launchpad) => launchpad.ID !== id),
        ...mapPerLaunchpad(state, (map) => without(map, id)),
        compare: state.compare?.launchpadId === id ? null : state.compare,
        entrySelection:
          state.entrySelection.launchpadId === id ? selecting.NO_ENTRY_SELECTION : state.entrySelection,
      }));
      if (current.selectedLaunchpadId !== id) return;
      const neighbour =
        current.launchpads[Math.min(index, current.launchpads.length - 1)];
      await selectLaunchpad(neighbour?.ID ?? null);
    },

    onRequest: (request) => {
      update((state) => arriveRequest(state, request));
      selectArrivedLaunch(request?.ID);
    },
    onResponse: (response) => update((state) => arriveResponse(state, response)),

    // Compare starts from an entry of the open launchpad as A. `picking`
    // names the side the next entry click fills.
    startCompare: async (leftId) => {
      const launchpadId = current.selectedLaunchpadId;
      if (!launchpadId) return;
      await ensureDetails(leftId);
      update((state) => ({
        ...state,
        compare: { launchpadId, leftId, rightId: null, picking: "right" },
      }));
    },
    pickCompareSide: (side) => updateCompare({ picking: side }),
    setCompareSide: async (side, entryId) => {
      await ensureDetails(entryId);
      updateCompare({
        [COMPARE_SIDES[side].key]: entryId,
        picking: null,
      });
    },
    swapCompare: () =>
      update((state) =>
        state.compare
          ? {
              ...state,
              compare: {
                ...state.compare,
                leftId: state.compare.rightId,
                rightId: state.compare.leftId,
              },
            }
          : state,
      ),
    closeCompare: () => update((state) => ({ ...state, compare: null })),
  };
}
