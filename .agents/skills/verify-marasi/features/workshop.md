# Lua workshop

## Sub-features

- Project-scoped Lua editing and completion
- Saving and executing extension code
- Request and response handlers
- Extension logs and editor settings

## How to get to it (user POV)

Select the rail item titled `Workshop` or press `Command+8`. A ready page exposes `Workshop Settings` and a Lua editor with `data-language="lua"`. `Update Workshop` (`⌘⇧R`) and `Show Logs` (`⌘⇧L`) are commands in the `⌘K` palette and shortcuts only; they are not buttons on the page. The settings panel holds a single `Execute` button.

## Driving it with Chrome CDP

Run `scripts/drive.sh workshop` for route proof. Proven behavior sequence (replace `<token>` with a unique marker):

```json
{"name":"print-and-update","steps":[
 {"waitText":"Welcome to the Marasi Workshop"},
 {"click":"div[data-language=lua]"},{"key":"cmd+a"},{"insert":"print(\"<token>\")"},
 {"key":"cmd+shift+r"},{"waitText":"Updated Workshop"},
 {"key":"cmd+shift+l"},{"waitText":"<token>","within":".drawer"},
 {"key":"cmd+shift+l"},{"waitNoSelector":".drawer"}]}
```

Then confirm `select lua_content from extensions where name='workshop'` holds the new code. The log wait is scoped to `.drawer` because the editor also shows the token. `Show Logs` is fed by Lua `print`; `extension:log` is not a runtime API, and `marasi:log` writes to the app log, not this drawer.

## Gotchas

- The editor's bound store updates 300 ms after the last edit. The driver waits that out after `insert`. A hand-driven `⌘⇧R` sent sooner saves and runs the previous code and still toasts `Updated Workshop`, so the toast alone is not proof.
- The project's code loads asynchronously. Wait for its text (`Welcome to the Marasi Workshop` in a fresh project) before replacing it.
- `Update Workshop` reports execution errors; the settings panel's `Execute` button does not, and shows no toast.
- Both execution paths persist before executing, so invalid Lua may remain saved.
- `Show Logs` toggles whatever drawer is open: if another drawer is open, the first press closes it.
- The logs drawer subscribes to `workshop-log` only after loading the existing log snapshot, so a print that lands in that gap can be missing. Use a unique token per run.
- A success message alone does not prove request or response handlers changed traffic.
