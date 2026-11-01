# Driving the page

Reference for `drive.sh` and `cdp.mjs`: how the driver picks a target, the `compare`, `theme` and `steps` actions, and the keys Chrome keeps for itself. SKILL.md has the commands.

## Targets

The driver never clicks blind and never sleeps between inputs. Before each click it polls every 100 ms (default timeout 10 s) until exactly one match is actionable:

- **Hit-testable.** `document.elementFromPoint` at the match's centre lands on the match or inside it. This excludes the hidden MarasiKeys `<dialog>` copies of the same labels, controls behind a modal or drawer, and controls off screen. A unique off-screen match is scrolled into view first.
- **Unique.** Two actionable matches are an error that lists both. Refine the selector, scope it with `within`/`hasText`, or choose deliberately with `nth`.
- **Enabled.** Not `disabled` or `aria-disabled`.
- **Stable.** Same box on two consecutive polls, so a sliding drawer or fading modal is not clicked mid-transition.

On timeout, the error names every match and why it was rejected (for example `covered by div.drawer`, `outside viewport`, `disabled`).

Exactly one fixed wait remains. After `insert` into a CodeMirror editor, the driver waits 350 ms, because `svelte-codemirror-editor` copies edits into the bound store only after a 300 ms debounce, and nothing in the page signals the commit. Without it, an immediate `⌘⇧R` runs the old code while still showing an `Updated …` toast.

## Shortcuts and compare

Most in-app actions have a painted control plus a MarasiKeys binding. Global bindings (`⌘+key`, including `⌘K` for the menu) live in the action catalog, `frontend/src/lib/keybindings/catalog.js`, with handlers in `frontend/src/lib/components/MarasiMenu/GlobalMenu.svelte`; they work on every route. Page and drawer bindings (mostly `⌘+⇧+key` on macOS) are in the same catalog, keyed to a menu context in `frontend/src/lib/keybindings/contexts.js` (for example `ledger.drawer-closed` and `ledger.drawer-open`); their handlers stay in the route's component. Opening the Ledger or Armory request drawer swaps which actions keys reach and which entries the `⌘K` menu lists. The WebSocket modal is an overlay: its shared context `websocket` plus the open tab's (`websocket.stream`, `websocket.checkpoint`, `websocket.inject`, `websocket.connection`) and the global context are live there, never the drawer beneath. Extension pages use `extension-page.<name-slug>` (Toggle Settings) with the extension's declared actions as `extension.<name-slug>.<action-slug>`. A modal closes again on the binding of the action that opened it (`toggleAction` in its trigger), unless the open modal binds that key itself, as the Inject tab does with `⌘⇧O`. Prove both paths with:

```bash
scripts/drive.sh home compare "Open Project" "cmd+o"
```

The compare action requires the feature route to already be visible. It clicks the actionable label, waits for the overlay or route change, and then waits until that text stops changing for 500 ms before capturing. Overlays fill in after they paint; the Project modal shows `No recent projects` until `GetRecentProjects` resolves. It restores the starting page, then sends the shortcut through `Input.dispatchKeyEvent` (primary modifier down, key, key up, primary modifier up; Meta on macOS, Control on Linux/Windows). It fails unless both paths paint the same overlay text or land on the same route. Pass or fail, it dismisses its overlay with Escape so the next drive is not blocked.

The Home `theme` action leaves Home for Settings, sends `Command+U` twice, and fails unless the global appearance changes and returns to its original mode. This proves the global shortcut still reads live state after Home is destroyed.

## Steps

For behavioral actions beyond navigation, use a named sequence of real UI inputs:

```bash
scripts/drive.sh settings steps '{"name":"vim-toggle","steps":[{"click":"nav[aria-label=\"Settings sections\"] button","hasText":"Keyboard & Editor"},{"click":"section [role=switch]"}]}'
```

`steps` requires the feature route to already be visible. Use one action per step.

