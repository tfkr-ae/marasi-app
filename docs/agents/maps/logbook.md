# Logbook

Which files work together on the Logbook page, how a finding or test case is read, changed and saved, and where a page action goes. Names are functions and files, so search for them. A record is a finding or a test case; in the store, the kinds are `"finding"` and `"testCase"`.

## Files

- `frontend/src/routes/logbook/+page.svelte` wires everything together: the dock, the toolbar, the workspace (the summary, or the open record in its place), Delete's confirmation, the page-local Esc, and `logbookMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createLogbookStore.js` is the one seam for the page and the modal. It holds the records, the filters and grouping, the open record, the edit session (`session`) and the inline fix (`fix`). Its selectors are pure functions of the state: `completenessOf` (from `ITEMS`, the required and optional items per kind), `filteredOf`, `groupsOf`, `nextOf`, `openRecordOf`, `linkedOf`, `reportOf`, `changesOf`, `isDirty`. It takes its API as an argument; `frontend/src/stores/logbookStore.js` maps that API to Wails bindings. Tests: `logbookStore.test.js` (list model), `logbookEditSession.test.js`, `logbookInlineFix.test.js`.
- `frontend/src/lib/logbook/`:
  - the page: `LogbookToolbar` (search, kind toggles, Severity/Category/Tags menus on the Ledger's `ToolbarMenu`, Export), `LogbookOutline` (the dock's tree, create buttons, status toggle, `GroupPicker`), `LogbookSummary` (the list view);
  - the record view: `LogbookRecord` (header, Back/Next/Edit/Delete), `RecordChecklist` with `InlineFix`, `LinkedRecords`, and `EvidenceViewer` (`RequestList` + `RequestPair`, `ArtifactList` + `ArtifactPreview`). The modal reuses `EvidenceViewer`;
  - the modal: `RecordModal` (registered in `+layout.svelte` as `LogbookRecord`), `RecordForm`, `RecordEvidence`, `TagInput`, `TemplatePicker`, `TestCasePicker`, `OptionList`. `recordEditor.js` opens it: `newRecord(modalStore, kind, preset)` and `editRecord(modalStore, kind, id)`;
  - export: `ExportReview` (registered as `ExportReport`) and `ReportReview`;
  - helpers: `severity.js`, `artifacts.js` (content type to preview, tested in `artifacts.test.js`). The CVSS picker is `lib/components/CVSSCalculator.svelte` over `lib/cvss.js`.
- `frontend/src/stores.js`: `openProject` clears and fills the Logbook store; `reportMetadata` holds the export's details, with `custom_properties.include_test_cases`.
- Go: `reporting.go` holds the bindings (`CreateDraftFinding`, `SaveFinding`, `LinkRequestToFinding`, `SaveArtifactToFinding`, the test case twins, `GetArtifact`, `DownloadArtifact`, `ExportReport`) and `buildReportPayload`. Test: `app_reporting_test.go`.

## Reading and filtering

- `filteredOf` applies search, kind, status and the contextual filters. Severity narrows to findings; category and tags narrow to test cases. `setKind` drops the filters that do not apply, and a kind the tester did not pick returns to All when its filters clear (`manualKind`).
- Any filter change closes the open record (`setFilters`), so the page shows the list the filters now give.
- `nextOf` follows `groupsOf`'s on-screen order, findings then test cases, and wraps. With the status filter on All, it skips Done records ("Next in progress").
- Opening a record (`open(kind, id, focus)`) starts a fix on its first missing required item (`firstMissingOf`), or on `focus` when given. The fix does not take focus, so N and Esc keep working.

## Changing a record

Every change goes through the store's `saveIn`, which runs in this order:

1. A new record calls `create` (with its requests and test case), then the fields, then the uploads.
2. An existing record saves its fields, then links and unlinks each changed request, then uploads and deletes each changed artifact.

Each call that succeeds moves `original` on, so a failed call keeps the session with only what is still unsaved, and Save again carries on. An empty title makes no calls.

- **The modal.** `startNew` or `edit` copies the record to `session.draft`. Nothing is written until Save; `discard` makes no calls. `requestClose` closes a clean session and asks on a dirty one (`confirming`). The modal handles its own ⌘S and Esc, since an open Skeleton modal blocks every menu action (`gate.js`).
- **Inline fixes.** `startFix(item)` stages one item in the `fix` slot, and `saveFix` saves only that item through `saveIn("fix")`, then opens the next missing item. Moving away from a fix with input (`open`, `close`, `openNext`, a filter change) goes through `guarded` and sets `fix.leaving`; `keepFix` or `discardFix` answers it.
- **Other callers.** The Ledger, the Armory, the request view and a test case's + Finding call `newRecord` with `requestIds` or `testCaseId`. Create a record only through it: a record written first is visible before the tester saves.
- **Delete** calls `findingStore.delete` or `testCaseStore.delete`. Those older stores still feed the Dashboard and the Ledger. `logbookStore.js` follows them with `setRecords`, and `refreshOtherLists` rereads them after a Logbook save.

## Export

`ExportReview` calls `ExportReport` with `reportMetadata`. Go reads `custom_properties.include_test_cases` (`includesTestCases`) and leaves `TestCases` empty when it is false; `ReportReview` shows `reportOf(state, { includeTestCases })`. A gap click closes the modal and calls `open(kind, id, focus)`. The report is saved through a native Save dialog, which an agent cannot drive; test the payload in `app_reporting_test.go`.

## Adding a page action

1. Add a catalog row in the `logbook` block of `catalog.js`, and test its key in `menus.test.js` (see `keybindings-and-menus.md`). Esc and other reserved keys cannot be bindings, so Esc (back to the list) stays in the page's `onWindowKeydown`.
2. Add `{actionId, icon, handler}` to `logbookMenu`. A handler checks `$modalStore[0]` and, for anything that leaves the open record, `fix.leaving`.
3. If the action needs new state, add a store method, map its API in `logbookStore.js`, and add it to the fake API in the store tests.
