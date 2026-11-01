// The v1 Wails bindings, by name. Each is a not ported stub until its ticket
// ports it to the Marasi client module or the main process.

import { createAppConfigBindings } from "./appConfig.js";
import { createChromeBindings } from "./chrome.js";
import { notPorted } from "./notPorted.js";
import { marasi, MarasiError } from "./marasi.js";
import { pairRow, pairSummary, rawText, sitemapNodeCount } from "./traffic.js";
import { launchOf, launchpadOf } from "./launchpads.js";
import { armoryRun, armoryTemplate, wordlistInfos } from "./armory.js";
import { reportBody, reportFilename, templateNames } from "./reports.js";
import { artifactMetadata, findingFields, findingRecord, testCaseFields, testCaseRecord } from "./records.js";
import { heldMessage, webSocketConnection, webSocketMessage } from "./websocket.js";
import { normalizeExclusion } from "../ledger/contentTypes.js";
import { createUpdateBindings } from "./updates.js";
import { browserBridge } from "./browserBridge.js";
import { isCheckpointGone } from "../checkpointHeld.js";
import { checkHTTPParse } from "../checkpoint/httpParse.js";

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

// The project's extensions, by name as in v1.
export {
  DoExtender,
  GetExtensionCode,
  GetExtensionFlag,
  GetExtensionLogs,
  GetExtensionUI,
  GetExtensions,
  LoadExtensions,
  RunExtension,
} from "./extensions.js";

// Chrome: the instance's on a local connection, this machine's on a remote
// one (chrome.js).
export const {
  AddChromePath,
  AddChromeProfile,
  DeleteChromePath,
  DeleteChromeProfile,
  GetChromePaths,
  GetChromeProfiles,
  GetLocalChromeProxy,
  SetLocalChromeProxy,
  StartBrowser,
} = createChromeBindings(() => bridge()?.localChrome);

// This machine's upstream proxies and the open project's selection:
// {items, selected, configured}, items redacted to {name, scheme, host,
// port, has_credentials, has_ca}. Marasi answers a change with the list
// alone, so each change reads the whole state after it, as v1 answered.
const upstreamProxyPath = (name) => `/upstream-proxy/${encodeURIComponent(name)}`;
export const GetUpstreamProxies = () => marasi.get("/upstream-proxy");
// Adds an entry; `ca` is a PEM bundle, "" for none.
export const AddUpstreamProxy = async (name, url, ca) => {
  await marasi.post("/upstream-proxy", ca ? { name, url, ca } : { name, url });
  return GetUpstreamProxies();
};
// Changes the named entry. An empty url or ca leaves it as it is, and
// removeCA drops the CA.
export const UpdateUpstreamProxy = async (name, url, ca, removeCA) => {
  const update = {};
  if (url) update.url = url;
  if (removeCA) update.ca = null;
  else if (ca) update.ca = ca;
  if (!Object.keys(update).length) throw new Error("upstream proxy update: nothing to change");
  await marasi.post(upstreamProxyPath(name), update);
  return GetUpstreamProxies();
};
// Removes the named entry. A project that selected it keeps the selection,
// and its traffic fails closed.
export const RemoveUpstreamProxy = async (name) => {
  await marasi.delete(upstreamProxyPath(name));
  return GetUpstreamProxies();
};
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

// The Ledger's content-type exclusion: the project's own list, a marasi-app
// client setting, or else the app default
// (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
const exclusionSetting = "/client-settings/marasi-app/ledger.exclusion";

// The app's per-project settings: client settings under the client
// marasi-app (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
const clientSettings = "/client-settings/marasi-app";
const clientSetting = (key) => `${clientSettings}/${encodeURIComponent(key)}`;

// `call`'s answer, or null when Marasi answered not_found.
async function unlessNotFound(call) {
  try {
    return await call;
  } catch (error) {
    if (error instanceof MarasiError && error.code === "not_found") return null;
    throw error;
  }
}

const launchpadPath = (id) => `/launchpad/${encodeURIComponent(id)}`;

// What the entry search wraps the researcher's query in, as v1 did.
const launchpadSearchPrefix = "launchpad:* AND (";

// A pair in full, as Marasi answers GET /traffic/{id}.
const readPair = (id) => marasi.get(`/traffic/${encodeURIComponent(id)}`);

// An Armory template in full, as v1's ArmoryTemplate.
const readTemplate = async (id) => armoryTemplate(await marasi.get(`/armory/template/${encodeURIComponent(id)}`));

// The project's own exclusion setting, or null when it follows the app default.
const ownExclusion = () => unlessNotFound(marasi.get(exclusionSetting));
// The exclusion a traffic read names, else the project's; none with
// IgnoreExclusion. The Ledger names the one it holds, so it isn't read again.
const exclusionFor = async (options) =>
  options.IgnoreExclusion ? [] : (options.Exclusion ?? (await GetContentTypeExclusion()));

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

