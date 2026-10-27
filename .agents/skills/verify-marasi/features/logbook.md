# Findings and test cases

## Sub-features

- Finding and test-case creation, editing, deletion, sorting, and search
- All, Findings, and Test Cases tabs
- Linked requests, artifacts, treatment plans, and relationships
- Report export configuration

## How to get to it (user POV)

Select the rail item titled `Logbook` or press `Command+7`. The dock holds `#logbookNewFinding`, `#logbookNewTestCase` and the status toggle (`.logbook-status`); the toolbar holds the search (`#logbookSearch`), `#logbookKind-findings`, `#logbookKind-testCases`, the `#logbookSeverityButton`, `#logbookCategoryButton` and `#logbookTagsButton` menus, `#logbookClearFilters` and `#logbookExport`. The workspace is `.logbook-summary`. The round trip below predates this layout: open a new finding with `#logbookNewFinding` and wait for its title in `.logbook-summary`.

Shortcuts: every menu shortcut for this feature is a catalog action in context `logbook` in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh logbook` for route proof. Proven round trip (replace `<marker>` with a unique title):

```json
{"name":"finding-roundtrip","steps":[
 {"text":"Logbook Settings"},{"waitSelector":"#logbookSearch"},
 {"text":"Finding","within":".accordion-panel"},{"waitText":"New Finding"},
 {"click":"[data-testid=modal-component] input[type=text]","nth":1},{"key":"cmd+a"},{"insert":"<marker>"},
 {"click":"[aria-label=Close]"},{"waitNoText":"New Finding"},{"waitText":"<marker>"},
 {"click":"#logbookSearch"},{"insert":"<marker>"},{"waitText":"<marker>"},
 {"click":"h4","hasText":"<marker>"},{"waitText":"New Finding"},
 {"click":"[aria-label=Close]"},{"waitNoText":"New Finding"}]}
```

Then run `select title, severity from findings`. The report drawer is browser-verifiable, but saving a report uses a native dialog.

## Gotchas

- A fresh scratchpad has no findings or test cases.
- Creating an item persists a draft immediately. Closing a draft deletes it only if all defaults are unchanged: title `Draft Finding`, severity `High`, writeup `Writeup`, no CVSS, no treatment plan, no links.
- The modal header reads `New Finding` even for an existing finding. Check the Title input or the database, not the header.
- The Title input has no id or placeholder; it is the modal's first `input[type=text]`.
- Saving on close is asynchronous. Wait for the card text to change rather than assuming it.
- Search matches findings by title and severity only; test cases also match description, category, tags, and note. Export is disabled only when the search leaves no findings and no test cases; the export still contains every item regardless of the search.
- Severity is a native `<select>`. Focus it with real input (click the Title input, then `{"key":"tab"}`), then type its first letter, for example `{"key":"l"}` for `Low`. Its options have no box, so assert severity through the closed card's badge or the `findings.severity` row.
- Setting a CVSS vector derives severity from the score. A manual severity must survive reopening the finding, and only a score change may overwrite it. The calculator is `[data-testid=cvss-calculator]`: its score row toggles the metrics (`{"text":"Show metrics"}` or `"Hide metrics"`), and they start open only on an unscored finding. Pick with `{"click":"[role=group][aria-label=Integrity] button","hasText":"None"}`. Group labels render uppercase, so wait for `EXPLOITABILITY`. `Paste vector`, `Copy vector` and `Clear score` are titled icon buttons; a refused paste shows `Not a CVSS 3.1 vector`, and Escape there closes only the paste box.
- `⌘⇧S` toggles the settings panel, so it closes an open one.
