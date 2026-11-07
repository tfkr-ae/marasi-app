// The app's launchpad store over the service client. The logic is in
// createLaunchpadStore.js and the API shapes in launchpadApi.js; this file
// binds them to the app's client and routes the stream's events to the store.
import { SetUnsavedDraftCount } from "../lib/bindings/github.com/tfkr-ae/marasi-app/app.js";
import { service } from "../lib/service/index.js";
import { loadSignals } from "../lib/openProgress.js";
import { createLaunchpadStore } from "./createLaunchpadStore.js";
import { createLaunchpadApi, toLaunch, toRequest, toResponse } from "./launchpadApi.js";
import { reportUnsavedDraftCount } from "./draftGuards.js";
import { projectData } from "./projectData.js";
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

const api = createLaunchpadApi(service);

export const launchpadStore = createLaunchpadStore({
  ...api,
  // As the Ledger's: target is { Kind: "finding" | "test_case", ID }, and
  // that kind's list rereads its links afterwards.
  linkEntriesToRecord: (selection, target) => relinked(api.linkEntriesToRecord(selection, target), target.Kind),
  unlinkEntriesFromRecord: (selection, target) => relinked(api.unlinkEntriesFromRecord(selection, target), target.Kind),
});

/** An entry's note ("" for none) and metadata, for the entry menu's views. */
export const entryNote = api.getNote;
export const entryMetadata = api.getMetadata;

projectData.register("launchpad", {
  signal: loadSignals.launchpads,
  clear: launchpadStore.clear,
  load: () => launchpadStore.populate(),
  resync: launchpadStore.resync,
});

const logged = (what) => (promise) =>
  Promise.resolve(promise).catch((err) => console.error(`Launchpad ${what} failed:`, err));

service.on("traffic.request", (request) => logged("request arrival")(launchpadStore.onRequest(toRequest(request))));
service.on("traffic.response", (response) => logged("response arrival")(launchpadStore.onResponse(toResponse(response))));
service.on("launch.started", (launch) => launchpadStore.onLaunchStarted(toLaunch(launch)));
for (const ended of ["launch.completed", "launch.failed", "launch.cancelled"]) {
  service.on(ended, (launch) => logged("launch end")(launchpadStore.onLaunchFinished(toLaunch(launch))));
}

// Keeps the Go side told how many launchpads have unsaved drafts, so quitting
// can ask first. Returns the unsubscribe function.
export function reportUnsavedDrafts() {
  return reportUnsavedDraftCount(launchpadStore, (count) =>
    SetUnsavedDraftCount(count).catch((err) =>
      console.error("reporting unsaved launchpad drafts:", err),
    ),
  );
}