| Step | Meaning |
| --- | --- |
| `{"click": "<css>"}` | Click the one actionable match. Add `"hasText"` to keep matches whose text contains it (for example `{"click":"tbody tr","hasText":"/probe"}`), `"within": "<css>"` to scope, `"nth": n` (1-based) to pick among several on purpose, `"button": "right"` for a context menu, `"clickCount": 2` for a double-click, `"modifiers": ["cmd", "shift"]` to hold keys during the click (`cmd` is Meta on macOS, Ctrl elsewhere), `"edge": "top"` or `"bottom"` to click 3 px inside that edge instead of the centre (a modal backdrop, whose centre the modal covers). |
| `{"drag": "<css>", "to": "<css>"}` | Press on the one actionable match (`hasText`/`within` scope it), move onto the `to` match (`toHasText` scopes it; `within` applies to both) with the button held, and release there. For a sweep across Ledger rows: `{"drag":".ledger-row","hasText":"/a","to":".ledger-row","toHasText":"/c"}`. `"toEdge": "top"` or `"bottom"` releases 3 px inside that edge of the `to` match instead of its centre, for drops that read which half of a row the pointer is on. `"hold": true` keeps the button down, so the next steps (and their captures) see the drag in progress; end it with a `release` step, or send `escape` first to cancel it. A recipe that stops while holding sends Escape and then releases. |
| `{"release": true}` | Releases a held drag where it stopped. |
| `{"wheel": "<css>", "deltaY": n}` | One real wheel turn of `n` px over the one actionable match (same rules and scoping as `click`), for scrolling a container, for example when sticky rows cover the control to click. The driver does not wait for the hidden page to acknowledge it, so wait for the scrolled state next. |
| `{"text": "<label>"}` | Click the one actionable button, link, switch, tab, label, or summary whose normalized text, `aria-label`, or `title` equals the label. Wrappers around a matching control collapse to the control. `within` and `nth` apply. |
| `{"hover": "<css>"}` | Move the pointer onto the one actionable match (same rules and `hasText`/`within`/`nth` as `click`, except that a disabled match counts), for controls shown only on hover, such as a saved query's Rename, Move and Delete buttons. The pointer stays there until the next click. `-steps.json` records the match's box, so hovers prove a control kept its place. |
| `{"key": "cmd+shift+r"}` | Shortcut, same syntax as compare. Also `escape`, `enter`, `tab`, `backspace`, `[`, `]`, `\` (escaped as `\\` in JSON), `up`, `down`, with `alt` as well (`alt+shift+up`). A bare character without `cmd`, `ctrl`, or `alt` (for example `{"key":"l"}`) types itself, so a focused `<select>` jumps to the first option that starts with it. Letters sent within about a second join into one search (`m` then `w` matches nothing), so leave about a second of other steps between them. |
| `{"files": "<css>", "paths": ["<file>"]}` | Hands files on this machine to the first file input that matches, as its native picker would, and the input fires `change`. The input can be hidden behind its label. For example the Logbook modal's artifacts: `{"files":"[data-artifact-input]","paths":["/tmp/shot.png"]}`. |
| `{"insert": "<text>"}` | Waits for a focused input or editor, inserts, then waits until the text is in that field. |
| `{"waitText": "…"}`, `{"waitNoText": "…"}` | Visible `innerText` contains or lacks the text. Add `within` to read only matching roots, so text the editor already holds cannot satisfy the wait. |
| `{"waitEnabledText": "<label>"}` | The labelled control is actionable and enabled. |
| `{"waitSelector": "<css>"}`, `{"waitNoSelector": "<css>"}` | A visible match appears or none is left. |
| `{"waitPath": "/route"}` | The route changed, for example after a toast's jump action. |

Any step accepts `"timeoutMs"` (1–60000, default 10000). There is no sleep step: wait for the state the next action depends on. Input goes through CDP mouse and keyboard events, never store or backend calls.

To replace text, click the editor or input, send `cmd+a`, then `insert`. This works in CodeMirror with Vim enabled, because `Input.insertText` bypasses Vim's keymap. The route's input-focus filter drops shortcuts while an `INPUT`, `SELECT`, or `TEXTAREA` has focus, so click a non-input control (a CodeMirror editor is fine) before a shortcut.

Wait for specific resulting content: the unique marker you inserted, a count, or a toast. An existing label or text still in the editor is not a result. Inspect screenshots and persisted side effects even when the sequence passes. A sequence is an input driver, not an automatic proof of the feature's full behavior. End each sequence with its modal or drawer closed. Doctor runs before every drive and refuses residue. After a failure, run `reset.sh`, or clean up and relaunch.

## Chrome and keys

The shipped CDP helper uses Node's built-in `WebSocket` (the scripts export `NODE_OPTIONS=--experimental-websocket` for Node 20), so it adds no npm package. Chrome defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then `google-chrome` or `chromium` on PATH; override `MARASI_VERIFY_CHROME_BIN` when needed. On Linux and Windows the driver maps recipe `cmd`/`⌘` shortcuts to Ctrl so they match Windows/Linux factory bindings. Chrome keeps some Ctrl shortcuts for itself and the page never sees them: `Ctrl+T` (`⌘T`, `global.toggle-vim`) opens a new tab and `Ctrl+Shift+N` (`⌘⇧N`, Launchpad `View Notes` and the Ledger drawer's `View Note`) a new window, each left behind as a `chrome://newtab/` page target. Browser extensions can own keys the same way. Chrome's managed policy may force-install extensions into the isolated profile (the box installs 1Password, whose `_execute_action` is `Ctrl+Shift+X`), so `⌘⇧X` never reaches the page on Linux: Checkpoint `Drop Picked Items`, Launchpad's swap A and B, `Unlink Finding`, and the WebSocket modal's `Close Connection`. List the keys extensions ask for with `jq -c '.commands' "$TMPDIR"/verify-marasi/chrome/Default/Extensions/*/*/manifest.json`, then prove one with a drive: Chrome does not grant every request (the same extension's `Ctrl+Shift+L` still reaches the page). On Linux, drive those actions from the Marasi menu: `{"key":"cmd+k"},{"waitSelector":"#commandmenu"},{"click":"#commandmenu"},{"key":"cmd+a"},{"insert":"vim"},{"click":"dialog[open] li","hasText":"Toggle Vim Mode"}`. The menu keeps its search text between openings, and a reopened menu can focus the last item instead of the search box, so click `#commandmenu` and clear it with `cmd+a` first. Click the item; Enter does not run it. Such an extension can also open its own tab in front of Marasi; every driver session brings the Marasi page to the front, because Chrome stops painting a hidden page and each screenshot then stalls for about a minute.
