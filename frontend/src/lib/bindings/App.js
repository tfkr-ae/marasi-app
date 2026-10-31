// The v1 Wails bindings, by name. Each is a not ported stub until its ticket
// ports it to the Marasi client module or the main process.

import { createAppConfigBindings } from "./appConfig.js";
import { notPorted } from "./notPorted.js";
import { marasi, MarasiError } from "./marasi.js";
import { pairSummary } from "./traffic.js";
import { createUpdateBindings } from "./updates.js";
import { browserBridge } from "./browserBridge.js";

// The main process bridge, or in a plain browser the dev server's.
const bridge = () => (globalThis.window ? (globalThis.window.marasiApp ?? browserBridge) : undefined);

// The app config and keybinding profile files, owned by the main process.
const appConfig = createAppConfigBindings(() => bridge()?.appConfig);
export const {
  ExportKeybindingProfile,
  GetAppSavedQueries,
  GetDefaultContentTypeExclusion,
  GetHighlights,
  GetKeybindings,
  GetMarasiConfig,
  ImportKeybindingProfile,
  MigrateOldHighlights,
  ResetHighlights,
  SaveAppSavedQueries,
  SaveHighlights,
  SaveKeybindings,
  SetDefaultContentTypeExclusion,
  SetFlag,
  SetHiddenBuiltinQueries,
  ToggleFlag,
} = appConfig;

// The app's own updates, owned by the main process's updater.
export const {
  CancelUpdateDownload,
  CheckForUpdate,
  DismissUpdate,
  GetUpdateSettings,
  GetUpdateState,
  InstallUpdate,
  ReinstallLatestRelease,
  RestartToUpdate,
  SetAutomaticUpdateChecks,
  SetUpdateChannel,
} = createUpdateBindings(() => bridge()?.updates);

// The background jobs Settings → Maintenance can rebuild, as in v1's jobs.go;
// Marasi refuses the others with not_rebuildable.
const rebuildableJobs = new Set(["traffic_index", "annotation_index", "sitemap"]);

// A GET /jobs item as v1's JobState.
const jobState = (job) => ({
  Name: job.name,
  Complete: job.complete,
  Done: job.done,
  Total: job.total,
  Rebuildable: rebuildableJobs.has(job.name),
});

// The Ledger's content-type exclusion: the project's own list, a marasi-app
// client setting, or else the app default
// (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
const exclusionSetting = "/client-settings/marasi-app/ledger.exclusion";

// The project's own exclusion setting, or null when it follows the app default.
async function ownExclusion() {
  try {
    return await marasi.get(exclusionSetting);
  } catch (error) {
    if (error instanceof MarasiError && error.code === "not_found") return null;
    throw error;
  }
}

// A traffic read's query string: `params` with empty values dropped, and
// the exclusion as repeated `exclude`s.
function trafficQuery(params, exclusion = []) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
  }
  for (const type of exclusion) query.append("exclude", type);
  const text = query.toString();
  return text ? `?${text}` : "";
}

// Runs a traffic read; Marasi's invalid_query refusal answers as v1's
// QueryError data, { QueryError: { Message, Position } }.
async function readTraffic(read) {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof MarasiError) || error.code !== "invalid_query") throw error;
    return { QueryError: { Message: error.body.message ?? "invalid query", Position: error.body.position ?? 0 } };
  }
}

/** The app's own build, { Channel, Version }, from the main process. */
export const GetBuildInfo = () => bridge().buildInfo();

