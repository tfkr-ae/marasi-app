# Findings and test cases

## Sub-features

- The page: dock outline (`+ Finding`, `+ Test case`, the All · In progress · Done toggle, Group by), the toolbar (search, kind toggles, Severity, Category and Tags menus, Export) and the summary
- The record view: checklist, inline fixes with their leave prompt, linked records, evidence (requests and artifacts) and the expanded pair
- The finding and test case modal and its edit session: Save and close, Close without saving, the dirty prompt
- Export review, with Include test cases

The code map is `docs/agents/maps/logbook.md`.

## How to get to it (user POV)

Select the rail item titled `Logbook` or press `Command+7`.

- **Dock** (`.logbook-outline`): `#logbookShown` (`N of M shown`), `#logbookNewFinding`, `#logbookNewTestCase`, the status toggle (`.logbook-status`), and one button per record (`.logbook-outline button` with the title as text).
- **Toolbar** (`.logbook-toolbar`): `#logbookSearch`, `#logbookKind-findings`, `#logbookKind-testCases`, `#logbookSeverityButton`, `#logbookCategoryButton`, `#logbookTagsButton` (panels `#logbook<Name>Panel`), `#logbookClearFilters` (only while a filter is set) and `#logbookExport`.
- **Summary** (`.logbook-summary`): severity cards (`.logbook-severity-card`), a Test cases card, and one row per record in `.logbook-summary-findings button` and `.logbook-summary-test-cases button`.
- **Record view** (`.logbook-record`, in place of the summary): `#logbookBack`, `#logbookNext` (title `Next in progress (N)` with the status toggle on All, else `Next (N)`; the key is the live binding of `logbook.next-record`), `#logbookEdit`, `#logbookDelete`. The checklist is `.logbook-checklist`, with the Required progress in `.logbook-progress` (`1/4`, or `done`). The open fix is `.logbook-fix[data-fix=<item>]` (`WriteUp`, `CVSSVector`, `TreatmentPlan`, `Requests`, `Note`, `Category`, `TestCaseID`) with `[data-fix-save]` and `[data-fix-cancel]`; the requests fix searches with `[data-fix-search]`. The leave prompt is `[data-leave-prompt]`. Evidence: `.logbook-pair` with `.logbook-pair-expand`; the expanded pair is `.logbook-pair-expanded`.
- **Modal**: `[data-record-modal=finding]` or `[data-record-modal=testCase]`, header `New finding` or `Edit finding`, title input `input[placeholder='Finding title']` (or `'Test case title'`), test case category `input[data-field=Category]`, text areas `#logbook-WriteUp`, `#logbook-TreatmentPlan`, `#logbook-Note`. `[data-unsaved-mark]` shows while dirty. The footer has `Close without saving` and `Save and close`; the dirty prompt is `[data-close-prompt]` (`Keep editing`, `Discard`, `Save and close`).
- **Export**: `.logbook-export`, totals `#exportTotals` (`2 findings · 1 test case · …`, or `no test cases`), the review `.logbook-report-review`, the switch `Include test cases`, `#exportReport`.

Shortcuts: every menu shortcut for this feature is a catalog action in context `logbook` in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys. Next Record is `N`, unmodified, so it never runs while a field or editor has focus. Esc (back to the list) is handled by the page, not the menu.

## Driving it with Chrome CDP

Run `scripts/drive.sh logbook` for route proof; it waits for `In progress`, which the dock's status toggle always paints.

A fresh scratchpad has no records and no traffic. Send a few requests through the proxy first (see `ledger.md`; the recipes below link `/profile`, whose JSON body holds `admin`). Use a unique marker per run (`LB09L` in light, `LB09D` in dark) and change the waits that count records (`1 test case`) to match the project. Run the recipes in this order; each leaves the page as the next one expects. Check light and dark mode: switch with `{"key":"cmd+u"},{"waitSelector":"html.dark"}`.

**Modal: dirty prompt, Discard, Save and close.** X, Esc and a click on the backdrop each ask; Esc on the prompt keeps editing; Discard leaves nothing; Save and close creates the record.

