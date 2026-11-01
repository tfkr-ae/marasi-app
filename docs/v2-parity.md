# v2 parity table

This table is the checklist that proves Marasi App v2 has every v1 feature. It has one row per v1 `App` binding, per Wails runtime function, and per event v1 emits or listens to. v1 is the Wails app on `main`.

- **Status.** `COVERED`: a Marasi control API route or event does it, named in the v2 column. `GUI`: the Electron main process or the renderer does it. `DROPPED`: not ported, with the reason.
- **Marasi.** Routes and events are those of marasi `integration/v2-backlog`. "C:" means the GUI composes several calls.
- **Ticket.** The ticket in `.scratch/marasi-app-v2/issues/` that ports the row.
- **Done.** Tick a row when its behaviour has been verified in v2.

`frontend/src/lib/bindings/parity.test.js` checks that every binding and event has exactly one row, that each row has a status and a ticket, and that only the two legacy migrations are dropped.

## Startup, projects and windows

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `SetupScratchpad` | binding | COVERED | `marasi service start` with no `--project*` starts the default instance on Marasi's scratchpad. v1's own scratchpad is not migrated. | 05 | [x] |
| `ScratchpadPath` | binding | COVERED | `POST /project/open {"name":"scratchpad"}` | 10 | [x] |
| `OpenProject` | binding | COVERED | `POST /project/open {name}` or `{path}`, then `project.opening`, `project.upgrading`, `project.waiting`, `project.opened` or `project.opening_failed`. `409 project_already_open` offers to connect to the owner. | 10 | [x] |
| `GetRecentProjects` | binding | COVERED | `GET /project/list` with `modified_at`, sorted newest first by the GUI | 10 | [x] |
| `OpenFileDialog` | binding | GUI | OS open dialog on a local connection. On a remote one the path on the instance machine is typed. | 10 | [x] |
| `project-opening` | event | COVERED | `project.opening` | 10 | [x] |
| `WindowSetTitle` | runtime | GUI | `BrowserWindow` title naming the instance and project | 03 | [x] |