// A bulk change on a Ledger selection, Marasi's { ids } or { query,
// exclusion, as_of } (marasi docs/adr/2026-10-14-query-selections-stop-at-as-of.md):
// POST /traffic/bulk/{change} with the selection and `fields`. Resolves how
// many pairs changed, as v1 did. Refusals such as selection_incomplete and
// launch_pending read through the code helpers.
const bulk = async (change, selection, fields = {}) =>
  (await marasi.post(`/traffic/bulk/${change}`, { selection, ...fields })).count;

// v1's link target, { Kind: "launchpad" | "finding" | "test_case", ID },
// as the bulk link body's id field.
const linkTarget = (target) => ({ [`${target.Kind}_id`]: target.ID });

// The connection behind an upgrade pair, as Marasi answers it. v1's
// WebSocket bindings take the pair's request id; Marasi's routes take the
// connection's id.
const readConnection = (requestId) => marasi.get(`/traffic/${encodeURIComponent(requestId)}/websocket`);

const connectionPath = (connection) => `/websocket/${encodeURIComponent(connection.id)}`;

// The most messages Marasi lists in one GET /websocket/{id}/message page.
const maxMessagePage = 500;

// A Checkpoint item as v1's domain.CheckpointItem, with its InterceptedAt.
// Raw and Payload stay base64, as Wails sent a Go []byte.
const checkpointItem = (item) => ({
  ID: item.id,
  Type: item.type,
  Raw: item.raw ?? null,
  Payload: item.payload ?? null,
  Opcode: item.opcode ?? 0,
  Direction: item.direction ?? "",
  ConnectionID: item.connection_id ?? null,
  RequestID: item.request_id ?? null,
  InterceptedAt: item.intercepted_at,
});

// Text as Marasi takes bytes in JSON: UTF-8, base64.
const base64 = (text) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const checkpointPath = (id) => `/checkpoint/${encodeURIComponent(id)}`;

// Settles each of `ids` in turn with `settle`, as v1's settleCheckpoints:
// { Done, Gone, Failed }, where Gone counts items that had already left and
// Failed those whose call failed otherwise, which are logged and don't stop
// the rest.
async function settleCheckpoints(ids, settle) {
  const result = { Done: 0, Gone: 0, Failed: 0 };
  for (const id of ids) {
    try {
      await settle(id);
      result.Done++;
    } catch (err) {
      if (isCheckpointGone(err)) {
        result.Gone++;
      } else {
        result.Failed++;
        console.error(`Settling Checkpoint item ${id} failed:`, err);
      }
    }
  }
  return result;
}

// Findings and test cases: their routes, how each reads as v1's record, how
// v1's record saves as Marasi's fields, v1's draft, and the field a bulk
// link names it in.
const findings = {
  path: "/finding",
  record: findingRecord,
  fields: findingFields,
  draft: { title: "Draft Finding", severity: "High", writeup: "Writeup" },
  linkField: "finding_id",
};
const testCases = {
  path: "/test-case",
  record: testCaseRecord,
  fields: testCaseFields,
  draft: { title: "Draft Test Case", description: "Test Case Description", category: "XSS", note: "Test Note" },
  linkField: "test_case_id",
};

const recordPath = (kind, id) => `${kind.path}/${encodeURIComponent(id)}`;

// One record in full, with its pairs and artifacts.
const readRecord = async (kind, id) => kind.record(await marasi.get(recordPath(kind, id)));

// Every record of `kind`, each read in full, in Marasi's order.
async function listRecords(kind) {
  const { items } = await marasi.get(kind.path);
  return Promise.all((items ?? []).map((item) => readRecord(kind, item.id)));
}

// Saves every field of v1's `record`; its links and artifacts save apart.
const saveRecord = (kind, record) => marasi.post(recordPath(kind, record.ID), kind.fields(record));

// Creates v1's draft with `fields`, links `requests` to it in one call, and
// reads it back. A link that fails leaves the draft with the pairs it has:
// the Logbook links the rest one by one, and reports the one that fails.
async function createDraft(kind, requests, fields = {}) {
  const { id } = await marasi.post(kind.path, { ...kind.draft, ...fields });
  if (requests?.length) {
    await bulk("link", { ids: requests }, { [kind.linkField]: id }).catch((err) =>
      console.error(`Linking pairs to ${kind.path}/${id} failed:`, err),
    );
  }
  return readRecord(kind, id);
}

// Uploads a file read on this machine to the record, as v1's
// SaveArtifactTo*: its bytes (a Uint8Array or v1's list of numbers) as the
// body. Answers v1's ArtifactMetadata.
async function uploadArtifact(kind, id, filename, mimeType, data) {
  const path = `${recordPath(kind, id)}/artifact?${new URLSearchParams({ filename })}`;
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data ?? []);
  return artifactMetadata(await marasi.sendBytes("POST", path, bytes, mimeType || "application/octet-stream"));
}

const artifactPath = (id) => `/artifact/${encodeURIComponent(id)}`;

const deleteRecord = (kind, id) => marasi.delete(recordPath(kind, id));