export const AddChromePath = notPorted("AddChromePath");
export const AddChromeProfile = notPorted("AddChromeProfile");
export const AddUpstreamProxy = notPorted("AddUpstreamProxy");
export const AppendNote = notPorted("AppendNote");
export const CancelArmoryRun = notPorted("CancelArmoryRun");
export const CancelLaunch = notPorted("CancelLaunch");
export const CheckHTTPParse = notPorted("CheckHTTPParse");
export const CheckUpstreamProxy = notPorted("CheckUpstreamProxy");
export const ClearHighlight = notPorted("ClearHighlight");
export const ClearNotes = notPorted("ClearNotes");
export const CloseWebSocket = notPorted("CloseWebSocket");
// The instance's CA certificate, on this machine's clipboard. Resolves true.
export const CopyCertToClipboard = async () => {
  const { pem } = await marasi.get("/certificate");
  await bridge().copyText(pem);
  return true;
};
export const CountArmoryRunTraffic = notPorted("CountArmoryRunTraffic");
export const CountContentTypes = notPorted("CountContentTypes");
// The dashboard's counts, in v1's Dashboard shape. InterceptionsComplete is
// false while Marasi's intercepted_count job still counts older pairs.
export const CountNotes = async () => {
  const dashboard = await marasi.get("/dashboard");
  return {
    Requests: dashboard.pairs,
    Notes: dashboard.notes,
    Launchpads: dashboard.launchpads,
    Interceptions: dashboard.intercepted,
    InterceptionsComplete: dashboard.intercepted_count?.complete !== false,
  };
};
export const CountTraffic = notPorted("CountTraffic");
export const CreateArmoryRun = notPorted("CreateArmoryRun");
export const CreateArmoryTemplate = notPorted("CreateArmoryTemplate");
export const CreateArmoryTemplateFromRequest = notPorted("CreateArmoryTemplateFromRequest");
export const CreateDraftFinding = notPorted("CreateDraftFinding");
export const CreateDraftTestCase = notPorted("CreateDraftTestCase");
export const CreateLaunchpadEntry = notPorted("CreateLaunchpadEntry");
export const CreateWaypoint = notPorted("CreateWaypoint");
export const DeleteArmoryRun = notPorted("DeleteArmoryRun");
export const DeleteArmoryTemplate = notPorted("DeleteArmoryTemplate");
export const DeleteArtifact = notPorted("DeleteArtifact");
export const DeleteChromePath = notPorted("DeleteChromePath");
export const DeleteChromeProfile = notPorted("DeleteChromeProfile");
export const DeleteClientSetting = notPorted("DeleteClientSetting");
export const DeleteFinding = notPorted("DeleteFinding");
export const DeleteLaunchpad = notPorted("DeleteLaunchpad");
export const DeleteTestCase = notPorted("DeleteTestCase");
export const DeleteTraffic = notPorted("DeleteTraffic");
export const DeleteWaypoint = notPorted("DeleteWaypoint");
export const DoExtender = notPorted("DoExtender");
export const DownloadArtifact = notPorted("DownloadArtifact");
// Saves the instance's CA certificate on this machine, through a save
// dialog. Resolves false when the researcher cancels.
export const DownloadCert = async () => {
  const { pem } = await marasi.get("/certificate");
  return Boolean(await bridge().saveCertificate(pem));
};
export const DropCheckpoint = notPorted("DropCheckpoint");
export const DropCheckpoints = notPorted("DropCheckpoints");
export const DropWSIntercepted = notPorted("DropWSIntercepted");
export const ExportReport = notPorted("ExportReport");
export const ForwardCheckpoint = notPorted("ForwardCheckpoint");
export const ForwardCheckpoints = notPorted("ForwardCheckpoints");
export const ForwardWSIntercepted = notPorted("ForwardWSIntercepted");
export const GetActiveArmoryRunIDs = notPorted("GetActiveArmoryRunIDs");
export const GetArmoryRun = notPorted("GetArmoryRun");
export const GetArmoryRunRequests = notPorted("GetArmoryRunRequests");
export const GetArmoryRuns = notPorted("GetArmoryRuns");
export const GetArmoryTemplates = notPorted("GetArmoryTemplates");
export const GetArmoryWordlists = notPorted("GetArmoryWordlists");
export const GetArtifact = notPorted("GetArtifact");
export const GetCheckpoint = notPorted("GetCheckpoint");
export const GetCheckpointItems = notPorted("GetCheckpointItems");
export const GetChromePaths = notPorted("GetChromePaths");
export const GetChromeProfiles = notPorted("GetChromeProfiles");
export const GetClientSetting = notPorted("GetClientSetting");
// The open project's exclusion: its own list when it has one, else the app
// default.
export const GetContentTypeExclusion = async () =>
  (await ownExclusion())?.value ?? (await appConfig.GetDefaultContentTypeExclusion());