## App config, settings and keybindings

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetMarasiConfig` | binding | GUI | Main process reads `marasi_appconfig.yaml` | 07 | [x] |
| `SetFlag` | binding | GUI | Main process writes one app config key | 07 | [x] |
| `ToggleFlag` | binding | GUI | Main process writes one app config key | 07 | [x] |
| `GetKeybindings` | binding | GUI | App config | 07 | [x] |
| `SaveKeybindings` | binding | GUI | App config | 07 | [x] |
| `ExportKeybindingProfile` | binding | GUI | OS save dialog | 07 | [x] |
| `ImportKeybindingProfile` | binding | GUI | OS open dialog | 07 | [x] |
| `GetBuildInfo` | binding | GUI | The app's own version. The instance's version comes from `GET /service/status` (ticket 16). | 07 | [x] |
| `GetHighlights` | binding | GUI | App-wide highlight colours in the app config | 07 | [x] |
| `SaveHighlights` | binding | GUI | App config | 07 | [x] |
| `ResetHighlights` | binding | GUI | App config | 07 | [x] |
| `MigrateOldHighlights` | binding | DROPPED | Legacy migration: it moved v1's old highlight settings once. v2 starts from what v1 has already migrated. | 07 | [x] |
| `GetAppSavedQueries` | binding | GUI | App config | 07 | [x] |
| `SaveAppSavedQueries` | binding | GUI | App config | 07 | [x] |
| `SetHiddenBuiltinQueries` | binding | GUI | App config | 07 | [x] |
| `GetDefaultContentTypeExclusion` | binding | GUI | App config key `ledger_content_type_exclusion` | 07 | [x] |
| `SetDefaultContentTypeExclusion` | binding | GUI | App config key `ledger_content_type_exclusion` | 07 | [x] |

## Connection, event stream and logs

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `EventsOn` | runtime | GUI | One `EventSource` on `/events` in the layout, sent to the stores' `on*` methods | 04 | [x] |
| `EventsOff` | runtime | GUI | The layout closes the `EventSource` | 04 | [x] |
| `EventsOnce` | runtime | GUI | The layout's `EventSource` dispatch | 04 | [ ] |
| `GetLogs` | binding | COVERED | `GET /logs` (paged) | 04 | [x] |
| `log` | event | COVERED | `log.added`. The opening screen's steps come from the `project.*` events. v1's own slog lines have no v2 source, because v2 has no Go process. | 04 | [ ] |

## Home: listener, dashboard, jobs and certificate

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `StartProxy` | binding | COVERED | `POST /listener/start {address, port}` | 11 | [x] |
| `StopProxy` | binding | COVERED | `POST /listener/stop`. v1 bound it but the frontend never called it. | 11 | [x] |
| `UpdateProxy` | binding | COVERED | `POST /listener/update {address, port}` | 11 | [x] |
| `GetInterfaces` | binding | COVERED | `GET /listener/interfaces` | 11 | [x] |
| `CountNotes` | binding | COVERED | `GET /dashboard` | 11 | [x] |
| `ListJobs` | binding | COVERED | `GET /jobs`, `job.progress`, `job.complete` | 11 | [x] |
| `RebuildJob` | binding | COVERED | `POST /jobs/{name}/rebuild` | 11 | [x] |
| `DownloadCert` | binding | COVERED | `GET /certificate` `.pem`, saved through an OS save dialog | 11 | [x] |
| `CopyCertToClipboard` | binding | COVERED | `GET /certificate` `.pem`, copied through the GUI clipboard | 11 | [x] |

## Ledger

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `QueryTraffic` | binding | COVERED | `GET /traffic?q&exclude&order_by&limit&cursor&direction&as_of`. Above Marasi's 500-row page cap it reads on by cursor under the first page's `as_of`, as v1 read any limit. | 12 | [x] |
| `CountTraffic` | binding | COVERED | `GET /traffic/count?q&exclude&as_of&after` | 12 | [x] |
| `CountContentTypes` | binding | COVERED | `GET /traffic/content-types` | 12 | [x] |
| `GetRawDetails` | binding | COVERED | `GET /traffic/{id}` | 12 | [x] |
| `GetResponse` | binding | COVERED | `GET /traffic/{id}` `.response`. v1 bound it but the frontend never called it. | 12 | [x] |
| `GetMetadata` | binding | COVERED | `GET /traffic/{id}/metadata` | 12 | [x] |
| `GetNote` | binding | COVERED | `GET /traffic/{id}` `.note` | 12 | [x] |
| `UpdateNote` | binding | COVERED | `PUT /notes/{id} {note}`. An empty note is `DELETE /notes/{id}`. | 12 | [x] |
| `GetContentTypeExclusion` | binding | COVERED | `GET /client-settings/marasi-app/ledger.exclusion`, falling back to the app default | 12 | [x] |
| `SetContentTypeExclusion` | binding | COVERED | `PUT /client-settings/marasi-app/ledger.exclusion` | 12 | [x] |
| `HasOwnContentTypeExclusion` | binding | COVERED | `GET /client-settings/marasi-app/ledger.exclusion` (404 = no override) | 12 | [x] |
| `ResetContentTypeExclusion` | binding | COVERED | `DELETE /client-settings/marasi-app/ledger.exclusion` | 12 | [x] |
| `migrateLegacyExclusion` | behaviour | DROPPED | Legacy migration: on project open, v1 moved the exclusion Marasi's migration 00012 kept under `legacy.content_type_exclusion` into `marasi-app/ledger.exclusion`. v2 reads only the `marasi-app` key. | 12 | [x] |
| `request` | event | COVERED | `traffic.request` | 12 | [x] |
| `response` | event | COVERED | `traffic.response` | 12 | [x] |
| `ListSitemapChildren` | binding | COVERED | `POST /traffic/sitemap/levels` with one node, as v1 read it, so a query adds the children's matching counts. `sitemap.changed` reads the open levels again. | 13 | [x] |
| `ListSitemapLevels` | binding | COVERED | `POST /traffic/sitemap/levels` | 13 | [x] |

## Ledger selection, highlights and bulk actions

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `AppendNote` | binding | COVERED | `POST /traffic/bulk/note {selection, append}` | 14 | [x] |
| `ClearNotes` | binding | COVERED | `POST /traffic/bulk/note {selection, clear:true}` | 14 | [x] |
| `SetHighlight` | binding | COVERED | `POST /traffic/bulk/highlight {selection, highlight}` | 14 | [x] |
| `ClearHighlight` | binding | COVERED | `POST /traffic/bulk/highlight {selection, highlight:null}` | 14 | [x] |
| `DeleteTraffic` | binding | COVERED | `POST /traffic/bulk/delete {selection}` | 14 | [x] |
| `LinkTraffic` | binding | COVERED | `POST /traffic/bulk/link {selection, launchpad_id, finding_id or test_case_id}` | 14 | [x] |
| `UnlinkTraffic` | binding | COVERED | `POST /traffic/bulk/unlink {selection, launchpad_id, finding_id or test_case_id}` | 14 | [x] |
| `GetClientSetting` | binding | COVERED | `GET /client-settings/marasi-app/{key}` (404 = unset) | 14 | [x] |
| `SetClientSetting` | binding | COVERED | `PUT /client-settings/marasi-app/{key} {value}` | 14 | [x] |
| `DeleteClientSetting` | binding | COVERED | `DELETE /client-settings/marasi-app/{key}` | 14 | [x] |
| `ListClientSettings` | binding | COVERED | `GET /client-settings/marasi-app?prefix=` | 14 | [x] |
| `ws-state` | event | COVERED | `websocket.handshake_ended {request_id, state}` | 14 | [x] |

## Updates

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetUpdateState` | binding | GUI | Main-process updater, `v2_*` config keys | 15 | [x] |
| `CheckForUpdate` | binding | GUI | Main-process updater | 15 | [x] |
| `InstallUpdate` | binding | GUI | Main-process updater | 15 | [x] |
| `CancelUpdateDownload` | binding | GUI | Main-process updater | 15 | [x] |
| `RestartToUpdate` | binding | GUI | Main-process updater | 15 | [x] |
| `ReinstallLatestRelease` | binding | GUI | Main-process updater. A v2 build follows only `v2-nightly`, so it refuses until v2 replaces v1. | 15 | [x] |
| `DismissUpdate` | binding | GUI | Main-process updater | 15 | [x] |
| `SetUpdateChannel` | binding | GUI | Main-process updater, including `v2-nightly` | 15 | [x] |
| `GetUpdateSettings` | binding | GUI | Main-process updater | 15 | [x] |
| `SetAutomaticUpdateChecks` | binding | GUI | Main-process updater | 15 | [x] |
| `update-available` | event | GUI | Main-process updater IPC. Instance updates use `update.available` (ticket 16). | 15 | [x] |
| `update-progress` | event | GUI | Main-process updater IPC. Instance updates use `update.progress` (ticket 16). | 15 | [x] |
| `update-installed` | event | GUI | Main-process updater IPC. Instance updates use `update.installed` (ticket 16). | 15 | [x] |
| `update-failed` | event | GUI | Main-process updater IPC. Instance updates use `update.failed` (ticket 16). | 15 | [x] |
| `BrowserOpenURL` | runtime | GUI | `shell.openExternal` | 15 | [ ] |