const linkPair = (kind, id, request) => marasi.post(`${recordPath(kind, id)}/traffic`, { id: request });

const unlinkPair = (kind, id, request) =>
  marasi.delete(`${recordPath(kind, id)}/traffic/${encodeURIComponent(request)}`);

/** The app's own build, { Channel, Version }, from the main process. */
export const GetBuildInfo = () => bridge().buildInfo();

// Adds `text` to every note in `selection`, after a blank line when the pair
// already has one.
export const AppendNote = (selection, text) => bulk("note", selection, { append: text });
export const CancelArmoryRun = async (id) => {
  await marasi.post(`/armory/run/${encodeURIComponent(id)}/cancel`);
};
// Cancels a launch from any client. One that ended first resolves in its
// final state, as v1's did: Marasi's launch_finished carries it.
export const CancelLaunch = async (id) => {
  try {
    return launchOf(await marasi.post(`/launch/${encodeURIComponent(id)}/cancel`));
  } catch (err) {
    if (err instanceof MarasiError && err.code === "launch_finished") return launchOf(err.body);
    throw err;
  }
};
// Why an edited held request or response doesn't parse, in Go's words, or
// "". v1 checked it in Go; Marasi only refuses an unparsable forward.
export const CheckHTTPParse = async (text, type) => checkHTTPParse(text, type);
// Clears the highlight of every pair in `selection`.
export const ClearHighlight = (selection) => bulk("highlight", selection, { highlight: null });
export const ClearNotes = (selection) => bulk("note", selection, { clear: true });
// Closes the connection an upgrade pair opened.
export const CloseWebSocket = async (requestId, code, reason) => {
  const connection = await readConnection(requestId);
  await marasi.post(`${connectionPath(connection)}/close`, { code, reason });
};
// The instance's CA certificate, on this machine's clipboard. Resolves true.
export const CopyCertToClipboard = async () => {
  const { pem } = await marasi.get("/certificate");
  await bridge().copyText(pem);
  return true;
};
// The traffic query for the pairs the Armory run `runId` sent.
const armoryRunQuery = (runId) => `metadata.armory_run_id = ${JSON.stringify(String(runId))}`;
// An Armory run's pairs, whatever their content type, counted by `field`
// ("status_code" or "length") under `asOf`, or under the newest pair when
// it is "": v1's { Counts: [{ Value, Count }], AsOf }, most pairs first, a
// pair with no value under "". Marasi answers the as_of it counted under,
// which a group's pages and a query Selection pass back.
export const CountArmoryRunTraffic = async (runId, field, asOf = "") => {
  const counted = await marasi.get(
    "/traffic/count/by-field" + trafficQuery({ field, q: armoryRunQuery(runId), as_of: asOf }),
  );
  return {
    Counts: (counted.items ?? []).map((item) => ({ Value: item.value, Count: item.count })),
    AsOf: counted.as_of ?? "",
  };
};
// The project's pairs per content type: v1's { Counts: [{ ContentType,
// Count }], Complete: { sitemap } }.
export const CountContentTypes = async () => {
  const counts = await marasi.get("/traffic/content-types");
  return {
    Counts: (counts.items ?? []).map((item) => ({ ContentType: item.content_type, Count: item.count })),
    Complete: { sitemap: counts.sitemap?.complete ?? true },
  };
};
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
// How many pairs `query` matches, minus `options.Exclusion`, else the
// project's exclusion, unless `options.IgnoreExclusion`; `after` "" counts
// every match, else only pairs captured after it, and `options.AsOf` only
// pairs up to it. v1's { Count, Capped, IndexComplete, QueryError }.
export const CountTraffic = (query, after, options = {}) =>
  readTraffic(async () => {
    const exclusion = await exclusionFor(options);
    const counted = await marasi.get(
      "/traffic/count" + trafficQuery({ q: query, after, as_of: options.AsOf }, exclusion),
    );
    return {
      Count: counted.count,
      Capped: counted.capped,
      IndexComplete: counted.index?.complete ?? true,
      QueryError: null,
    };
  });
// A draft run of the template's current contents.
export const CreateArmoryRun = async (templateId, attackType, useHTTPS, wordlists, maxConcurrent) =>
  armoryRun(
    await marasi.post("/armory/run", {
      template_id: templateId,
      attack_type: attackType,
      use_https: useHTTPS,
      wordlists: wordlists ?? [],
      max_concurrent: maxConcurrent,
    }),
  );
export const CreateArmoryTemplate = async (name, description, rawTemplate) =>
  armoryTemplate(await marasi.post("/armory/template", { name, description, raw_template: rawTemplate }));
// A template of a captured pair's raw request, named as v1 named it.
export const CreateArmoryTemplateFromRequest = async (requestId) => {
  const { request = {} } = await readPair(requestId);
  return CreateArmoryTemplate(
    `${request.method} ${request.host}${request.path}`,
    "Imported from request history",
    rawText(request.raw) ?? "",
  );
};
// A draft finding or test case with `requests` linked, as v1's
// CreateDraft*.
export const CreateDraftFinding = (requests, testCaseID) =>
  createDraft(findings, requests, { test_case_id: testCaseID ?? null });
