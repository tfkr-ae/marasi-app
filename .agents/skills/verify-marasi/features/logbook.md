# Findings and test cases

## Sub-features

- Finding and test-case creation, editing, deletion, sorting, and search
- All, Findings, and Test Cases tabs
- Linked requests, artifacts, treatment plans, and relationships
- Report export configuration

## How to get to it (user POV)

Select the rail item titled `Logbook` or press `Command+7`. `Logbook Settings` starts closed. Expand it to expose search (`#logbookSearch`), tabs, creation controls, and report export.

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
- Search matches findings by title and severity only; test cases also match description, category, tags, and note. Search enables report export, but the export contains every item regardless of the search.
- `⌘⇧S` toggles the settings panel, so it closes an open one.
