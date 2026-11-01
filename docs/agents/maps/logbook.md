# Logbook

Which files work together on the Logbook page, how a finding or test case is read, changed and saved, and where a page action goes. Names are functions and files, so search for them. A record is a finding or a test case; in the store, the kinds are `"finding"` and `"testCase"`.

## Files

- `frontend/src/routes/logbook/+page.svelte` wires everything together: the dock, the toolbar, the workspace (the summary, or the open record in its place), Edit (behind the leave prompt), Delete's confirmation, the page-local Esc, and `logbookMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createLogbookStore.js` is the one seam for the page and the modal. It holds the records, the filters and grouping, the open record, the edit session (`session`) and the inline fix (`fix`). Its selectors are pure functions of the state: `completenessOf` (from `ITEMS`, the required and optional items per kind), `filteredOf`, `groupsOf`, `nextOf`, `openRecordOf`, `linkedOf`, `reportOf`, `changesOf`, `isDirty`. Every write goes through its per-kind `BINDINGS` table. It takes its API as an argument; `frontend/src/stores/logbookStore.js` maps that API to the v1 bindings in `App.js`. Tests: `logbookStore.test.js` (list model), `logbookEditSession.test.js`, `logbookInlineFix.test.js` (with Delete in the edit session tests).
- `frontend/src/lib/logbook/`:
  - the page: `LogbookToolbar` (search, kind toggles, Severity/Category/Tags menus on the Ledger's `ToolbarMenu`, Export), `LogbookOutline` (the dock's tree, create buttons, status toggle, `GroupPicker`), `LogbookSummary` (the list view);
  - the record view: `LogbookRecord` (header, Back/Next/Edit/Delete), `RecordChecklist` with `InlineFix`, `LinkedRecords`, and `EvidenceViewer` (`RequestList` + `RequestPair`, `ArtifactList` + `ArtifactPreview`). The modal reuses `EvidenceViewer`;
  - the modal: `RecordModal` (registered in `+layout.svelte` as `LogbookRecord`), `RecordForm`, `RecordEvidence`, `TagInput`, `TemplatePicker`, `TestCasePicker`, `OptionList`. `recordEditor.js` opens it: `newRecord(modalStore, kind, preset)` and `editRecord(modalStore, kind, id)`;
  - export: `ExportReview` (registered as `ExportReport`) and `ReportReview`. The templates are `frontend/src/stores/reportTemplateStore.js` (logic in `createReportTemplateStore.js`, test `reportTemplateStore.test.js`);
  - helpers: `severityColors.js` (the severity badge and mark colours, also used by `CVSSCalculator`), `artifacts.js` (content type to preview, tested in `artifacts.test.js`). The CVSS picker is `lib/components/CVSSCalculator.svelte` over `lib/cvss.js`.