export const CreateDraftTestCase = (requests) => createDraft(testCases, requests);
// Creates a launchpad and resolves its id.
export const CreateLaunchpadEntry = async (name, description) =>
  (await marasi.post("/launchpad", { name, description })).id;
// Marasi refuses an active run: run_active.
export const DeleteArmoryRun = async (id) => {
  await marasi.delete(`/armory/run/${encodeURIComponent(id)}`);
};
// Marasi refuses a template with an active run: template_has_active_run.
export const DeleteArmoryTemplate = async (id) => {
  await marasi.delete(`/armory/template/${encodeURIComponent(id)}`);
};
export const DeleteArtifact = (id) => marasi.delete(artifactPath(id));
// Drops the project's setting `key`; a missing key is not an error.
export const DeleteClientSetting = (key) => marasi.delete(clientSetting(key));
export const DeleteFinding = (id) => deleteRecord(findings, id);
// Marasi refuses with launch_pending while a launch from it is pending.
export const DeleteLaunchpad = async (id) => {
  await marasi.delete(launchpadPath(id));
};
// Deletes a report template from the instance, and answers the list.
export const DeleteReportTemplate = async (name) =>
  templateNames(await marasi.delete(`/report/template/${encodeURIComponent(name)}`));
export const DeleteTestCase = (id) => deleteRecord(testCases, id);
// Deletes the pairs in `selection` with everything they own (marasi
// docs/adr/2026-10-14-deleting-a-pair-deletes-everything-it-owns.md).
export const DeleteTraffic = (selection) => bulk("delete", selection);
// Saves an artifact on this machine, through a save dialog. Resolves false
// when the researcher cancels.
export const DownloadArtifact = async (id) => {
  const { Filename, Data } = await GetArtifact(id);
  return Boolean(await bridge().saveArtifact(Filename, Data));
};
// Saves the instance's CA certificate on this machine, through a save
// dialog. Resolves false when the researcher cancels.
export const DownloadCert = async () => {
  const { pem } = await marasi.get("/certificate");
  return Boolean(await bridge().saveCertificate(pem));
};
export const DropWSIntercepted = (id) => DropCheckpoint(id);
// Renders `template` on the instance and saves the report on this machine,
// through a save dialog. Resolves false when the researcher cancels.
export const ExportReport = async (template, metadata) => {
  const bytes = await marasi.postBytes("/report", reportBody(template, metadata));
  return Boolean(await bridge().saveReport(reportFilename(template, metadata.title), bytes));
};
// Forwards a held WebSocket message with `payload`, its text, and `opcode`.
export const ForwardWSIntercepted = async (id, opcode, payload) => {
  await marasi.post(`${checkpointPath(id)}/forward`, { payload: base64(payload), opcode });
};
export const GetActiveArmoryRunIDs = async () => {
  const { items = [] } = await marasi.get("/armory/template");
  const runs = await Promise.all(items.map((item) => GetArmoryRuns(item.id)));
  return runs.flat().filter((run) => run.Status === "in_progress").map((run) => run.ID);
};
export const GetArmoryRun = async (id) => armoryRun(await marasi.get(`/armory/run/${encodeURIComponent(id)}`));
// Every pair an Armory run sent, in full as v1's RequestResponseRow, in
// the order they were sent. v1 bound it but its frontend never called it.
export const GetArmoryRunRequests = async (runId) => {
  const summaries = [];
  let page = { NextCursor: undefined, AsOf: "" };
  do {
    page = await QueryArmoryRunTraffic(runId, { Query: "", Cursor: page.NextCursor, AsOf: page.AsOf, Limit: maxTrafficPage });
    summaries.push(...page.Items);
  } while (page.NextCursor);
  summaries.sort((a, b) => a.Number - b.Number);
  return Promise.all(summaries.map(async (summary) => pairRow(await readPair(summary.ID))));
};
export const GetArmoryRuns = async (templateId) =>
  ((await marasi.get(`/armory/template/${encodeURIComponent(templateId)}/run`)).items ?? []).map(armoryRun);
// Every template with its raw template, which Marasi's list leaves out.
export const GetArmoryTemplates = async () => {
  const { items = [] } = await marasi.get("/armory/template");
  return Promise.all(items.map((item) => readTemplate(item.id)));
};
// The wordlists on the instance machine, by name.
export const GetArmoryWordlists = async () => wordlistInfos(await marasi.get("/wordlist"));
// An artifact with its bytes, as v1's Artifact: Data is a Uint8Array.
export const GetArtifact = async (id) => {
  const [artifact, data] = await Promise.all([
    marasi.get(artifactPath(id)),
    marasi.readBytes(`${artifactPath(id)}/content`),
  ]);
  return {
    ...artifactMetadata(artifact),
    TestCaseID: artifact.test_case_id ?? null,
    FindingID: artifact.finding_id ?? null,
    Data: data,
  };
};
// The project's setting `key`, { client, key, value, updated_at }, or null
// when it has none.
export const GetClientSetting = (key) => unlessNotFound(marasi.get(clientSetting(key)));
// The open project's exclusion: its own list when it has one, else the app
// default.
export const GetContentTypeExclusion = async () =>
  (await ownExclusion())?.value ?? (await appConfig.GetDefaultContentTypeExclusion());
