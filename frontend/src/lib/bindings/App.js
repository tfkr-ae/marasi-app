// The v1 Wails bindings, by name. Each is a not ported stub until its ticket
// ports it to the Marasi client module or the main process.

import { createAppConfigBindings } from "./appConfig.js";
import { notPorted } from "./notPorted.js";

// The app config and keybinding profile files, owned by the main process.
const appConfig = createAppConfigBindings(() => globalThis.window?.marasiApp?.appConfig);
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

export const AddChromePath = notPorted("AddChromePath");
export const AddChromeProfile = notPorted("AddChromeProfile");
export const AddUpstreamProxy = notPorted("AddUpstreamProxy");
export const AppendNote = notPorted("AppendNote");
export const CancelArmoryRun = notPorted("CancelArmoryRun");
export const CancelLaunch = notPorted("CancelLaunch");
export const CancelUpdateDownload = notPorted("CancelUpdateDownload");
export const CheckForUpdate = notPorted("CheckForUpdate");
export const CheckHTTPParse = notPorted("CheckHTTPParse");
export const CheckUpstreamProxy = notPorted("CheckUpstreamProxy");
export const ClearHighlight = notPorted("ClearHighlight");
export const ClearNotes = notPorted("ClearNotes");
export const CloseWebSocket = notPorted("CloseWebSocket");
export const CopyCertToClipboard = notPorted("CopyCertToClipboard");
export const CountArmoryRunTraffic = notPorted("CountArmoryRunTraffic");
export const CountContentTypes = notPorted("CountContentTypes");
export const CountNotes = notPorted("CountNotes");
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
export const DismissUpdate = notPorted("DismissUpdate");
export const DoExtender = notPorted("DoExtender");
export const DownloadArtifact = notPorted("DownloadArtifact");
export const DownloadCert = notPorted("DownloadCert");
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
export const GetBuildInfo = notPorted("GetBuildInfo");
export const GetCheckpoint = notPorted("GetCheckpoint");
export const GetCheckpointItems = notPorted("GetCheckpointItems");
export const GetChromePaths = notPorted("GetChromePaths");
export const GetChromeProfiles = notPorted("GetChromeProfiles");
export const GetClientSetting = notPorted("GetClientSetting");
export const GetContentTypeExclusion = notPorted("GetContentTypeExclusion");
export const GetExtensionCode = notPorted("GetExtensionCode");
export const GetExtensionFlag = notPorted("GetExtensionFlag");
export const GetExtensionLogs = notPorted("GetExtensionLogs");
export const GetExtensionUI = notPorted("GetExtensionUI");
export const GetExtensions = notPorted("GetExtensions");
export const GetInterceptFlag = notPorted("GetInterceptFlag");
export const GetInterfaces = notPorted("GetInterfaces");
export const GetLaunch = notPorted("GetLaunch");
export const GetLaunchpadRequests = notPorted("GetLaunchpadRequests");
export const GetLaunchpads = notPorted("GetLaunchpads");
export const GetLogs = notPorted("GetLogs");
export const GetMetadata = notPorted("GetMetadata");
export const GetNote = notPorted("GetNote");
export const GetRawDetails = notPorted("GetRawDetails");
export const GetRecentProjects = notPorted("GetRecentProjects");
export const GetResponse = notPorted("GetResponse");
export const GetScopeRules = notPorted("GetScopeRules");
export const GetUpdateSettings = notPorted("GetUpdateSettings");
export const GetUpdateState = notPorted("GetUpdateState");
export const GetUpstreamProxies = notPorted("GetUpstreamProxies");
export const GetUserName = notPorted("GetUserName");
export const GetWSInterceptFlag = notPorted("GetWSInterceptFlag");
export const GetWSIntercepted = notPorted("GetWSIntercepted");
export const GetWaypoints = notPorted("GetWaypoints");
export const GetWebSocketConnection = notPorted("GetWebSocketConnection");
export const GetWebSocketMessages = notPorted("GetWebSocketMessages");
export const HasOwnContentTypeExclusion = notPorted("HasOwnContentTypeExclusion");
export const InjectWebSocketMessage = notPorted("InjectWebSocketMessage");
export const InstallUpdate = notPorted("InstallUpdate");
export const Launch = notPorted("Launch");
export const LinkRequestToFinding = notPorted("LinkRequestToFinding");
export const LinkRequestToLaunchpad = notPorted("LinkRequestToLaunchpad");
export const LinkRequestToTestCase = notPorted("LinkRequestToTestCase");
export const LinkTraffic = notPorted("LinkTraffic");
export const ListClientSettings = notPorted("ListClientSettings");
export const ListFindings = notPorted("ListFindings");
export const ListJobs = notPorted("ListJobs");
export const ListSitemapChildren = notPorted("ListSitemapChildren");
export const ListSitemapLevels = notPorted("ListSitemapLevels");
export const ListTemplates = notPorted("ListTemplates");
export const ListTestCases = notPorted("ListTestCases");
export const LoadExtensions = notPorted("LoadExtensions");
export const MoveLaunchpadEntries = notPorted("MoveLaunchpadEntries");
export const OpenFileDialog = notPorted("OpenFileDialog");
export const OpenProject = notPorted("OpenProject");
export const PendingLaunches = notPorted("PendingLaunches");
export const PreviewArmoryWordlist = notPorted("PreviewArmoryWordlist");
export const QueryArmoryRunTraffic = notPorted("QueryArmoryRunTraffic");
export const QueryTraffic = notPorted("QueryTraffic");
export const ReadUpstreamProxyCAFile = notPorted("ReadUpstreamProxyCAFile");
export const RebuildJob = notPorted("RebuildJob");
export const ReinstallLatestRelease = notPorted("ReinstallLatestRelease");
export const RemoveUpstreamProxy = notPorted("RemoveUpstreamProxy");
export const ResetContentTypeExclusion = notPorted("ResetContentTypeExclusion");
export const RestartToUpdate = notPorted("RestartToUpdate");
export const RestoreDefaultReportTemplate = notPorted("RestoreDefaultReportTemplate");
export const RunExtension = notPorted("RunExtension");
export const SaveArtifactToFinding = notPorted("SaveArtifactToFinding");
export const SaveArtifactToTestCase = notPorted("SaveArtifactToTestCase");
export const SaveFinding = notPorted("SaveFinding");
export const SaveTestCase = notPorted("SaveTestCase");
export const ScratchpadPath = notPorted("ScratchpadPath");
export const SearchLaunchpadEntries = notPorted("SearchLaunchpadEntries");
export const SetAutomaticUpdateChecks = notPorted("SetAutomaticUpdateChecks");
export const SetClientSetting = notPorted("SetClientSetting");
export const SetContentTypeExclusion = notPorted("SetContentTypeExclusion");
export const SetHighlight = notPorted("SetHighlight");
export const SetIntercept = notPorted("SetIntercept");
export const SetUnsavedDraftCount = notPorted("SetUnsavedDraftCount");
export const SetUpdateChannel = notPorted("SetUpdateChannel");
export const SetWSIntercept = notPorted("SetWSIntercept");
export const SetupScratchpad = notPorted("SetupScratchpad");
export const StartArmoryRun = notPorted("StartArmoryRun");
export const StartBrowser = notPorted("StartBrowser");
export const StartProxy = notPorted("StartProxy");
export const StopProxy = notPorted("StopProxy");
export const TestScopeMatch = notPorted("TestScopeMatch");
export const ToggleIntercept = notPorted("ToggleIntercept");
export const ToggleWSIntercept = notPorted("ToggleWSIntercept");
export const UnlinkRequestFromFinding = notPorted("UnlinkRequestFromFinding");
export const UnlinkRequestFromTestCase = notPorted("UnlinkRequestFromTestCase");
export const UnlinkTraffic = notPorted("UnlinkTraffic");
export const UpdateArmoryTemplate = notPorted("UpdateArmoryTemplate");
export const UpdateLaunchpadEntry = notPorted("UpdateLaunchpadEntry");
export const UpdateNote = notPorted("UpdateNote");
export const UpdateProxy = notPorted("UpdateProxy");
export const UpdateUpstreamProxy = notPorted("UpdateUpstreamProxy");
export const UseUpstreamProxy = notPorted("UseUpstreamProxy");
export const ValidateArmoryRun = notPorted("ValidateArmoryRun");
