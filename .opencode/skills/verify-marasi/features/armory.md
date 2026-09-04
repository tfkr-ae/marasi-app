# Request fuzzing

## Sub-features

- Request templates and payload positions
- Wordlists, attack mode, HTTPS, and concurrency settings
- Persisted runs, status polling, and captured traffic
- Request detail handoff from Ledger

## How to get to it (user POV)

Select the rail item titled `Armory` or press `Command+6`. A ready page exposes `Armory Settings`, a request editor, template controls, runs, and traffic.

## Driving it with Chrome CDP

Run `scripts/drive.sh armory` for route proof. For a run, use a disposable local HTTP endpoint and an isolated one-line wordlist. Create a request with one payload position, disable HTTPS, set concurrency to `1`, and launch it. Capture the completed run, its traffic row and response, and the matching isolated SQLite rows.

## Gotchas

- A fresh scratchpad may have no templates or wordlists.
- Validation is debounced and temporarily disables run controls.
- The payload-position count must match the selected wordlists and attack mode.
- Polling makes status evidence timing-sensitive; wait for a terminal state.