// The held Checkpoint items, oldest first.
export const GetCheckpointItems = async () => ((await marasi.get("/checkpoint")).items ?? []).map(checkpointItem);
// One held item, or null once it has left.
export const GetCheckpoint = async (id) => {
  try {
    return checkpointItem(await marasi.get(checkpointPath(id)));
  } catch (err) {
    if (isCheckpointGone(err)) return null;
    throw err;
  }
};
// Forwards a held item, `body` as its edit, or as held when it is "". An
// edit replaces a request's or response's raw HTTP, or a WebSocket
// message's payload, so an edited item is read first for its type. Only a
// request can intercept its response. An item that has already left
// rejects as gone (isCheckpointGone).
export const ForwardCheckpoint = async (id, body, interceptResponse) => {
  const forward = {};
  if (body) {
    const item = await marasi.get(checkpointPath(id));
    forward[item.type === "websocket" ? "payload" : "raw"] = base64(body);
  }
  if (interceptResponse) forward.intercept_response = true;
  await marasi.post(`${checkpointPath(id)}/forward`, forward);
};
export const DropCheckpoint = async (id) => {
  await marasi.post(`${checkpointPath(id)}/drop`, {});
};
// Forward n and Drop n: each item in turn, without intercepting responses.
// `items` are [{ID, Body}], Body as ForwardCheckpoint's.
export const ForwardCheckpoints = (items) => {
  const bodies = new Map(items.map((item) => [item.ID, item.Body]));
  return settleCheckpoints([...bodies.keys()], (id) => ForwardCheckpoint(id, bodies.get(id), false));
};
export const DropCheckpoints = (ids) => settleCheckpoints(ids, DropCheckpoint);
// Intercept all. Marasi sets it rather than toggling it, so a toggle reads
// it first; each resolves the instance's value.
export const GetInterceptFlag = async () => (await marasi.get("/checkpoint")).intercept;
export const SetIntercept = async (enabled) =>
  (await marasi.post("/checkpoint/intercept", { intercept: Boolean(enabled) })).intercept;