export const GetExtensionCode = notPorted("GetExtensionCode");
export const GetExtensionFlag = notPorted("GetExtensionFlag");
export const GetExtensionLogs = notPorted("GetExtensionLogs");
export const GetExtensionUI = notPorted("GetExtensionUI");
export const GetExtensions = notPorted("GetExtensions");
export const GetInterceptFlag = notPorted("GetInterceptFlag");
// The instance machine's addresses the listener can bind:
// [{address, family, interface}], IPv4 first.
export const GetInterfaces = async () => (await marasi.get("/listener/interfaces")).items ?? [];
export const GetLaunch = notPorted("GetLaunch");
export const GetLaunchpadRequests = notPorted("GetLaunchpadRequests");
export const GetLaunchpads = notPorted("GetLaunchpads");
// One page of the log, newest first: {items, next_cursor}. `cursor` is the
// last page's next_cursor.
export const GetLogs = (cursor) =>
  marasi.get(`/logs?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
export const GetMetadata = notPorted("GetMetadata");
export const GetNote = notPorted("GetNote");
export const GetRawDetails = notPorted("GetRawDetails");
// The instance's projects, by name: [{name, project, modified_at}], where
// `project` is the path on the instance machine.
export const GetRecentProjects = async () => (await marasi.get("/project/list")).items ?? [];
export const GetResponse = notPorted("GetResponse");
export const GetScopeRules = notPorted("GetScopeRules");
export const GetUpstreamProxies = notPorted("GetUpstreamProxies");
// This machine's user, the report assessor default.
export const GetUserName = () => bridge().userName();
export const GetWSInterceptFlag = notPorted("GetWSInterceptFlag");
export const GetWSIntercepted = notPorted("GetWSIntercepted");
export const GetWaypoints = notPorted("GetWaypoints");
export const GetWebSocketConnection = notPorted("GetWebSocketConnection");
export const GetWebSocketMessages = notPorted("GetWebSocketMessages");
export const HasOwnContentTypeExclusion = notPorted("HasOwnContentTypeExclusion");
export const InjectWebSocketMessage = notPorted("InjectWebSocketMessage");
export const Launch = notPorted("Launch");
export const LinkRequestToFinding = notPorted("LinkRequestToFinding");
export const LinkRequestToLaunchpad = notPorted("LinkRequestToLaunchpad");
export const LinkRequestToTestCase = notPorted("LinkRequestToTestCase");
export const LinkTraffic = notPorted("LinkTraffic");
export const ListClientSettings = notPorted("ListClientSettings");
export const ListFindings = notPorted("ListFindings");
// The open project's background jobs, in v1's JobState shape.
export const ListJobs = async () => ((await marasi.get("/jobs")).items ?? []).map(jobState);
export const ListSitemapChildren = notPorted("ListSitemapChildren");
export const ListSitemapLevels = notPorted("ListSitemapLevels");
export const ListTemplates = notPorted("ListTemplates");
export const ListTestCases = notPorted("ListTestCases");
export const LoadExtensions = notPorted("LoadExtensions");
export const MoveLaunchpadEntries = notPorted("MoveLaunchpadEntries");
// A project file picked in this machine's open dialog, for a local
// connection: its path, or null.
export const OpenFileDialog = () => bridge().pickProject("Open project");
// Opens `project` on the instance: a bare name in its projects directory, or
// a path on the instance machine. Resolves to the path it opened once the
// switch is done; Marasi waits for held Checkpoint items first.
export const OpenProject = async (project) => {
  const target = String(project);
  const body = /[\\/]/.test(target) ? { path: target } : { name: target };
  return (await marasi.post("/project/open", body)).project;
};
export const PendingLaunches = notPorted("PendingLaunches");
export const PreviewArmoryWordlist = notPorted("PreviewArmoryWordlist");
export const QueryArmoryRunTraffic = notPorted("QueryArmoryRunTraffic");
// One page of the traffic that matches `request.Query`, in display order,
// minus the project's exclusion unless `request.IgnoreExclusion`:
// v1's { Items, NextCursor, PrevCursor, AsOf, IndexComplete, QueryError }.
export const QueryTraffic = (request) =>
  readTraffic(async () => {
    const exclusion = request.IgnoreExclusion ? [] : await GetContentTypeExclusion();
    const page = await marasi.get(
      "/traffic" +
        trafficQuery(
          {
            q: request.Query,
            order_by: request.OrderBy,
            cursor: request.Cursor,
            direction: request.Direction,
            as_of: request.AsOf,
            limit: request.Limit,
          },
          exclusion,
        ),
    );
    return {
      // Marasi lists a page in reverse display order.
      Items: (page.items ?? []).map(pairSummary).reverse(),
      NextCursor: page.next_cursor ?? null,
      PrevCursor: page.prev_cursor ?? null,
      AsOf: page.as_of ?? "",
      IndexComplete: page.index?.complete ?? true,
      QueryError: null,
    };
  });
export const ReadUpstreamProxyCAFile = notPorted("ReadUpstreamProxyCAFile");
export const RebuildJob = (name) => marasi.post(`/jobs/${encodeURIComponent(name)}/rebuild`);
export const RemoveUpstreamProxy = notPorted("RemoveUpstreamProxy");
export const ResetContentTypeExclusion = notPorted("ResetContentTypeExclusion");
export const RestoreDefaultReportTemplate = notPorted("RestoreDefaultReportTemplate");
export const RunExtension = notPorted("RunExtension");
export const SaveArtifactToFinding = notPorted("SaveArtifactToFinding");
export const SaveArtifactToTestCase = notPorted("SaveArtifactToTestCase");
export const SaveFinding = notPorted("SaveFinding");
export const SaveTestCase = notPorted("SaveTestCase");
// The instance's scratchpad's path, or null when it has none yet.
export const ScratchpadPath = async () =>
  (await GetRecentProjects()).find((item) => item.name === "scratchpad")?.project ?? null;
export const SearchLaunchpadEntries = notPorted("SearchLaunchpadEntries");
export const SetClientSetting = notPorted("SetClientSetting");
export const SetContentTypeExclusion = notPorted("SetContentTypeExclusion");
export const SetHighlight = notPorted("SetHighlight");
export const SetIntercept = notPorted("SetIntercept");
export const SetUnsavedDraftCount = notPorted("SetUnsavedDraftCount");
export const SetWSIntercept = notPorted("SetWSIntercept");
export const SetupScratchpad = notPorted("SetupScratchpad");
export const StartArmoryRun = notPorted("StartArmoryRun");
export const StartBrowser = notPorted("StartBrowser");
// The proxy listener; each resolves Marasi's listener status.
export const StartProxy = (address, port) => marasi.post("/listener/start", { address, port: Number(port) });
export const StopProxy = () => marasi.post("/listener/stop");
export const TestScopeMatch = notPorted("TestScopeMatch");
export const ToggleIntercept = notPorted("ToggleIntercept");
export const ToggleWSIntercept = notPorted("ToggleWSIntercept");
export const UnlinkRequestFromFinding = notPorted("UnlinkRequestFromFinding");
export const UnlinkRequestFromTestCase = notPorted("UnlinkRequestFromTestCase");
export const UnlinkTraffic = notPorted("UnlinkTraffic");
export const UpdateArmoryTemplate = notPorted("UpdateArmoryTemplate");
export const UpdateLaunchpadEntry = notPorted("UpdateLaunchpadEntry");
export const UpdateNote = notPorted("UpdateNote");
export const UpdateProxy = (address, port) => marasi.post("/listener/update", { address, port: Number(port) });
export const UpdateUpstreamProxy = notPorted("UpdateUpstreamProxy");
export const UseUpstreamProxy = notPorted("UseUpstreamProxy");
export const ValidateArmoryRun = notPorted("ValidateArmoryRun");