## Checkpoint

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetCheckpointItems` | binding | COVERED | `GET /checkpoint` (items carry `intercepted_at`) | 17 | [x] |
| `GetCheckpoint` | binding | COVERED | `GET /checkpoint/{id}`. v1 bound it but the frontend never called it. | 17 | [x] |
| `GetInterceptFlag` | binding | COVERED | `GET /checkpoint` `.intercept` | 17 | [x] |
| `ToggleIntercept` | binding | COVERED | `POST /checkpoint/intercept {intercept}` with the opposite of the current value, and `checkpoint.updated` | 17 | [x] |
| `SetIntercept` | binding | COVERED | `POST /checkpoint/intercept {intercept}`. v1 bound it but the frontend never called it. | 17 | [x] |
| `ForwardCheckpoint` | binding | COVERED | `POST /checkpoint/{id}/forward {raw, intercept_response}`, or `{payload}` for a WebSocket item; an edited item is read first (`GET /checkpoint/{id}`) for its type | 17 | [x] |
| `ForwardCheckpoints` | binding | COVERED | C: `POST /checkpoint/{id}/forward` for each item, counting done, gone (404) and failed | 17 | [x] |
| `DropCheckpoint` | binding | COVERED | `POST /checkpoint/{id}/drop` | 17 | [x] |
| `DropCheckpoints` | binding | COVERED | C: `POST /checkpoint/{id}/drop` for each item, counting done, gone (404) and failed | 17 | [x] |
| `CheckHTTPParse` | binding | GUI | The renderer reads the edited request or response as Go's `http.ReadRequest` or `http.ReadResponse` would, with Go's error text (`lib/checkpoint/httpParse.js`). Marasi's `400 invalid_checkpoint_request` carries no parse message. | 17 | [x] |
| `intercepted` | event | COVERED | `checkpoint.held` (type `request` or `response`) | 17 | [x] |
| `checkpoint-settled` | event | COVERED | `checkpoint.forwarded` or `checkpoint.dropped` with `request_id` and reason `forwarded` or `dropped`, by any client. The WebSocket modal's side is ticket 18. | 17 | [x] |
| `checkpoint-abandoned` | event | COVERED | `checkpoint.dropped` with reason `abandoned`. Reason `shutdown` reads the queue again, as a drop does. | 17 | [x] |

## WebSocket

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetWSInterceptFlag` | binding | COVERED | `GET /checkpoint` `.websocket_intercept` | 18 | [ ] |
| `ToggleWSIntercept` | binding | COVERED | `POST /checkpoint/websocket-intercept {websocket_intercept}` with the opposite of the current value, and `checkpoint.updated` | 18 | [ ] |
| `SetWSIntercept` | binding | COVERED | `POST /checkpoint/websocket-intercept {websocket_intercept}`. v1 bound it but the frontend never called it. | 18 | [ ] |
| `GetWSIntercepted` | binding | COVERED | C: `GET /checkpoint?kind=websocket`, filtered by `request_id` | 18 | [ ] |
| `ForwardWSIntercepted` | binding | COVERED | `POST /checkpoint/{id}/forward {payload, opcode}` | 18 | [ ] |
| `DropWSIntercepted` | binding | COVERED | `POST /checkpoint/{id}/drop` | 18 | [ ] |
| `GetWebSocketConnection` | binding | COVERED | `GET /traffic/{request_id}/websocket` | 18 | [ ] |
| `GetWebSocketMessages` | binding | COVERED | `GET /websocket/{connection_id}/message` (paged) | 18 | [ ] |
| `InjectWebSocketMessage` | binding | COVERED | `POST /websocket/{connection_id}/inject {direction, opcode, payload, compress:"never"}` | 18 | [ ] |
| `CloseWebSocket` | binding | COVERED | `POST /websocket/{connection_id}/close {code, reason}` | 18 | [ ] |
| `ws-intercepted` | event | COVERED | `checkpoint.held` (type `websocket`) | 18 | [ ] |
| `ws-message` | event | COVERED | `websocket.message` | 18 | [ ] |
| `ws-open` | event | COVERED | `websocket.opened` | 18 | [ ] |
| `ws-close` | event | COVERED | `websocket.closed` | 18 | [ ] |
| `ws-progress` | event | COVERED | `websocket.progress` | 18 | [ ] |

