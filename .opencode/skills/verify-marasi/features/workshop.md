# Lua workshop

## Sub-features

- Project-scoped Lua editing and completion
- Saving and executing extension code
- Request and response handlers
- Extension logs and editor settings

## How to get to it (user POV)

Select the rail item titled `Workshop`. A ready page exposes `Workshop Settings` and a Lua editor with `data-language="lua"`.

## Driving it with Chrome CDP

Run `scripts/drive.sh workshop` for route proof. Replace the isolated project's code with a unique `extension:log` call, invoke `Update Workshop`, and open `Show Logs`. Capture the success result and unique log line.

## Gotchas

- Verification launch enables Vim mode, which changes editor keyboard behavior.
- `Update Workshop` reports execution errors; the settings panel's `Execute` button does not.
- Both execution paths persist before executing, so invalid Lua may remain saved.
- A success message alone does not prove request or response handlers changed traffic.