export const ToggleIntercept = async () => SetIntercept(!(await GetInterceptFlag()));
// The instance machine's addresses the listener can bind:
// [{address, family, interface}], IPv4 first.
export const GetInterfaces = async () => (await marasi.get("/listener/interfaces")).items ?? [];
export const GetLaunch = async (id) => launchOf(await marasi.get(`/launch/${encodeURIComponent(id)}`));
// A launchpad's entries in entry order, as v1's RequestResponseSummary.
export const GetLaunchpadRequests = async (id) => ((await marasi.get(launchpadPath(id))).items ?? []).map(pairSummary);
export const GetLaunchpads = async () => ((await marasi.get("/launchpad")).items ?? []).map(launchpadOf);
// One page of the log, newest first: {items, next_cursor}. `cursor` is the
// last page's next_cursor.
export const GetLogs = (cursor) =>
  marasi.get(`/logs?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
export const GetMetadata = (id) => marasi.get(`/traffic/${encodeURIComponent(id)}/metadata`);
// A pair's note, "" when it has none.
export const GetNote = async (id) => (await readPair(id)).note ?? "";
// A pair in full as v1's RequestResponseRow, or null when it is gone.
export const GetRawDetails = async (id) => {
  const pair = await unlessNotFound(readPair(id));
  return pair && pairRow(pair);
};
// The instance's projects, by name: [{name, project, modified_at}], where
// `project` is the path on the instance machine.
export const GetRecentProjects = async () => (await marasi.get("/project/list")).items ?? [];
// A pair's response as v1's ProxyResponse.
export const GetResponse = async (id) => pairRow(await readPair(id)).Response;
// A GET /scope rule as v1's scope rule.
const scopeRule = (rule) => ({ pattern: rule.pattern, matchType: rule.match_type });
/** Compass's scope rules, in v1's shape. */
export const GetScopeRules = async () => {
  const scope = await marasi.get("/scope");
  return {
    defaultAllow: scope.default_allow,
    includeRules: (scope.include ?? []).map(scopeRule),
    excludeRules: (scope.exclude ?? []).map(scopeRule),
  };
};
// This machine's user, the report assessor default.
export const GetUserName = () => bridge().userName();
// WebSocket interception, which Marasi sets rather than toggles, as Intercept all.
export const GetWSInterceptFlag = async () => (await marasi.get("/checkpoint")).websocket_intercept;
// The oldest message held on the connection an upgrade pair opened, or null.
export const GetWSIntercepted = async (requestId) => {
  const { items = [] } = await marasi.get("/checkpoint?kind=websocket");
  const held = items.find((item) => item.request_id === requestId);
  return held ? heldMessage(held) : null;
};
// The connection an upgrade pair opened, live or closed, or null before it
// opens.
export const GetWebSocketConnection = async (requestId) => {
  const connection = await unlessNotFound(readConnection(requestId));
  return connection && webSocketConnection(connection);
};
// Every message on the connection an upgrade pair opened, oldest first, as
// v1 listed them. Marasi pages them newest first.
export const GetWebSocketMessages = async (requestId) => {
  const connection = await unlessNotFound(readConnection(requestId));
  if (!connection) return [];
  const path = `${connectionPath(connection)}/message`;
  const messages = [];
  let cursor = null;
  do {
    const page = await marasi.get(`${path}${trafficQuery({ limit: maxMessagePage, cursor })}`);
    messages.push(...(page.items ?? []));
    cursor = page.next_cursor;
  } while (cursor);
  return messages.reverse().map(webSocketMessage);
};
// Whether the open project keeps its own exclusion; false when it follows
// the app default.
export const HasOwnContentTypeExclusion = async () => (await ownExclusion()) !== null;
// Sends `payload`, text, as a whole message on the connection an upgrade
// pair opened. A data message on a permessage-deflate connection is
// compressed by the leg's rules unless `neverCompress`.
export const InjectWebSocketMessage = async (requestId, direction, opcode, payload, neverCompress) => {
  const connection = await readConnection(requestId);
  await marasi.post(`${connectionPath(connection)}/inject`, {
    direction,
    opcode,
    payload: base64(payload),
    compress: neverCompress ? "never" : "auto",
  });
};
// Launches the draft `raw` from launchpad `id` and resolves the launch id,
// which is also its pair's id (marasi docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md).
export const Launch = async (raw, id, useHttps) =>
  (await marasi.post(`${launchpadPath(id)}/launch`, { raw: base64(raw), scheme: useHttps ? "https" : "http" })).launch_id;
export const LinkRequestToFinding = (id, request) => linkPair(findings, id, request);
export const LinkRequestToLaunchpad = async (requestId, launchpadId) => {
  await marasi.post(`${launchpadPath(launchpadId)}/link`, { request_id: requestId });
};
export const LinkRequestToTestCase = (id, request) => linkPair(testCases, id, request);
// Links the pairs in `selection` to a launchpad, finding or test case;
// resolves how many were newly linked.
export const LinkTraffic = (selection, target) => bulk("link", selection, linkTarget(target));
// The project's settings whose keys start with `prefix`, sorted by key.
export const ListClientSettings = async (prefix = "") =>
  (await marasi.get(`${clientSettings}?prefix=${encodeURIComponent(prefix)}`)).items ?? [];
// The open project's findings and test cases, as v1's Finding and TestCase.
export const ListFindings = () => listRecords(findings);
// The open project's background jobs, in v1's JobState shape.
export const ListJobs = async () => ((await marasi.get("/jobs")).items ?? []).map(jobState);
// The most children Marasi lists in one sitemap page.
const maxSitemapPage = 500;
// One page of `request.Node`'s children, read as a one-node
// ListSitemapLevels as v1 did: v1's { Children, NextCursor, Complete,
// Missing, QueryError }.
export const ListSitemapChildren = async ({ Node, Cursor, ...request }) => {
  const read = await ListSitemapLevels({ ...request, Nodes: [Node], Cursors: Cursor ? { [Node]: Cursor } : {} });
  if (read.QueryError) return { Children: [], NextCursor: null, Complete: true, Missing: false, QueryError: read.QueryError };
  const level = read.Levels[0];
  if (level.Missing) return { Children: [], NextCursor: null, Complete: true, Missing: true, QueryError: null };
  return { Children: level.Children, NextCursor: level.NextCursor, Complete: read.Complete, Missing: false, QueryError: null };
};
// The sitemap's levels, one page of `request.Nodes`' children each, in v1's
// { Levels: [{ Node, Children, NextCursor, Missing }], Complete, QueryError }.
// A `request.Query` adds each child's Matching count, up to the results'
// `request.AsOf`; `request.Matching` counts only the matches instead.
export const ListSitemapLevels = (request) =>
  readTraffic(async () => {
    const exclusion = normalizeExclusion(request.Exclusion ?? []);
    const read = await marasi.post("/traffic/sitemap/levels", {
      nodes: request.Nodes,
      scope: request.Matching ? "matching" : "all",
      exclusion,
      ...(request.Query && { selection: { query: request.Query, exclusion, as_of: request.AsOf } }),
      cursors: request.Cursors ?? {},
      limit: request.Limit || maxSitemapPage,
    });
    const count = (child) => {
      const node = sitemapNodeCount(child);
      if (!request.Matching || child.matching == null) return node;
      return { ...node, Pairs: child.matching, Errors: child.matching_errors ?? node.Errors, Matching: null };
    };
    return {
      Levels: (read.levels ?? []).map((level) => ({
        Node: level.node,
        Children: (level.items ?? []).map(count),
        NextCursor: level.next_cursor ?? null,
        Missing: level.missing,
      })),
      Complete: read.sitemap?.complete ?? true,
      QueryError: null,
    };
  });
export const ListTemplates = async () => templateNames(await marasi.get("/report/template"));
export const ListTestCases = () => listRecords(testCases);
// Moves `ids` out of launchpad `sourceId` to `targetId` (which may be the
// source), before the entry `before`, or at the end for "". Resolves the
// moved ids in their new entry order; Marasi moves all or none.
export const MoveLaunchpadEntries = async (sourceId, targetId, ids, before) => {
  const body = { request_ids: ids, target_launchpad_id: targetId };
  if (before) body.before_request_id = before;
  return (await marasi.post(`${launchpadPath(sourceId)}/move`, body)).request_ids ?? [];
};
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
// The launches that have not ended, oldest first, as v1's Launch.
export const PendingLaunches = async () => ((await marasi.get("/launch")).items ?? []).map(launchOf);
// A wordlist's first `limit` entries; Marasi reads at most 100.
export const PreviewArmoryWordlist = async (name, limit) =>
  (await marasi.get(`/wordlist/${encodeURIComponent(name)}?limit=${limit}`)).items ?? [];
// One page of the pairs an Armory run sent, whatever their content type, as
// QueryTraffic reads the project's. `request.Query` narrows the run ("" for
// all of it); `request.OrderBy` "" is "requested_at".
export const QueryArmoryRunTraffic = (runId, request) =>
  QueryTraffic({
    ...request,
    Query: request.Query ? `${armoryRunQuery(runId)} AND (${request.Query})` : armoryRunQuery(runId),
    OrderBy: request.OrderBy || "requested_at",
    IgnoreExclusion: true,
  });
// The most rows Marasi lists in one GET /traffic page.
const maxTrafficPage = 500;

// One page of the traffic that matches `request.Query`, in display order,
// minus `request.Exclusion`, else the project's exclusion, unless
// `request.IgnoreExclusion`:
// v1's { Items, NextCursor, PrevCursor, AsOf, IndexComplete, QueryError }.
// v1 read any `request.Limit`; above Marasi's cap it reads on by cursor
// under the first page's as_of.
export const QueryTraffic = (request) =>
  readTraffic(async () => {
    const exclusion = await exclusionFor(request);
    const backward = request.Direction === "backward";
    const pages = [];
    let cursor = request.Cursor;
    let asOf = request.AsOf;
    let wanted = request.Limit;
    for (;;) {
      const limit = wanted == null ? undefined : Math.min(wanted, maxTrafficPage);
      const page = await marasi.get(
        "/traffic" +
          trafficQuery(
            { q: request.Query, order_by: request.OrderBy, cursor, direction: request.Direction, as_of: asOf, limit },
            exclusion,
          ),
      );
      pages.push(page);
      const read = page.items?.length ?? 0;
      cursor = backward ? page.prev_cursor : page.next_cursor;
      asOf = page.as_of ?? asOf;
      if (wanted == null || read < limit || !cursor) break;
      wanted -= read;
      if (wanted <= 0) break;
    }
    // Pages read backward come before the ones read earlier.
    const shown = backward ? [...pages].reverse() : pages;
    return {
      // Marasi lists a page in reverse display order.
      Items: shown.flatMap((page) => (page.items ?? []).map(pairSummary).reverse()),
      NextCursor: shown.at(-1).next_cursor ?? null,
      PrevCursor: shown[0].prev_cursor ?? null,
      AsOf: pages[0].as_of ?? "",
      IndexComplete: pages.every((page) => page.index?.complete ?? true),
      QueryError: null,
    };
  });
export const RebuildJob = (name) => marasi.post(`/jobs/${encodeURIComponent(name)}/rebuild`);
// Drops the open project's own exclusion, so it follows the app default again.
export const ResetContentTypeExclusion = () => unlessNotFound(marasi.delete(exclusionSetting));
// Writes the default template back, and answers the list.
export const RestoreDefaultReportTemplate = async () =>
  templateNames(await marasi.post("/report/template/restore"));
export const SaveArtifactToFinding = (id, filename, mimeType, size, data) =>
  uploadArtifact(findings, id, filename, mimeType, data);
export const SaveArtifactToTestCase = (id, filename, mimeType, size, data) =>
  uploadArtifact(testCases, id, filename, mimeType, data);
// Saves a finding's or test case's fields, as v1 saved the record.
export const SaveFinding = (finding) => saveRecord(findings, finding);
export const SaveTestCase = (testCase) => saveRecord(testCases, testCase);
// The instance's scratchpad's path, or null when it has none yet.
export const ScratchpadPath = async () =>
  (await GetRecentProjects()).find((item) => item.name === "scratchpad")?.project ?? null;
// The entries `query` matches, by launchpad id, in entry order: v1's {
// EntriesByLaunchpad, QueryError }. One read over every launchpad's pairs
// answers the usual keystroke that matches nothing; otherwise each
// launchpad runs the query, so a pair maps to every launchpad holding it.
export const SearchLaunchpadEntries = async (query) => {
  const result = { EntriesByLaunchpad: {}, QueryError: null };
  const any = await readTraffic(() =>
    marasi.get("/traffic" + trafficQuery({ q: `${launchpadSearchPrefix}${query})`, limit: 1 })),
  );
  if (any.QueryError) {
    // Its place in the researcher's text, not in the wrapped query.
    const position = Math.max(0, any.QueryError.Position - launchpadSearchPrefix.length);
    return { ...result, QueryError: { ...any.QueryError, Position: position } };
  }
  if (!any.items?.length) return result;
  const launchpads = (await marasi.get("/launchpad")).items ?? [];
  const matches = await Promise.all(
    launchpads.map(async (launchpad) => (await marasi.get(launchpadPath(launchpad.id) + trafficQuery({ q: query }))).items ?? []),
  );
  launchpads.forEach((launchpad, index) => {
    if (matches[index].length) result.EntriesByLaunchpad[launchpad.id] = matches[index].map((item) => item.id);
  });
  return result;
};
// Stores `value`, any JSON, as the project's setting `key`.
export const SetClientSetting = (key, value) => marasi.put(clientSetting(key), { value });
// Gives the open project its own exclusion, normalised as Marasi does,
// which it keeps instead of following the app default.
export const SetContentTypeExclusion = async (values) => {
  await marasi.put(exclusionSetting, { value: normalizeExclusion(values) });
};
// Gives every pair in `selection` highlight 1-8.
export const SetHighlight = (selection, highlight) => bulk("highlight", selection, { highlight });
// The window's dirty draft count, which the main process asks about before
// quitting or restarting.
export const SetUnsavedDraftCount = (count) => bridge().reportDrafts(count);
export const SetWSIntercept = async (enabled) =>
  (await marasi.post("/checkpoint/websocket-intercept", { websocket_intercept: Boolean(enabled) })).websocket_intercept;
export const SetupScratchpad = notPorted("SetupScratchpad");
// Starts a draft; Marasi refuses any other run with not_a_draft or run_active.
export const StartArmoryRun = async (id) => {
  await marasi.post(`/armory/run/${encodeURIComponent(id)}/start`);
};
// The proxy listener; each resolves Marasi's listener status.
export const StartProxy = (address, port) => marasi.post("/listener/start", { address, port: Number(port) });
export const StopProxy = () => marasi.post("/listener/stop");
// Tests a URL against the scope, in v1's shape. Marasi names the rule that
// matched; it put the URL in scope when it is an include rule and out of it
// when it is an exclude rule. With no rule matched, the default decides.
export const TestScopeMatch = async (url) => {
  const check = await marasi.post("/scope/check", { url });
  const rule = check.rule;
  return {
    inScope: check.in_scope,
    testedUrl: check.tested_url,
    matchedRule: rule?.pattern ?? "",
    matchedAs: rule?.match_type ?? "",
    ruleType: rule ? (check.in_scope ? "include" : "exclude") : "",
    defaultAllowUsed: !rule,
    compassEnabled: check.compass_enabled,
  };
};
export const ToggleWSIntercept = async () => SetWSIntercept(!(await GetWSInterceptFlag()));
export const UnlinkRequestFromFinding = (id, request) => unlinkPair(findings, id, request);
export const UnlinkRequestFromTestCase = (id, request) => unlinkPair(testCases, id, request);
export const UnlinkTraffic = (selection, target) => bulk("unlink", selection, linkTarget(target));
export const UpdateArmoryTemplate = async (id, name, description, rawTemplate) => {
  await marasi.post(`/armory/template/${encodeURIComponent(id)}`, { name, description, raw_template: rawTemplate });
};
export const UpdateLaunchpadEntry = async (id, name, description) => {
  await marasi.post(launchpadPath(id), { name, description });
};
// Saves a pair's note; an empty one deletes it, as v1 saved "".
export const UpdateNote = async (id, note) => {
  const path = `/notes/${encodeURIComponent(id)}`;
  if (note) await marasi.put(path, { note });
  else await unlessNotFound(marasi.delete(path));
};
export const UpdateProxy = (address, port) => marasi.post("/listener/update", { address, port: Number(port) });
// Uploads a template file's bytes from this machine under `name`, and
// answers the list. Marasi refuses a taken name with
// report_template_already_exists.
export const UploadReportTemplate = async (name, bytes) =>
  templateNames(
    await marasi.sendBytes("POST", `/report/template?${new URLSearchParams({ name })}`, bytes, "application/octet-stream"),
  );
// Checks an unsaved run; Marasi refuses one it can't run with
// invalid_armory_request.
export const ValidateArmoryRun = async (rawTemplate, attackType, wordlists, maxConcurrent) => {
  await marasi.post("/armory/run/validate", {
    raw_template: rawTemplate,
    attack_type: attackType,
    wordlists: wordlists ?? [],
    max_concurrent: maxConcurrent,
  });
};
