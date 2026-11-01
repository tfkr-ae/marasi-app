// The app's Ledger store, bound to the Wails backend. The logic lives in
// createLedgerStore.js, which tests load with a fake API.
import {
  AppendNote,
  ClearHighlight,
  ClearNotes,
  CountContentTypes,
  CountTraffic,
  CreateLaunchpadEntry,
  DeleteLaunchpad,
  DeleteTraffic,
  GetContentTypeExclusion,
  GetDefaultContentTypeExclusion,
  GetMetadata,
  GetNote,
  GetRawDetails,
  HasOwnContentTypeExclusion,
  LinkTraffic,
  QueryTraffic,
  ResetContentTypeExclusion,
  SetContentTypeExclusion,
  SetDefaultContentTypeExclusion,
  SetHighlight,
  UnlinkTraffic,
  UpdateNote,
} from "../lib/wailsjs/go/main/App";
import { armoryStore } from "./armoryStore";
import { relinked } from "./relinked.js";
import { createLedgerStore, FLUSH_INTERVAL_MS } from "./createLedgerStore.js";

export {
  allSelectedLabel,
  isAllSelected,
  selectionSize,
  selectionSpec,
  countLabel,
  drawerKeybindingState,
  focusedPair,
  hiddenByTypeCount,
  indexWarning,
  selectedPairs,
  isLiveNewestFirst,
  isQueryActive,
  newMatchesKind,
  newMatchesLabel,
  rowMenuTarget,
  selectionTarget,
  tableRows,
} from "./createLedgerStore.js";

export const ledgerStore = createLedgerStore({
  // A page of the live view or of a query's results:
  // { Query, OrderBy, Cursor, Direction, AsOf, Limit, IgnoreExclusion }.
  queryTraffic: (request) => QueryTraffic(request),
  // after: "" counts every match, else only pairs captured after that id.
  // options: { AsOf, IgnoreExclusion }; AsOf counts only pairs up to it.
  countTraffic: (query, after, options = {}) => CountTraffic(query, after, options),
  getExclusion: () => GetContentTypeExclusion(),
  setExclusion: (types) => SetContentTypeExclusion(types),
  // False when the project follows the app default.
  hasOwnExclusion: () => HasOwnContentTypeExclusion(),
  resetExclusion: () => ResetContentTypeExclusion(),
  getDefaultExclusion: () => GetDefaultContentTypeExclusion(),
  setDefaultExclusion: (types) => SetDefaultContentTypeExclusion(types),
  countContentTypes: () => CountContentTypes(),
  getRawDetails: (id) => GetRawDetails(id),
  getMetadata: (id) => GetMetadata(id),
  getNote: (id) => GetNote(id),
  updateNote: (id, text) => UpdateNote(id, text),
  // A selection is Marasi's: { ids }, or { query, exclusion, as_of } after
  // ⌘A. Each bulk call resolves to how many pairs changed.
  setHighlight: (selection, highlight) => SetHighlight(selection, highlight),
  clearHighlight: (selection) => ClearHighlight(selection),
  createLaunchpad: (name, description) => CreateLaunchpadEntry(name, description),
  deleteLaunchpad: (id) => DeleteLaunchpad(id),
  // target: { Kind: "launchpad" | "finding" | "test_case", ID }. The
  // finding and test case lists reread their links afterwards.
  linkTraffic: (selection, target) => relinked(LinkTraffic(selection, target), target.Kind),
  unlinkTraffic: (selection, target) => relinked(UnlinkTraffic(selection, target), target.Kind),
  appendNote: (selection, text) => AppendNote(selection, text),
  clearNotes: (selection) => ClearNotes(selection),
  // Deleting drops the pairs' links too.
  deleteTraffic: (selection) => relinked(DeleteTraffic(selection), "all"),
  // Armory templates go through their store, so its list stays current.
  sendToArmory: (requestId) => armoryStore.createTemplateFromRequest(requestId),
});

if (typeof window !== "undefined") {
  setInterval(ledgerStore.flush, FLUSH_INTERVAL_MS);
}