```json
{"name":"modal","steps":[
 {"click":"#logbookNewFinding"},{"waitSelector":"[data-record-modal=finding]"},{"waitText":"New finding"},
 {"click":"input[placeholder='Finding title']"},{"insert":"<marker> IDOR on profile"},{"waitSelector":"[data-unsaved-mark]"},
 {"click":"[aria-label=Close]","within":"[data-record-modal]"},{"waitSelector":"[data-close-prompt]"},
 {"key":"escape"},{"waitNoSelector":"[data-close-prompt]"},{"waitSelector":"[data-unsaved-mark]"},
 {"click":"#logbook-WriteUp"},{"key":"escape"},{"waitSelector":"[data-close-prompt]"},{"text":"Keep editing"},{"waitNoSelector":"[data-close-prompt]"},
 {"click":".modal-backdrop","edge":"top"},{"waitSelector":"[data-close-prompt]"},
 {"text":"Discard"},{"waitNoSelector":"[data-record-modal]"},{"waitNoText":"<marker> IDOR on profile","within":".logbook-summary"},
 {"click":"#logbookNewFinding"},{"waitSelector":"[data-record-modal=finding]"},
 {"click":"input[placeholder='Finding title']"},{"insert":"<marker> IDOR on profile"},
 {"text":"Save and close"},{"waitNoSelector":"[data-record-modal]"},{"waitText":"Finding created"},{"waitText":"<marker> IDOR on profile","within":".logbook-summary"}]}
```

**Close without saving** leaves the record as it was:

```json
{"name":"edit-close-without-saving","steps":[
 {"click":".logbook-summary-findings button","hasText":"<marker> IDOR on profile"},{"waitSelector":".logbook-record"},
 {"click":"#logbookEdit"},{"waitText":"Edit finding"},
 {"click":"input[placeholder='Finding title']"},{"key":"cmd+a"},{"insert":"<marker> renamed"},{"waitSelector":"[data-unsaved-mark]"},
 {"text":"Close without saving"},{"waitNoSelector":"[data-record-modal]"},
 {"waitText":"<marker> IDOR on profile","within":".logbook-record"},{"waitNoText":"<marker> renamed"}]}
```

**Checklist and inline fixes, with the leave prompt.** The record opened on its first missing item. Back with unsaved input asks; Esc keeps editing; Discard drops the input. Each Save opens the next missing item; the last one makes the record Done with a toast. A CVSS fix sets the severity from the score (Critical for the vector below).

```json
{"name":"checklist-inline-fix","steps":[
 {"waitSelector":"[data-fix=WriteUp]"},{"waitText":"0/4","within":".logbook-progress"},
 {"click":"[data-fix=WriteUp] textarea"},{"insert":"<marker> steps to reproduce"},
 {"click":"#logbookBack"},{"waitSelector":"[data-leave-prompt]"},
 {"key":"escape"},{"waitNoSelector":"[data-leave-prompt]"},{"waitSelector":".logbook-record"},
 {"click":"#logbookBack"},{"waitSelector":"[data-leave-prompt]"},
 {"text":"Discard","within":"[data-leave-prompt]"},{"waitNoSelector":".logbook-record"},{"waitSelector":".logbook-summary"},
 {"click":".logbook-summary-findings button","hasText":"<marker> IDOR on profile"},{"waitSelector":"[data-fix=WriteUp]"},
 {"waitNoText":"<marker> steps to reproduce"},
 {"click":"[data-fix=WriteUp] textarea"},{"insert":"<marker> steps to reproduce"},{"key":"cmd+enter"},
 {"waitSelector":"[data-fix=CVSSVector]"},{"waitText":"1/4","within":".logbook-progress"},
 {"click":"[data-fix=CVSSVector] [role=group][aria-label=Integrity] button","hasText":"None"},
 {"click":"[data-fix-save]"},{"waitSelector":"[data-fix=TreatmentPlan]"},{"waitText":"2/4","within":".logbook-progress"},
 {"click":"[data-fix=TreatmentPlan] textarea"},{"insert":"<marker> check ownership"},{"key":"cmd+enter"},
 {"waitSelector":"[data-fix=Requests]"},{"waitText":"3/4","within":".logbook-progress"},
 {"click":"[data-fix-search]"},{"insert":"profile"},{"click":"[data-fix=Requests] button","hasText":"/profile"},
 {"waitText":"new","within":"[data-fix=Requests]"},{"click":"[data-fix-save]"},
 {"waitText":"done","within":".logbook-progress"},{"waitText":"Finding done"}]}
```

**The expanded pair** closes alone, on Esc and on a click outside; Esc then goes back to the list:

```json
{"name":"expanded-pair","steps":[
 {"waitSelector":".logbook-record"},{"waitText":"admin","within":".logbook-pair"},
 {"click":".logbook-record .logbook-pair-expand"},{"waitSelector":".logbook-pair-expanded"},
 {"key":"escape"},{"waitNoSelector":".logbook-pair-expanded"},{"waitSelector":".logbook-record"},
 {"click":".logbook-record .logbook-pair-expand"},{"waitSelector":".logbook-pair-expanded"},
 {"click":".logbook-pair-expanded","edge":"top"},{"waitNoSelector":".logbook-pair-expanded"},{"waitSelector":".logbook-record"},
 {"key":"escape"},{"waitNoSelector":".logbook-record"},{"waitSelector":".logbook-summary"}]}
```

