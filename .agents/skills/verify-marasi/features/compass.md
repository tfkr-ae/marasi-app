# Scope management

## Sub-features

- Default scope policy
- Lua include and exclude rules
- Scope tester for a supplied URL
- Extension logs and editor settings

## How to get to it (user POV)

Select the rail item titled `Compass` or press `Command+3`. Expand `Compass Settings` for the scope tester: `#urlInput` and a `Test Rules` button. The Lua editor exposes `data-language="lua"`. `Update Compass Code` (`⌘⇧R`) and `Show Logs` (`⌘⇧L`) are `⌘K` palette commands and shortcuts, not page buttons. Vim behavior follows the global configuration.

## Driving it with Chrome CDP

Run `scripts/drive.sh compass` for route proof. Proven rule-change sequence:

```json
{"name":"exclude-rule","steps":[
 {"waitText":"scope:clear_rules()"},
 {"click":"div[data-language=lua]"},{"key":"cmd+a"},
 {"insert":"local scope = marasi:scope()\nscope:clear_rules()\nscope:add_rule(\"-.*compass-blocked.*\", \"url\")\nfunction processRequest(request)\nif not scope:matches(request) then request:skip() end\nend\nfunction processResponse(response)\nif not scope:matches(response) then response:skip() end\nend"},
 {"key":"cmd+shift+r"},{"waitText":"Updated Compass"},
 {"text":"Compass Settings"},{"waitSelector":"#urlInput"},{"click":"#urlInput"},{"key":"cmd+a"},
 {"insert":"http://127.0.0.1:18099/compass-blocked"},
 {"text":"Test Rules"},{"waitText":"127.0.0.1:18099/compass-blocked"},{"waitText":"In Scope: No"}]}
```

Then send `/compass-blocked` and `/compass-allowed` through the isolated proxy and query `request`. Only the allowed path should persist.

## Gotchas

- A successful editor save does not prove that a rule matches the intended URL. The tester uses `Scope.Matches` only and ignores custom `processRequest` logic, so the tester and Ledger can disagree.
- `Update Compass Code` persists before executing, so an execution error can leave invalid saved code. Execution adds to the existing Lua state; code without `scope:clear_rules()` stacks rules.
- The previous tester result stays visible until the next test starts. Wait for the new URL in the result, not just `Tested URL:`. `#urlInput` keeps its value across visits, and reopening the panel re-runs the test.
- Vim mode is on in the verification config. `cmd+a` then `insert` still replaces the editor text.
- Include and exclude policy determines whether a request appears in the project; inspect both UI output and persisted rows.
