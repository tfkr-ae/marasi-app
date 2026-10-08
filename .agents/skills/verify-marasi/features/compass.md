# Scope management

## Sub-features

- Default scope policy
- Lua include and exclude rules
- Scope tester for a supplied URL
- Extension logs and editor settings

## How to get to it (user POV)

Select the rail item titled `Compass` or press `Command+3`. Expand `Compass Settings` for the scope tester. The tester input is `#urlInput`; Lua editors expose `data-language="lua"` in the Wails webview. `Show Logs` opens extension logs, and Vim behavior follows the global configuration.

## Driving it with Chrome CDP

Run `scripts/drive.sh compass` for route proof. For a rule change, use `#urlInput`, visible labels, and `div[data-language="lua"]` rather than coordinates. Run `Update Compass Code`, then enter a concrete URL in the scope tester. Prove the effective behavior by sending matching and nonmatching requests through the isolated proxy and comparing Ledger rows.

## Gotchas

- A successful editor save does not prove that a rule matches the intended URL.
- `Update Compass Code` persists before executing, so an execution error can leave invalid saved code.
- Vim mode changes editor keyboard behavior and defaults to enabled in verification config.
- Include and exclude policy determines whether a request appears in the project; inspect both UI output and persisted rows.
