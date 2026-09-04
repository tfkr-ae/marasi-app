# Findings and test cases

## Sub-features

- Finding and test-case creation, editing, deletion, sorting, and search
- All, Findings, and Test Cases tabs
- Linked requests, artifacts, treatment plans, and relationships
- Report export configuration

## How to get to it (user POV)

Select the rail item titled `Logbook` or press `Command+7`. Expand `Logbook Settings` to expose search, tabs, creation controls, and report export.

## Driving it with Chrome CDP

Run `scripts/drive.sh logbook` for route proof. Create a finding, replace its title with a unique marker, close the modal, search for the marker, and reopen the card. Capture the filtered card and a read-only query of the persisted finding. The report drawer is browser-verifiable, but saving a report uses a native dialog.

## Gotchas

- A fresh scratchpad has no findings or test cases.
- Creating an item persists a draft immediately; closing an unchanged draft deletes it.
- Search filters both collections and controls whether report export is enabled.