Before the next recipe, create a test case (`#logbookNewTestCase`, title `<marker> login test`, category `Authentication`) and a second finding (`<marker> XSS in search`) with Save and close.

**Toolbar staying put, filtering, N and Esc.** The hovers record each control's box in `-steps.json`: compare `x` and `width` across the three kinds. The menus and Export keep their boxes, and the one that doesn't apply is `disabled`. The search input narrows by the width of `#logbookClearFilters` once a filter is set; its left edge stays. Any filter change closes the open record.

```json
{"name":"toolbar-filter-next","steps":[
 {"hover":"#logbookSearch"},{"hover":"#logbookSeverityButton"},{"hover":"#logbookCategoryButton"},{"hover":"#logbookTagsButton"},{"hover":"#logbookExport"},
 {"click":"#logbookKind-findings"},{"waitNoText":"<marker> login test","within":".logbook-summary"},
 {"hover":"#logbookSearch"},{"hover":"#logbookSeverityButton"},{"hover":"#logbookCategoryButton"},{"hover":"#logbookTagsButton"},{"hover":"#logbookExport"},
 {"click":"#logbookKind-findings"},{"click":"#logbookKind-testCases"},{"waitNoText":"<marker> XSS in search","within":".logbook-summary"},
 {"hover":"#logbookSearch"},{"hover":"#logbookSeverityButton"},{"hover":"#logbookCategoryButton"},{"hover":"#logbookTagsButton"},{"hover":"#logbookExport"},
 {"click":"#logbookClearFilters"},{"waitText":"<marker> XSS in search","within":".logbook-summary"},
 {"click":".logbook-outline button","hasText":"<marker> XSS in search"},{"waitText":"<marker> XSS in search","within":".logbook-record"},
 {"key":"n"},{"waitText":"<marker> login test","within":".logbook-record"},
 {"key":"escape"},{"waitNoSelector":".logbook-record"},{"waitSelector":".logbook-summary"},
 {"click":".logbook-outline button","hasText":"<marker> XSS in search"},{"waitSelector":".logbook-record"},
 {"click":"#logbookSearch"},{"insert":"XSS"},{"waitNoSelector":".logbook-record"},{"waitNoText":"<marker> login test","within":".logbook-summary"},
 {"click":"#logbookClearFilters"},{"waitText":"<marker> login test","within":".logbook-summary"}]}
```

N follows the outline's order (findings by severity then title, then test cases) and skips Done records while the status toggle is on All. With records from an earlier run, N lands on the next In progress record in that order, so wait for that title.

**Export with Include test cases off.** The review drops the test cases; the choice is kept in `reportMetadata`, so the recipe turns it back on.

```json
{"name":"export-test-cases-off","steps":[
 {"click":"#logbookExport"},{"waitSelector":".logbook-export"},{"waitText":"1 test case","within":"#exportTotals"},
 {"waitText":"<marker> login test","within":".logbook-report-review"},
 {"text":"Include test cases","within":".logbook-export"},{"waitText":"no test cases","within":"#exportTotals"},
 {"waitNoText":"<marker> login test","within":".logbook-report-review"},
 {"click":"[aria-label=Close]","within":".logbook-export"},{"waitNoSelector":".logbook-export"},
 {"click":"#logbookExport"},{"waitText":"no test cases","within":"#exportTotals"},
 {"text":"Include test cases","within":".logbook-export"},{"waitText":"1 test case","within":"#exportTotals"},
 {"key":"escape"},{"waitNoSelector":".logbook-export"}]}
```

Then check the project: `sqlite3 -readonly <project> "select title, severity, cvss_score from findings; select title, category from test_cases"`. Each marker has one IDOR finding (Critical, 9.1; Discard left nothing), with its original title.

## Gotchas

- Export report opens a native Save dialog on the desktop, which the driver cannot answer. `custom_properties.include_test_cases` reaching the report is covered by `app_reporting_test.go`.
- A click outside a modal needs `"edge":"top"` on `.modal-backdrop`: the modal covers the backdrop's centre. The same goes for `.logbook-pair-expanded`.
- Escape on a dirty record modal only toggles its prompt. `reset.sh` answers `Discard` on `[data-close-prompt]`.
- The Marasi menu's search matches a page action's keywords, not its label: `next` finds Next Record, `export` finds nothing.
- Severity in the modal is a segmented control, not a `<select>`. The CVSS picker is `[data-testid=cvss-calculator]`: pick with `{"click":"[role=group][aria-label=Integrity] button","hasText":"None"}`. Group labels render uppercase (`EXPLOITABILITY`). `Paste vector`, `Copy vector` and `Clear score` are titled icon buttons; a refused paste shows `Not a CVSS 3.1 vector`.
- Nothing is written until Save: a new finding exists only after `Save and close`, and an inline fix only after its Save.