- `frontend/src/stores.js`: `openProject` clears and fills the Logbook store; `reportMetadata` holds the export's details, with `custom_properties.include_test_cases`.
- `frontend/src/stores/findingStore.js` and `testCaseStore.js` hold the lists the Logbook follows (see Delete), built on `createRecordListStore.js` (test: `recordListStore.test.js`).
- Bindings: `frontend/src/lib/bindings/App.js` (`ListFindings`, `SaveFinding`, `CreateDraftFinding`, `LinkRequestToFinding`, `SaveArtifactToFinding`, the test case twins, `GetArtifact`, `DownloadArtifact`, `DeleteArtifact`), with `lib/bindings/records.js` mapping Marasi's records to v1's shapes (`findingRecord`, `testCaseRecord`, `artifactMetadata`, and back with `findingFields`, `testCaseFields`) and reading one record again for an event (`readFinding`, `readTestCase`). Test: `logbookBindings.test.js`. Export and templates: `ExportReport`, `ListTemplates`, `UploadReportTemplate`, `DeleteReportTemplate`, `RestoreDefaultReportTemplate`, with `lib/bindings/reports.js` building the `POST /report` body (`reportBody`, `localTimestamp`, `reportFilename`) and reading template lists (`templateNames`). Test: `reportBindings.test.js`.
- `electron/artifactFile.js` saves a downloaded artifact through the save dialog (`artifact:save`, the preload's `saveArtifact`), and `electron/reportFile.js` an exported report (`report:save`, `saveReport`). Both are `electron/savedFile.js`. Tests: `artifactFile.test.js`, `reportFile.test.js`.

## Marasi

- **Reads.** A list is `GET /finding` (or `/test-case`), then `GET /finding/{id}` for each, which carries its pairs (`items`) and `artifacts`. `Requests` are the pairs' ids.
- **Writes.** Save sends every field to `POST /finding/{id}`; links go one pair at a time (`POST /finding/{id}/traffic`, `DELETE /finding/{id}/traffic/{request_id}`). A draft (`CreateDraft*`) is v1's draft fields on `POST /finding`, its pairs in one `POST /traffic/bulk/link {selection: {ids}, finding_id}`, then a read back. Bulk link skips a pair that is gone, so the draft's `Requests` are the ones it really has; `saveIn` then links each pair still missing on its own, and a refusal (`not_found`) stays in the session as its error, with only that link unsaved.
- **Artifacts.** An upload is the file's bytes as the body of `POST /finding/{id}/artifact?filename=`, with its type as `Content-Type` (`marasi.sendBytes`). `GetArtifact` reads `GET /artifact/{id}` and the bytes from `/content` (`marasi.readBytes`; `Data` is a `Uint8Array`). `DownloadArtifact` reads them in the renderer and the main process writes them where the save dialog says, offering the name's last part in Downloads. `MARASI_ARTIFACT_DIR` saves there without the dialog, for headless verification.
- **Events** (`lib/marasiEvents.js`). `finding.created`, `.updated`, `.linked`, `.unlinked` and `artifact.created` make `findingStore.onChanged(id)` read that record again (the test case twins likewise); `.deleted` drops it, `test-case.deleted` also clears it from findings, and `artifact.deleted` drops the artifact from whichever record has it. A record that is new joins the top. `traffic.changed` with `change` `link`, `unlink` or `delete` doesn't name the record, so both lists are read again. Each store keeps only the latest read of a record, and drops reads from before a `clear` or a delete. The Logbook follows the stores, so an open record changes in place, and leaves for the list once deleted.

## Reading and filtering

- `filteredOf` applies search, kind, status and the contextual filters. Severity narrows to findings; category and tags narrow to test cases. `setKind` drops the filters that do not apply; All drops them all, so unpressing a kind never leaves a one-kind filter on both kinds. A kind the tester did not pick returns to All when its filters clear (`manualKind`).
- Any filter change closes the open record (`setFilters`), so the page shows the list the filters now give.
- Grouped by severity, a finding with none (Marasi takes one, so the CLI or an agent can save it) sits last under `No severity` (`groupsOf`).
- `nextOf` follows `groupsOf`'s on-screen order, findings then test cases, and wraps. With the status filter on All, it skips Done records ("Next in progress").
- The request/response pair (`RequestPair`) and a text artifact (`ArtifactPreview`) use the Ledger drawer's `DrawerEditor` and behave as the Ledger and Launchpad editors do: syntax by `usesSyntax` and the Syntax setting, wrapping by the shared `lineWrap` store (the Ledger drawer's Wrap lines) and the Line wrapping setting. They have no wrap control of their own; a pane whose long line paused wrapping says `Not wrapped` (`.logbook-wrap-suspended`), as the Launchpad's panes do.
- A dock section's `GroupPicker` menu sits inside that section's sticky header, so `LogbookOutline` raises the header (`z-20`) while its menu is open; otherwise the next section's header, at the same `z-10`, paints over the menu.
- Opening a record (`open(kind, id, focus)`) starts a fix on its first missing required item (`firstMissingOf`), or on `focus` when given. The fix does not take focus, so N and Esc keep working.

## Changing a record

Every change goes through the store's `saveIn`, which runs in this order:

1. A new record calls `create` (with its requests and test case), then the fields, then the uploads.
2. An existing record saves its fields, then links and unlinks each changed request, then uploads and deletes each changed artifact.

Each call that succeeds moves `original` on, so a failed call keeps the session with only what is still unsaved, and Save again carries on. An empty title makes no calls.

- **The modal.** `startNew` or `edit` copies the record to `session.draft`. Edit with an inline fix that has input goes through `guard` first, so the leave prompt asks. Nothing is written until Save; `discard` makes no calls. `requestClose` closes a clean session and asks on a dirty one (`confirming`). The modal handles its own ⌘S and Esc, since an open Skeleton modal blocks every menu action (`gate.js`). It has no `toggleAction`, unlike Export: the create keys must not close a dirty session without asking. Save's result carries `done`, and the modal then shows the same Done toast as the inline fix.
- **Inline fixes.** `startFix(item)` stages one item in the `fix` slot, and `saveFix` saves only that item through `saveIn("fix")`, then opens the next missing item. Moving away from a fix with input (`open`, `close`, `openNext`, a filter change) goes through `guarded` and sets `fix.leaving`; `keepFix` or `discardFix` answers it.
- **Other callers.** The Ledger, the Armory, the request view and a test case's + Finding call `newRecord` with `requestIds` or `testCaseId`. Create a record only through it: a record written first is visible before the tester saves.
- **Delete** awaits the store's `deleteRecord(kind, id)`. Only on success does the record leave the list and the workspace go back to it; a failure keeps it open and the page shows the error toast. `logbookStore.js` maps `deleteFinding` and `deleteTestCase` to `findingStore.delete` and `testCaseStore.delete`, since those older stores still feed the Dashboard and the Ledger. `logbookStore.js` follows them with `setRecords`, and `refreshOtherLists` rereads them after a Logbook save. Marasi's events keep them current for changes from any client (see Marasi).

## Export

`ExportReview` calls `ExportReport` with `reportMetadata`. `reportBody` sends `POST /report` the dates as `YYYY-MM-DD`, `include_test_cases` (false only when `custom_properties.include_test_cases` is false, as v1's `includesTestCases`), and `created_at` as RFC3339 with this machine's offset (`localTimestamp`). Marasi keeps the offset, so the report prints the researcher's time even when the instance runs in another zone; without it the instance stamps its own. `ReportReview` shows `reportOf(state, { includeTestCases })`. A gap click closes the modal and calls `open(kind, id, focus)`.

The rendered bytes come back to the renderer (`marasi.postBytes`), and the main process writes them where the Save dialog says, offering the title plus the template's extension once (the template's name without a title) in Downloads. `MARASI_REPORT_DIR` saves there without the dialog, for headless verification. The browser stand-in can't save a report.

**Templates.** The template row lists `reportTemplateStore`, which `ExportReview` reloads on open and which follows `report.template.added`, `.removed` and `.restored` (each carries the whole list), so a CLI or other-window change shows in the open modal. The pick stays while it is listed, else the first. Upload sends a file from this machine as the body of `POST /report/template?name=<file name>` and picks it; a taken name is refused (`report_template_already_exists`). Delete (`DELETE /report/template/{name}`) and Restore default (`POST /report/template/restore`) ask once inline. Templates belong to the instance's config directory, not the project.

## Adding a page action

1. Add a catalog row in the `logbook` block of `catalog.js`, and test its key in `menus.test.js` (see `keybindings-and-menus.md`). Esc and other reserved keys cannot be bindings, so Esc (back to the list) stays in the page's `onWindowKeydown`.
2. Add `{actionId, icon, handler}` to `logbookMenu`. `gate.js` already blocks menu actions while a modal is open; a handler that is also a button's click checks `$modalStore[0]` (or calls a helper such as `newRecord` that does). For anything that leaves the open record, it checks `fix.leaving` or goes through the store's `guard`.
3. If the action needs new state, add a store method, map its API in `logbookStore.js`, and add it to the fake API in the store tests.
