// The v1 Wails bindings, by name. Each is a not ported stub until its ticket
// ports it to the Marasi client module or the main process.

import { createAppConfigBindings } from "./appConfig.js";
import { NotPorted, notPorted } from "./notPorted.js";
import { isRemoteConnection, marasi } from "./marasi.js";
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

// The instance's Chrome, on a local connection: its paths and profiles are
// the machine's, and Start Chrome opens a window on it through the
// instance's proxy listener. A remote connection's Chrome is this
// machine's, which isn't ported yet, so the instance's never starts there.
const instanceChrome =
  (binding, call) =>
  (...args) =>
    isRemoteConnection() ? Promise.reject(new NotPorted(binding)) : call(...args);
// A GET /chrome/path list as v1's [{OS, Path}], and a profile list as names.
const chromePaths = (answer) => (answer?.items ?? []).map((item) => ({ OS: item.os, Path: item.path }));
const chromeProfiles = (answer) => (answer?.items ?? []).map((item) => item.name);
const chromeProfilePath = (name) => `/chrome/profile/${encodeURIComponent(name)}`;

export const GetChromePaths = instanceChrome("GetChromePaths", async () => chromePaths(await marasi.get("/chrome/path")));
export const AddChromePath = instanceChrome("AddChromePath", async (path, os) =>
  chromePaths(await marasi.post("/chrome/path", { os, path })),
);
export const DeleteChromePath = instanceChrome("DeleteChromePath", async (path, os) =>
  chromePaths(await marasi.delete("/chrome/path", { os, path })),
);
export const GetChromeProfiles = instanceChrome("GetChromeProfiles", async () =>
  chromeProfiles(await marasi.get("/chrome/profile")),
);
export const AddChromeProfile = instanceChrome("AddChromeProfile", async (name) =>
  chromeProfiles(await marasi.post("/chrome/profile", { name })),
);
export const DeleteChromeProfile = instanceChrome("DeleteChromeProfile", async (name) =>
  chromeProfiles(await marasi.delete(chromeProfilePath(name))),
);
// Opens a Chrome window on `profile`, or the default profile for "". The
// app opens it for the researcher, so it asks for no CDP endpoint, as v1.
export const StartBrowser = instanceChrome("StartBrowser", async (profile) => {
  await marasi.post("/chrome/start", profile ? { profile } : {});
});

// This machine's upstream proxies and the open project's selection:
// {items, selected, configured}, items redacted to {name, scheme, host,
// port, has_credentials, has_ca}.
const upstreamProxyPath = (name) => `/upstream-proxy/${encodeURIComponent(name)}`;
export const GetUpstreamProxies = () => marasi.get("/upstream-proxy");
// Adds an entry; `ca` is a PEM bundle, "" for none.
export const AddUpstreamProxy = (name, url, ca) => marasi.post("/upstream-proxy", ca ? { name, url, ca } : { name, url });
// Changes the named entry. An empty url or ca leaves it as it is, and
// removeCA drops the CA.
export const UpdateUpstreamProxy = async (name, url, ca, removeCA) => {
  const update = {};
  if (url) update.url = url;
  if (removeCA) update.ca = null;
  else if (ca) update.ca = ca;
  if (!Object.keys(update).length) throw new Error("upstream proxy update: nothing to change");
  return marasi.post(upstreamProxyPath(name), update);
};
// Removes the named entry. A project that selected it keeps the selection,
// and its traffic fails closed.
export const RemoveUpstreamProxy = (name) => marasi.delete(upstreamProxyPath(name));
// Selects the open project's upstream proxy, "" for direct, and answers
// the whole list, as v1 did.
export const UseUpstreamProxy = async (name) => {
  await marasi.put("/upstream-proxy-selection", { name });
  return GetUpstreamProxies();
};
// One test connection to `target` through the named entry, selected or not.
export const CheckUpstreamProxy = (name, target) => marasi.post(`${upstreamProxyPath(name)}/check`, { target });
// A CA file picked on this machine, its text unparsed; "" when cancelled.
// Marasi checks it when the entry is added or updated.
export const ReadUpstreamProxyCAFile = () => bridge().readCAFile();

// The open project's waypoints, as v1's {hostname: override} map.
export const GetWaypoints = async () =>
  Object.fromEntries(((await marasi.get("/waypoint")).items ?? []).map((item) => [item.hostname, item.override]));
// Sets `host`'s override: adds a waypoint, or updates the one it has, as
// v1's create or update did.
export const CreateWaypoint = async (hostname, override) => {
  try {
    await marasi.post("/waypoint", { hostname, override });
  } catch (error) {
    if (error?.code !== "waypoint_already_exists") throw error;
    await marasi.post("/waypoint/update", { hostname, override });
  }
};
export const DeleteWaypoint = async (hostname) => {
  await marasi.delete("/waypoint", { hostname });
};

/** The app's own build, { Channel, Version }, from the main process. */
export const GetBuildInfo = () => bridge().buildInfo();

export const AppendNote = notPorted("AppendNote");
export const CancelArmoryRun = notPorted("CancelArmoryRun");
export const CancelLaunch = notPorted("CancelLaunch");
export const CheckHTTPParse = notPorted("CheckHTTPParse");
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
export const DeleteArmoryRun = notPorted("DeleteArmoryRun");
export const DeleteArmoryTemplate = notPorted("DeleteArmoryTemplate");
export const DeleteArtifact = notPorted("DeleteArtifact");
export const DeleteClientSetting = notPorted("DeleteClientSetting");
export const DeleteFinding = notPorted("DeleteFinding");
export const DeleteLaunchpad = notPorted("DeleteLaunchpad");
export const DeleteTestCase = notPorted("DeleteTestCase");
export const DeleteTraffic = notPorted("DeleteTraffic");
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
export const GetClientSetting = notPorted("GetClientSetting");
export const GetContentTypeExclusion = notPorted("GetContentTypeExclusion");
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
// This machine's user, the report assessor default.
export const GetUserName = () => bridge().userName();
export const GetWSInterceptFlag = notPorted("GetWSInterceptFlag");
export const GetWSIntercepted = notPorted("GetWSIntercepted");
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
export const QueryTraffic = notPorted("QueryTraffic");
export const RebuildJob = (name) => marasi.post(`/jobs/${encodeURIComponent(name)}/rebuild`);
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
export const ValidateArmoryRun = notPorted("ValidateArmoryRun");
