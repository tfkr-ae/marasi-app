# Request fuzzing

## Sub-features

- Request templates and payload positions
- Wordlists, attack mode, HTTPS, and concurrency settings
- Persisted runs, status polling, and captured traffic
- Request detail handoff from Ledger

## How to get to it (user POV)

Select the rail item titled `Armory` or press `Command+6`. A ready page exposes `Armory Settings`, template controls, runs, and traffic. The request editor requires a selected template; a fresh scratchpad shows `No templates yet` and `No template selected`.

## Driving it with Chrome CDP

Run `scripts/drive.sh armory` for route proof. For a run, use a disposable local HTTP endpoint and an isolated one-line wordlist. Create a request with one payload position, disable HTTPS, set concurrency to `1`, and launch it. Capture the completed run, its traffic row and response, and the matching isolated SQLite rows.

## Gotchas

- A fresh scratchpad may have no templates. Wordlists live in `$APP_CONFIG_DIR/wordlists`, not the `.marasi` file. Seed that directory for an isolated run.
- Wordlists are loaded when the project is populated. If seeded after startup, reopen the isolated project through Open Project before choosing a wordlist; changing routes alone does not reload the list.
- Validation is debounced and temporarily disables run controls.
- Harpoon and broadside require exactly one wordlist; tandem and maelstrom require one per payload position.
- Polling makes status evidence timing-sensitive; wait for a terminal state.
