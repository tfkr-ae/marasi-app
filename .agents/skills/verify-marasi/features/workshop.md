# Lua workshop

## Sub-features

- Project-scoped Lua editing and completion
- Saving and executing extension code
- Request and response handlers
- Extension logs and editor settings

## How to get to it (user POV)

Select the rail item titled `Workshop` or press `Command+8`. A ready page exposes `Workshop Settings` and a Lua editor with `data-language="lua"`. `Update Workshop` (`⌘⇧R`) and `Show Logs` (`⌘⇧L`) are commands in the `⌘K` palette and shortcuts only; they are not buttons on the page. The settings panel holds a single `Execute` button.

Shortcuts: every menu shortcut for this feature is a catalog action in context `workshop` in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh workshop` for route proof. Proven behavior sequence (replace `<token>` with a unique marker):

```json
{"name":"print-and-update","steps":[
 {"waitText":"Welcome to the Marasi Workshop"},
 {"click":"div[data-language=lua]"},{"key":"cmd+a"},{"insert":"print(\"<token>\")"},
 {"key":"cmd+shift+r"},{"waitText":"Ran Workshop"},
 {"key":"cmd+shift+l"},{"waitText":"<token>","within":".drawer"},
 {"key":"cmd+shift+l"},{"waitNoSelector":".drawer"}]}
```

Then confirm the service holds the new code: `GET /extension` for the `workshop` id, then `GET /extension/{id}` with the bearer password from the state directory (see SKILL.md, "Driving the service from outside"). The log wait is scoped to `.drawer` because the editor also shows the token. `Show Logs` is fed by Lua `print`; `extension:log` is not a runtime API, and `marasi:log` writes to the app log, not this drawer.

## Gotchas

- The editor's bound store updates 300 ms after the last edit. The driver waits that out after `insert`. A hand-driven `⌘⇧R` sent sooner runs the previous code and still toasts `Ran Workshop`, so the toast alone is not proof.
- The project's code loads asynchronously. Wait for its text (`Welcome to the Marasi Workshop` in a fresh project) before replacing it.
- Both `Update Workshop` and the settings panel's `Execute` run the code through `POST /extension/{id}`, which runs it first and stores it only when it runs. A Lua error shows its message in an error toast that stays until dismissed (`{"text":"Dismiss toast"}`), and the stored code is unchanged.
- `Show Logs` toggles whatever drawer is open: if another drawer is open, the first press closes it.
- The logs drawer reads `GET /extension/{id}/logs` and follows `extension.log`. Use a unique token per run.
- A success message alone does not prove request or response handlers changed traffic.

## Extension GUI over the service

Workshop's Lua can draw a GUI (`marasi.gui:render`), which proves the `extension.gui.*` events and `POST /extension/{id}/call`. Proven sequence, from `/workshop` (insert the Lua on one line):

```lua
function echo(state) marasi.gui:update("out", "got-" .. (state.q or "")); marasi.gui:render("toast", {message = "<token>", variant = "success"}) end; marasi.gui:render("icon", {type = "icon", icon = "Box", size = 18}); marasi.gui:render("main", {type = "v-stack", children = {{type = "input", label = "Query", value = {bind = "q"}}, {type = "button", value = "Echo", on_click = "echo"}, {type = "text", value = {bind = "out", default = "none"}}}})
```

Run it (`⌘⇧R`), click the new rail tile (`a[name=workshop]`), type into the input, then toggle `workshop Settings` open and shut before clicking `Echo`, and wait for `got-<text>` and the `<token>` toast. The GUI's input commits its value 250 ms after the last keystroke, and two accordion clicks outlast that; an immediate `Echo` sends the old state.

An extension whose Lua defines `ui_code` (a web component UI) and draws no `icon` gets a dimmed rail tile, `[data-testid=extension-web-ui-tile]`, reading `Not available yet`: the service doesn't serve web component UIs. Post such Lua to an extension from outside and the tile appears at once, through `extension.updated`.
