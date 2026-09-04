# Request replay

## Sub-features

- Launchpad groups and request entries
- Request editor and HTTPS toggle
- Entry/group navigation and unsaved-edit prompt
- Send, response display, and handoff to other tools

## How to get to it (user POV)

Select the rail item titled `Launchpad` or press `Command+5`. A fresh project shows `No Launchpads` and `Create one from ledger.` Users normally add an entry from a Ledger request, then edit and send it here.

## Driving it with Chrome CDP

Run `scripts/drive.sh launchpad` for the fresh-project route proof. For replay behavior, first capture a request in Ledger and use its Launchpad action. In Launchpad, select the group and entry, edit the real request text, and activate `Send`. Capture the source Ledger action, edited request, sending action, resulting status/body, and persisted Launchpad/request rows in the isolated SQLite project.

## Gotchas

- The empty state proves only that the route loaded.
- Navigating away with changed request text opens a confirmation prompt and discards changes when accepted.
- The target may receive a real network request. Use a local disposable endpoint unless external delivery is the behavior under test.