## Launchpad

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetLaunchpads` | binding | COVERED | `GET /launchpad` | 19 | [x] |
| `CreateLaunchpadEntry` | binding | COVERED | `POST /launchpad {name, description}`, `launchpad.created` | 19 | [x] |
| `UpdateLaunchpadEntry` | binding | COVERED | `POST /launchpad/{id} {name, description}`, `launchpad.updated` | 19 | [x] |
| `DeleteLaunchpad` | binding | COVERED | `DELETE /launchpad/{id}`, `launchpad.deleted` (`409 launch_pending`) | 19 | [x] |
| `GetLaunchpadRequests` | binding | COVERED | `GET /launchpad/{id}` | 19 | [x] |
| `LinkRequestToLaunchpad` | binding | COVERED | `POST /launchpad/{id}/link {request_id}`. v1 bound it but the frontend never called it; v2's is proven by its binding test. | 19 | [x] |
| `MoveLaunchpadEntries` | binding | COVERED | `POST /launchpad/{id}/move {request_ids, target_launchpad_id, before_request_id}`, `launchpad.entries_moved` | 19 | [x] |
| `SearchLaunchpadEntries` | binding | COVERED | C: `GET /traffic?q=launchpad:* AND (…)&limit=1`, then when it matches `GET /launchpad/{id}?q=` for each launchpad | 19 | [x] |
| `Launch` | binding | COVERED | `POST /launchpad/{id}/launch {raw, scheme}` | 20 | [ ] |
| `PendingLaunches` | binding | COVERED | `GET /launch` | 20 | [ ] |
| `GetLaunch` | binding | COVERED | `GET /launch/{id}` | 20 | [ ] |
| `CancelLaunch` | binding | COVERED | `POST /launch/{id}/cancel` (`409 launch_finished`) | 20 | [ ] |
| `SetUnsavedDraftCount` | binding | GUI | Each window tells the main process its dirty draft count, for the quit prompt | 20 | [ ] |
| `launch-started` | event | COVERED | `launch.started` | 20 | [ ] |
| `launch-finished` | event | COVERED | `launch.completed`, `launch.cancelled` or `launch.failed` | 20 | [ ] |

## Logbook

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `ListFindings` | binding | COVERED | C: `GET /finding`, then `GET /finding/{id}` for each | 21 | [ ] |
| `SaveFinding` | binding | COVERED | `POST /finding` (new) or `POST /finding/{id}` (edit) | 21 | [ ] |
| `DeleteFinding` | binding | COVERED | `DELETE /finding/{id}` | 21 | [ ] |
| `CreateDraftFinding` | binding | COVERED | C: `POST /finding`, then `POST /traffic/bulk/link {selection, finding_id}` | 21 | [ ] |
| `LinkRequestToFinding` | binding | COVERED | `POST /finding/{id}/traffic {id}` | 21 | [ ] |
| `UnlinkRequestFromFinding` | binding | COVERED | `DELETE /finding/{id}/traffic/{request_id}` | 21 | [ ] |
| `SaveArtifactToFinding` | binding | COVERED | `POST /finding/{id}/artifact?filename=` with the file read on this machine | 21 | [ ] |
| `ListTestCases` | binding | COVERED | C: `GET /test-case`, then `GET /test-case/{id}` for each | 21 | [ ] |
| `SaveTestCase` | binding | COVERED | `POST /test-case` (new) or `POST /test-case/{id}` (edit) | 21 | [ ] |
| `DeleteTestCase` | binding | COVERED | `DELETE /test-case/{id}` | 21 | [ ] |
| `CreateDraftTestCase` | binding | COVERED | C: `POST /test-case`, then `POST /traffic/bulk/link {selection, test_case_id}` | 21 | [ ] |
| `LinkRequestToTestCase` | binding | COVERED | `POST /test-case/{id}/traffic {id}` | 21 | [ ] |
| `UnlinkRequestFromTestCase` | binding | COVERED | `DELETE /test-case/{id}/traffic/{request_id}` | 21 | [ ] |
| `SaveArtifactToTestCase` | binding | COVERED | `POST /test-case/{id}/artifact?filename=` with the file read on this machine | 21 | [ ] |
| `GetArtifact` | binding | COVERED | `GET /artifact/{id}` and `GET /artifact/{id}/content` | 21 | [ ] |
| `DownloadArtifact` | binding | COVERED | `GET /artifact/{id}/content`, saved through an OS save dialog | 21 | [ ] |
| `DeleteArtifact` | binding | COVERED | `DELETE /artifact/{id}` | 21 | [ ] |

## Reports

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `ListTemplates` | binding | COVERED | `GET /report/template` | 22 | [ ] |
| `ExportReport` | binding | COVERED | `POST /report {template, …, created_at, custom_properties}`, saved through an OS save dialog | 22 | [ ] |
| `RestoreDefaultReportTemplate` | binding | COVERED | `POST /report/template/restore` | 22 | [ ] |
| `GetUserName` | binding | GUI | `os.userInfo()`, the report assessor default | 22 | [ ] |

## Armory

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetArmoryTemplates` | binding | COVERED | `GET /armory/template`, and `GET /armory/template/{id}` for `raw_template` | 23 | [x] |
| `CreateArmoryTemplate` | binding | COVERED | `POST /armory/template {name, description, raw_template}` | 23 | [x] |
| `CreateArmoryTemplateFromRequest` | binding | COVERED | C: `GET /traffic/{id}`, then `POST /armory/template` | 23 | [x] |
| `UpdateArmoryTemplate` | binding | COVERED | `POST /armory/template/{id}` | 23 | [x] |
| `DeleteArmoryTemplate` | binding | COVERED | `DELETE /armory/template/{id}` | 23 | [x] |
| `GetArmoryRuns` | binding | COVERED | `GET /armory/template/{id}/run` | 23 | [x] |
| `GetArmoryRun` | binding | COVERED | `GET /armory/run/{id}` | 23 | [x] |
| `GetActiveArmoryRunIDs` | binding | COVERED | C: `GET /armory/template/{id}/run` for each template, filtered by `status` `in_progress`. Runs a crash interrupted are cancelled when the project opens. | 23 | [x] |
| `CreateArmoryRun` | binding | COVERED | `POST /armory/run {template_id, attack_type, use_https, wordlists, max_concurrent}` | 23 | [x] |
| `ValidateArmoryRun` | binding | COVERED | `POST /armory/run/validate` | 23 | [x] |
| `StartArmoryRun` | binding | COVERED | `POST /armory/run/{id}/start` | 23 | [x] |
| `CancelArmoryRun` | binding | COVERED | `POST /armory/run/{id}/cancel` | 23 | [x] |
| `DeleteArmoryRun` | binding | COVERED | `DELETE /armory/run/{id}` | 23 | [x] |
| `GetArmoryWordlists` | binding | COVERED | `GET /wordlist` | 23 | [x] |
| `PreviewArmoryWordlist` | binding | COVERED | `GET /wordlist/{name}?limit=` | 23 | [x] |
| `QueryArmoryRunTraffic` | binding | COVERED | `GET /traffic?q=metadata.armory_run_id = "<id>" AND (<q>)` | 24 | [ ] |
| `CountArmoryRunTraffic` | binding | COVERED | `GET /traffic/count/by-field?field=&q=metadata.armory_run_id = "<id>"&as_of=` | 24 | [ ] |
| `GetArmoryRunRequests` | binding | COVERED | `GET /traffic?q=metadata.armory_run_id = "<id>"`. v1 bound it but the frontend never called it. | 24 | [ ] |

