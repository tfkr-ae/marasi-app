// The app's launchpad store, bound to the Wails backend. The logic lives in
// createLaunchpadStore.js, which tests load with a fake API.
import {
  CancelLaunch,
  CreateLaunchpadEntry,
  DeleteLaunchpad,
  GetLaunch,
  GetLaunchpadRequests,
  GetLaunchpads,
  GetRawDetails,
  Launch,
  LinkTraffic,
  MoveLaunchpadEntries,
  PendingLaunches,
  SearchLaunchpadEntries,
  SetUnsavedDraftCount,
  UnlinkTraffic,
  UpdateLaunchpadEntry,
} from "../lib/bindings/App";
import { createLaunchpadStore, dirtyLaunchpadIds } from "./createLaunchpadStore.js";
import { reportUnsavedDraftCount } from "./draftGuards.js";
import { get } from "svelte/store";
import { relinked } from "./relinked.js";

export {
  BLANK_REQUEST,
  dirtyLaunchpadIds,
  isDraftDirty,
  isEntrySelected,
  launchOf,
  newestEntryOf,
  pendingEntryIds,
  pendingLaunchOf,
  seededRaw,
  selectedEntryIds,
} from "./createLaunchpadStore.js";

export const launchpadStore = createLaunchpadStore({
  getLaunchpads: () => GetLaunchpads(),
  getEntries: (id) => GetLaunchpadRequests(id),
  getRawDetails: (id) => GetRawDetails(id),
  createLaunchpad: (name, description) => CreateLaunchpadEntry(name, description),
  updateLaunchpad: (id, name, description) =>
    UpdateLaunchpadEntry(id, name, description),
  deleteLaunchpad: (id) => DeleteLaunchpad(id),
  launch: (raw, id, useHttps) => Launch(raw, id, useHttps),
  cancelLaunch: (id) => CancelLaunch(id),
  getLaunch: (id) => GetLaunch(id),
  pendingLaunches: () => PendingLaunches(),
  searchEntries: (query) => SearchLaunchpadEntries(query),
  moveEntries: (sourceId, targetId, ids, before) =>
    MoveLaunchpadEntries(sourceId, targetId, ids, before),
  unlinkEntries: (launchpadId, ids) =>
    UnlinkTraffic({ ids }, { Kind: "launchpad", ID: launchpadId }),
  // As the Ledger's: target is { Kind: "finding" | "test_case", ID }, and
  // that kind's list rereads its links afterwards.
  linkEntriesToRecord: (selection, target) => relinked(LinkTraffic(selection, target), target.Kind),
  unlinkEntriesFromRecord: (selection, target) => relinked(UnlinkTraffic(selection, target), target.Kind),
});

// How the window asks before something discards dirty drafts: the layout
// sets its modal here.
let askLosingDrafts = async () => true;

/** Sets how to ask: `ask(action, count)` resolves true to go ahead. */
export function askBeforeLosingDrafts(ask) {
  askLosingDrafts = ask;
}

/**
 * Before `action` ("Switch project") discards the open project's dirty
 * drafts: true at once when there are none, else the researcher's answer,
 * asked once for all of them.
 */
export function confirmLosingDrafts(action) {
  const count = dirtyLaunchpadIds(get(launchpadStore)).length;
  return count === 0 ? true : askLosingDrafts(action, count);
}

// Keeps the main process told how many unsaved drafts the window holds, so
// quitting or closing the window can ask first. Returns the unsubscribe
// function.
export function reportUnsavedDrafts() {
  return reportUnsavedDraftCount(launchpadStore, (count) =>
    SetUnsavedDraftCount(count).catch((err) =>
      console.error("reporting unsaved launchpad drafts:", err),
    ),
  );
}