## Scope and extensions

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetScopeRules` | binding | COVERED | `GET /scope` | 25 | [x] |
| `TestScopeMatch` | binding | COVERED | `POST /scope/check {url}` | 25 | [x] |
| `GetExtensions` | binding | COVERED | `GET /extension`, `extension.enabled`, `extension.updated` | 25 | [x] |
| `GetExtensionCode` | binding | COVERED | `GET /extension/{id}` `.lua_content` | 25 | [x] |
| `RunExtension` | binding | COVERED | `POST /extension/{id} {lua_content}` | 25 | [x] |
| `DoExtender` | binding | COVERED | `POST /extension/{id} {lua_content}` on the workshop extension | 25 | [x] |
| `GetExtensionLogs` | binding | COVERED | `GET /extension/{id}/logs` | 25 | [x] |
| `GetExtensionUI` | binding | COVERED | `extension.gui.rendered`. v1's only caller, `WebComponentWrapper.svelte`, was imported nowhere, and extension UI drew from `extension_gui_render`. | 25 | [x] |
| `GetExtensionFlag` | binding | GUI | No v1 caller, so the GUI has nothing to read. No route reads an extension's Lua global flags. | 25 | [x] |
| `LoadExtensions` | binding | GUI | It only registered v1's Wails listeners. The layout's `EventSource` dispatch does that. | 25 | [x] |
| `extension_gui_render` | event | COVERED | `extension.gui.rendered {id, name, target, schema}` (target `toast` is a toast) | 25 | [x] |
| `extension_state_update` | event | COVERED | `extension.gui.updated {id, name, key, value}` | 25 | [x] |
| `<extensionName>-log` | event | COVERED | `extension.log {id, name, time, text}`, filtered by name | 25 | [x] |
| `extension_call_function` | event | COVERED | `POST /extension/{id}/call {function, args:[state]}` | 25 | [x] |
| `extension_sync_state` | event | COVERED | `POST /extension/{id}/call {function:"sync", args}` | 25 | [x] |
| `EventsEmit` | runtime | COVERED | `POST /extension/{id}/call` | 25 | [x] |

## Chrome, upstream proxies and waypoints

| v1 | kind | status | v2 | ticket | done |
|---|---|---|---|---|---|
| `GetChromePaths` | binding | COVERED | `GET /chrome/path`. Remote: this machine's, in app config key `v2_chrome_paths`. | 27 | [x] |
| `AddChromePath` | binding | COVERED | `POST /chrome/path {os, path}`. Remote: this machine's, in app config key `v2_chrome_paths`. | 27 | [x] |
| `DeleteChromePath` | binding | COVERED | `DELETE /chrome/path {os, path}`. Remote: this machine's, in app config key `v2_chrome_paths`. | 27 | [x] |
| `GetChromeProfiles` | binding | COVERED | `GET /chrome/profile`. Remote: this machine's, in app config key `v2_chrome_profiles`. | 27 | [x] |
| `AddChromeProfile` | binding | COVERED | `POST /chrome/profile {name}`. Remote: this machine's, in app config key `v2_chrome_profiles`. | 27 | [x] |
| `DeleteChromeProfile` | binding | COVERED | `DELETE /chrome/profile/{name}`. Remote: this machine's, in app config key `v2_chrome_profiles`, removing its user-data-dir. | 27 | [x] |
| `StartBrowser` | binding | COVERED | `POST /chrome/start {profile}`. Remote: C: `GET /listener/status` and `GET /certificate` `.spki_hash`, then this machine's Chrome through the remote's host and listener port, or the address saved for it. | 27 | [x] |
| `GetLocalChromeProxy` | binding | GUI | v2 only: the proxy address this machine's Chrome uses for the window's remote, app config key `v2_chrome_proxy_addresses`, and its default from `GET /listener/status` | 27 | [x] |
| `SetLocalChromeProxy` | binding | GUI | v2 only: saves the remote's proxy address in `v2_chrome_proxy_addresses`; empty goes back to the default | 27 | [x] |
| `GetUpstreamProxies` | binding | COVERED | `GET /upstream-proxy`, `upstream_proxy.*` | 26 | [x] |
| `AddUpstreamProxy` | binding | COVERED | `POST /upstream-proxy {name, url, ca}`, then `GET /upstream-proxy` for the selection | 26 | [x] |
| `UpdateUpstreamProxy` | binding | COVERED | `POST /upstream-proxy/{name} {url, ca}` (`ca:null` removes the CA), then `GET /upstream-proxy` for the selection | 26 | [x] |
| `RemoveUpstreamProxy` | binding | COVERED | `DELETE /upstream-proxy/{name}`, then `GET /upstream-proxy` for the selection | 26 | [x] |
| `UseUpstreamProxy` | binding | COVERED | `PUT /upstream-proxy-selection {name}` | 26 | [x] |
| `CheckUpstreamProxy` | binding | COVERED | `POST /upstream-proxy/{name}/check {target}` | 26 | [x] |
| `ReadUpstreamProxyCAFile` | binding | GUI | OS open dialog reads the PEM on this machine and sends it as `ca` | 26 | [x] |
| `GetWaypoints` | binding | COVERED | `GET /waypoint`, `waypoint.*` | 26 | [x] |
| `CreateWaypoint` | binding | COVERED | `POST /waypoint {hostname, override}` | 26 | [x] |
| `DeleteWaypoint` | binding | COVERED | `DELETE /waypoint {hostname}` | 26 | [x] |

## Former gaps

These 13 v1 features had no control API. Each is now covered by a branch merged into marasi `integration/v2-backlog`.

| Marasi branch | route or event | rows |
|---|---|---|
| `t3/project-list-modification-time` | `GET /project/list` `modified_at` | `GetRecentProjects` |
| `t3/project-opening-progress` | `project.opening`, `project.upgrading`, `project.opening_failed` | `OpenProject`, `project-opening`, `log` |
| `t3/list-machine-network-interfaces` | `GET /listener/interfaces` | `GetInterfaces` |
| `t3/dashboard-counts-api` | `GET /dashboard` | `CountNotes` |
| `t3/traffic-count-by-field` | `GET /traffic/count/by-field` | `CountArmoryRunTraffic` |
| `t3/announce-websocket-upgrade-failures` | `websocket.handshake_ended` | `ws-state` |
| `t3/delete-launchpad-control-api` | `DELETE /launchpad/{id}`, `launchpad.deleted` | `DeleteLaunchpad` |
| `t3/report-export-created-at-properties` | `POST /report` `created_at`, `custom_properties` | `ExportReport` |
| `t3/checkpoint-intercepted-at` | `intercepted_at` on Checkpoint items | `GetCheckpointItems` |
| `t3/checkpoint-resolution-event-details` | `checkpoint.forwarded`, `checkpoint.dropped` with `request_id` and `reason` | `checkpoint-settled`, `checkpoint-abandoned` |
| `t3/cancelled-interrupted-armory-runs` | Runs left `in_progress` are cancelled when a project opens | `GetActiveArmoryRunIDs` |
| `t3/control-api-scope-rules` | `GET /scope` | `GetScopeRules` |
| `t3/extension-gui-live-logs` | `extension.gui.rendered`, `extension.gui.updated`, `extension.log` | `extension_gui_render`, `extension_state_update`, `<extensionName>-log` |
