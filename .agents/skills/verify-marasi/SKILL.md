---
name: verify-marasi
description: Verify the Marasi Wails desktop app by driving its -tags server build from headless Chrome; use after changing user-visible behavior, proxy startup, navigation, or persisted project data.
---

# Verify Marasi

Marasi is a Wails v3 desktop app that works against a Marasi service instance through its control API and its `/events` stream. Verification runs a real `marasi service` with an isolated config dir beside the app's `-tags server` build: one Go process serves the Svelte UI over HTTP on loopback, binding calls go to `/wails/runtime`, and Go's events reach the page over the `/wails/events` WebSocket that the server's `/wails/custom.js` opens. Headless Chrome drives that page through CDP. The server build has no window, menu, native dialog or clipboard; [features/native.md](features/native.md) lists every flow that needs one and how each is checked.

## Build

```bash
.agents/skills/verify-marasi/scripts/build.sh
```

It runs `wails3 task build:server DEV=true` (frontend, bindings, then `go build -tags server`) and writes `bin/marasi-app-server`. It takes about 40 s. Run `scripts/bootstrap.sh` first in a fresh worktree; on Linux without the GTK4 and WebKitGTK 6.0 development packages, run it as `CGO_ENABLED=0 scripts/bootstrap.sh`: when the `wails3` on PATH is missing or not the version `go.mod` pins, it installs that version, and with cgo on that install needs them. Rebuild after every Go or frontend change: launch and doctor refuse a build that is missing, built without `-tags server`, or older than any non-test `.go`, `go.mod`, `go.sum`, or `frontend/src`/`frontend/static` file, and name the file. Nothing reloads the running app when source changes.

## The Marasi service

The app starts or attaches to the `default` instance of the Marasi CLI it finds on PATH. Launch links a CLI into `$MARASI_VERIFY_STATE_DIR/bin/marasi`, puts that directory first on the app's PATH, and sets `MARASI_APP_CLI_CONFIG_DIR` to `$MARASI_VERIFY_STATE_DIR/marasi`, which the app passes as `--config-dir` to every CLI call. Nothing touches the default config dir, where the researcher's own instance runs. Never run `marasi` without `--config-dir` while verifying.

- **The CLI.** `MARASI_VERIFY_CLI`, or else `marasi` on PATH. Launch refuses a CLI whose `service start --help` doesn't mention `MARASI_PASSWORD`: older dev builds lack control passwords and pairing. Build one from Marasi main (`GOWORK=off go build -o <dir>/marasi ./cmd/marasi` in the Marasi checkout) and point `MARASI_VERIFY_CLI` at it.
- **Who starts it.** `MARASI_VERIFY_SERVICE=attach` (the default): launch starts the instance with a generated password and the recorded proxy port, as a researcher would from a terminal, and the app attaches. `MARASI_VERIFY_SERVICE=app`: the app starts it (`--port 0`, a loopback control listener, its own password), and stops it when it quits.
- **Driving the service from outside.** After launch, `control-url` and `service-password` in the state directory hold the instance's control address and password (read from `service control pair` over its socket). Use them with curl to change the service behind the app, for example `curl -H "Authorization: Bearer $(cat "$MARASI_VERIFY_STATE_DIR/service-password")" -X POST "$(cat "$MARASI_VERIFY_STATE_DIR/control-url")/listener/update" -d '{"address":"127.0.0.1","port":<port>}'`. After moving the proxy listener, write the new port to `proxy-port`, since doctor checks it. A reconnect that turns the control listener back on gives it a new address and password; read them again with `"$MARASI_VERIFY_STATE_DIR"/bin/marasi --config-dir "$MARASI_VERIFY_STATE_DIR"/marasi service control pair --json` (`url`, `password`) and rewrite both files.
- **Quit.** Cleanup and restart stop the app first, record in `service-after-quit.txt` whether the instance was still running (`running` in attach mode, `stopped` in app mode is correct), then stop it.

## Launch

Run from the repository root on macOS or Linux:

```bash
.agents/skills/verify-marasi/scripts/launch.sh
```

Launch copies the build into the state directory and runs that copy with an isolated `HOME` (its working directory too), `WAILS_SERVER_HOST=127.0.0.1` and `WAILS_SERVER_PORT`, plus the CLI's PATH and config dir (see "The Marasi service"). It writes verification-only config with `first_run: false`, starts the service in attach mode, waits for `/health`, and starts an isolated headless Chrome sized so the page is `1600x900`, the app window's size. It returns once the page shows the scratchpad dashboard with the Wails runtime loaded, the `/wails/events` handshake answered `101`, and the Home listener indicator online, and once the proxy port belongs to the Marasi service process, not the app (the app runs no proxy). It prints the app URL, the service PID and mode, the proxy port, the control address, the state directory and the evidence directory.

Ports come from the OS: the server, proxy and DevTools ports are each a free port picked at launch and recorded in the state directory (in app mode the service picks the proxy port, and launch reads it back from `service status`). Launch picks DevTools' port itself, apart from the other two, rather than passing Chrome port 0. Set `MARASI_VERIFY_SERVER_PORT`, `MARASI_VERIFY_PROXY_PORT` or `MARASI_VERIFY_CDP_PORT` to choose one; launch refuses a busy one and names its owner. Recipes write the proxy port as `<proxy port>`: read it from `$MARASI_VERIFY_STATE_DIR/proxy-port` or `launch.txt`.

The state directory is `$MARASI_VERIFY_STATE_DIR`, default `${TMPDIR}/verify-marasi`. It holds the isolated home, the running binary, the linked CLI, the service's config dir (`marasi/`, with its project at `marasi/projects/scratchpad.marasi` and its log at `marasi/instances/default.log`), Chrome's profile and the recorded PIDs and ports; nothing touches `~/Library/Application Support/Marasi`. Keep it short: the service's socket path (`marasi/instances/default.sock` under it) must fit in 104 bytes, and launch refuses a longer one. Launch refuses a state directory that already has an instance or stale state.

**Parallel sessions.** Give each agent its own `MARASI_VERIFY_STATE_DIR` and export it for every helper call in that session; with the default ports, two sessions in one checkout or two worktrees run at once without sharing a port, a binary or a project. Run `build.sh` from one session at a time per checkout: the running sessions keep their own copies, so a rebuild never changes them.

Environment variables set for launch reach the app, which is how the file-dialog stubs in [features/native.md](features/native.md) work.

Teardown only the instance recorded by the helper:

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

## Restart

To prove that a saved preference survives an app restart, restart the recorded instance instead of cleaning up:

```bash
.agents/skills/verify-marasi/scripts/restart.sh
```

Restart stops the recorded Chrome and Marasi processes, keeps the isolated home (including `marasi_appconfig.yaml` and the scratch project) and both ports, and relaunches with `MARASI_VERIFY_KEEP_CONFIG=1`, so launch reads the existing config instead of rewriting it. It runs the current build, so it also picks up a rebuild. It creates a new evidence directory. Inspect the YAML before and after the restart. `cleanup.sh` still removes everything at the end.

## Doctor

Run this first whenever startup, automation, or a result looks wrong:

```bash
.agents/skills/verify-marasi/scripts/doctor.sh
```

With no instance recorded, doctor runs launch's preflight: the tools, a current server build, and any port set through `MARASI_VERIFY_*_PORT` free. It prints `status=ready to launch`.

With an instance, it checks the Marasi and Chrome PIDs, the running binary, the server port owned by the Marasi PID, the service running in its isolated config dir with the proxy port owned by its PID, `/health`, the Chrome DevTools endpoint, the isolated config and project database, and then the page: the Wails runtime loaded (`window._wails` and `/wails/custom.js`, which only the server build serves), the page still the one launch loaded, the `1600x900` viewport, the app rail, the page in front, and no leftover overlay. A reloaded page fails: the evidence would no longer describe the page launch loaded. Clean up and relaunch after any reload. It also fails while a modal, command palette, row menu (`.ledger-row-menu`, a fixed `div` that covers the rows under it), or drawer from an earlier drive is still open. Skeleton's modal wrapper uses `display: contents`, so doctor measures the wrapper's card instead, and the card itself for a built-in confirm, alert or prompt (`[data-testid=modal]`); the Marasi menu is an open `<dialog>`, which doctor measures itself, so a menu filtered down to one row still counts. A `waitSelector` on `[data-testid=modal-component]` never matches for the same reason: wait for the modal's text instead. Doctor and drive attach to the Chrome page whose URL matches the app's origin, not the first `type=page` target. Headless Chrome can also keep `chrome://settings/help` and omnibox pages around. A green doctor writes `doctor.txt` and prints the exact paths.

Launch sizes the headless window so the page itself is `1600x900`. Drives do not use a per-session viewport override: that override ends when each CDP session closes, and the page then relayouts at Chrome's smaller default (`1600x813`), which pushes the Settings rail item off screen.

When doctor reports a leftover overlay or drawer, dismiss it with real input (Escape, then a backdrop click, or `Discard` on the Logbook record modal's unsaved-changes prompt) and re-run doctor:

```bash
.agents/skills/verify-marasi/scripts/reset.sh
```

If reset cannot clear it, run cleanup and relaunch.

## Drive

Use the executable driver with one mapped route:

```bash
.agents/skills/verify-marasi/scripts/drive.sh dashboard
.agents/skills/verify-marasi/scripts/drive.sh ledger
.agents/skills/verify-marasi/scripts/drive.sh compass
.agents/skills/verify-marasi/scripts/drive.sh checkpoint
.agents/skills/verify-marasi/scripts/drive.sh launchpad
.agents/skills/verify-marasi/scripts/drive.sh armory
.agents/skills/verify-marasi/scripts/drive.sh logbook
.agents/skills/verify-marasi/scripts/drive.sh workshop
.agents/skills/verify-marasi/scripts/drive.sh settings
.agents/skills/verify-marasi/scripts/drive.sh dashboard theme
```

The driver connects to the isolated Chrome DevTools endpoint, sends a real mouse press to an actionable control, and fails unless the expected route or overlay appears. Route proof waits for the path plus text only the destination page paints, never a rail label.

The driver never clicks blind and never sleeps between inputs. Before each click it polls every 100 ms (default timeout 10 s) until exactly one match is actionable:

- **Hit-testable.** `document.elementFromPoint` at the match's centre lands on the match or inside it. This excludes the hidden MarasiKeys `<dialog>` copies of the same labels, controls behind a modal or drawer, and controls off screen. A unique off-screen match is scrolled into view first.
- **Unique.** Two actionable matches are an error that lists both. Refine the selector, scope it with `within`/`hasText`, or choose deliberately with `nth`.
- **Enabled.** Not `disabled` or `aria-disabled`.
- **Stable.** Same box on two consecutive polls, so a sliding drawer or fading modal is not clicked mid-transition.

On timeout, the error names every match and why it was rejected (for example `covered by div.drawer`, `outside viewport`, `disabled`).

Exactly one fixed wait remains. After `insert` into a CodeMirror editor, the driver waits 350 ms, because `svelte-codemirror-editor` copies edits into the bound store only after a 300 ms debounce, and nothing in the page signals the commit. Without it, an immediate `⌘⇧R` runs the old code while still showing an `Updated …` toast.

Most in-app actions have that painted control plus a MarasiKeys binding. Global bindings (`⌘+key`, including `⌘K` for the menu) live in the action catalog, `frontend/src/lib/keybindings/catalog.js`, with handlers in `frontend/src/lib/components/MarasiMenu/GlobalMenu.svelte`; they work on every route. Page and drawer bindings (mostly `⌘+⇧+key` on macOS) are in the same catalog, keyed to a menu context in `frontend/src/lib/keybindings/contexts.js` (for example `ledger.drawer-closed` and `ledger.drawer-open`); their handlers stay in the route's component. Opening the Ledger or Armory request drawer swaps which actions keys reach and which entries the `⌘K` menu lists. The WebSocket modal is an overlay: its shared context `websocket` plus the open tab's (`websocket.stream`, `websocket.checkpoint`, `websocket.inject`, `websocket.connection`) and the global context are live there, never the drawer beneath. Extension pages use `extension-page.<name-slug>` (Toggle Settings) with the extension's declared actions as `extension.<name-slug>.<action-slug>`. A modal closes again on the binding of the action that opened it (`toggleAction` in its trigger), unless the open modal binds that key itself, as the Inject tab does with `⌘⇧O`. Prove both paths with:

```bash
.agents/skills/verify-marasi/scripts/drive.sh dashboard compare "Open Project" "cmd+o"
```

The compare action requires the feature route to already be visible. It clicks the actionable label, waits for the overlay or route change, and then waits until that text stops changing for 500 ms before capturing. Overlays fill in after they paint; the Project modal shows `No recent projects` until the service's project list arrives. It restores the starting page, then sends the shortcut through `Input.dispatchKeyEvent` (primary modifier down, key, key up, primary modifier up; Meta on macOS, Control on Linux/Windows). It fails unless both paths paint the same overlay text or land on the same route. Pass or fail, it dismisses its overlay with Escape so the next drive is not blocked.

The dashboard `theme` action leaves Home for Settings, sends `Command+U` twice, and fails unless the global appearance changes and returns to its original mode. This proves the global shortcut still reads live state after Home is destroyed.

For behavioral actions beyond navigation, use a named sequence of real UI inputs:

```bash
.agents/skills/verify-marasi/scripts/drive.sh settings steps '{"name":"vim-toggle","steps":[{"click":"nav[aria-label=\"Settings sections\"] button","hasText":"Keyboard & Editor"},{"click":"section [role=switch]"}]}'
```

`steps` first goes to the feature's page through its rail icon when another page is open, then runs the steps. Use one action per step.

| Step | Meaning |
| --- | --- |
| `{"click": "<css>"}` | Click the one actionable match. Add `"hasText"` to keep matches whose text contains it (for example `{"click":"tbody tr","hasText":"/probe"}`), `"within": "<css>"` to scope, `"nth": n` (1-based) to pick among several on purpose, `"button": "right"` for a context menu, `"clickCount": 2` for a double-click, `"modifiers": ["cmd", "shift"]` to hold keys during the click (`cmd` is Meta on macOS, Ctrl elsewhere), `"edge": "top"` or `"bottom"` to click 3 px inside that edge instead of the centre (a modal backdrop, whose centre the modal covers). |
| `{"drag": "<css>", "to": "<css>"}` | Press on the one actionable match (`hasText`/`within` scope it), move onto the `to` match (`toHasText` scopes it; `within` applies to both) with the button held, and release there. For a sweep across Ledger rows: `{"drag":".ledger-row","hasText":"/a","to":".ledger-row","toHasText":"/c"}`. `"toEdge": "top"` or `"bottom"` releases 3 px inside that edge of the `to` match instead of its centre, for drops that read which half of a row the pointer is on. `"hold": true` keeps the button down, so the next steps (and their captures) see the drag in progress; end it with a `release` step, or send `escape` first to cancel it. A recipe that stops while holding sends Escape and then releases. |
| `{"release": true}` | Releases a held drag where it stopped. |
| `{"wheel": "<css>", "deltaY": n}` | One real wheel turn of `n` px over the one actionable match (same rules and scoping as `click`), for scrolling a container, for example when sticky rows cover the control to click. The driver does not wait for the hidden page to acknowledge it, so wait for the scrolled state next. |
| `{"text": "<label>"}` | Click the one actionable button, link, switch, tab, label, or summary whose normalized text, `aria-label`, or `title` equals the label. Wrappers around a matching control collapse to the control. `within` and `nth` apply. |
| `{"hover": "<css>"}` | Move the pointer onto the one actionable match (same rules and `hasText`/`within`/`nth` as `click`, except that a disabled match counts), for controls shown only on hover, such as a saved query's Rename, Move and Delete buttons. The pointer stays there until the next click. `-steps.json` records the match's box, so hovers prove a control kept its place. |
| `{"key": "cmd+shift+r"}` | Shortcut, same syntax as compare. Also `escape`, `enter`, `tab`, `backspace`, `[`, `]`, `\` (escaped as `\\` in JSON), `up`, `down`, `left`, `right`, `f10`, `contextmenu` (the ContextMenu key), with `alt` or `shift` as well (`alt+shift+up`, `shift+f10`). A bare character without `cmd`, `ctrl`, or `alt` (for example `{"key":"l"}`) types itself, so a focused `<select>` jumps to the first option that starts with it. Letters sent within about a second join into one search (`m` then `w` matches nothing), so leave about a second of other steps between them. |
| `{"insert": "<text>"}` | Waits for a focused input or editor, inserts, then waits until the text is in that field. |
| `{"waitText": "…"}`, `{"waitNoText": "…"}` | Visible `innerText` contains or lacks the text. Add `within` to read only matching roots, so text the editor already holds cannot satisfy the wait. |
| `{"waitEnabledText": "<label>"}` | The labelled control is actionable and enabled. |
| `{"waitSelector": "<css>"}`, `{"waitNoSelector": "<css>"}` | A visible match appears or none is left. |
| `{"waitPath": "/route"}` | The route changed, for example after a toast's jump action. |

Any step accepts `"timeoutMs"` (1–60000, default 10000). There is no sleep step: wait for the state the next action depends on. Input goes through CDP mouse and keyboard events, never store or backend calls.

To replace text, click the editor or input, send `cmd+a`, then `insert`. This works in CodeMirror with Vim enabled, because `Input.insertText` bypasses Vim's keymap. The route's input-focus filter drops shortcuts while an `INPUT`, `SELECT`, or `TEXTAREA` has focus, so click a non-input control (a CodeMirror editor is fine) before a shortcut.

Wait for specific resulting content: the unique marker you inserted, a count, or a toast. An existing label or text still in the editor is not a result. Inspect screenshots and persisted side effects even when the sequence passes. A sequence is an input driver, not an automatic proof of the feature's full behavior. End each sequence with its modal or drawer closed. Doctor runs before every drive and refuses residue. After a failure, run `reset.sh`, or clean up and relaunch.


The shipped CDP helper uses Node's built-in `WebSocket` (scripts export `NODE_OPTIONS=--experimental-websocket` for Node 20), so it adds no npm package. Chrome defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, then `google-chrome` or `chromium` on PATH; override `MARASI_VERIFY_CHROME_BIN` when needed. On Linux `build.sh` builds with `CGO_ENABLED=0` (unless you set it): with cgo on, Wails v3.1.0 compiles its WebKit file into the server build too (`internal/operatingsystem/webkit_linux.go` has no `!server` constraint), which then needs `gtk4` and `webkitgtk-6.0`. Without cgo the server build needs no GTK or WebKit libraries, and Marasi needs no cgo (it uses modernc SQLite); launch seeds config under the isolated `~/.config/Marasi`, and recipes' `cmd`/`⌘` shortcuts map to Ctrl so they match Windows/Linux factory bindings. Chrome keeps some Ctrl shortcuts for itself and the page never sees them: `Ctrl+T` (`⌘T`, `global.toggle-vim`) opens a new tab and `Ctrl+Shift+N` (`⌘⇧N`, Launchpad `View Notes` and the Ledger drawer's `View Note`) a new window, each left behind as a `chrome://newtab/` page target. Browser extensions can own keys the same way. Chrome's managed policy may force-install extensions into the isolated profile (the box installs 1Password, whose `_execute_action` is `Ctrl+Shift+X`), so `⌘⇧X` never reaches the page on Linux: Checkpoint `Drop Picked Items`, Launchpad's swap A and B, `Unlink Finding`, and the WebSocket modal's `Close Connection`. List the keys extensions ask for with `jq -c '.commands' "$MARASI_VERIFY_STATE_DIR"/chrome/Default/Extensions/*/*/manifest.json`, then prove one with a drive: Chrome does not grant every request (the same extension's `Ctrl+Shift+L` still reaches the page). On Linux, drive those actions from the Marasi menu: `{"key":"cmd+k"},{"waitSelector":"#commandmenu"},{"click":"#commandmenu"},{"key":"cmd+a"},{"insert":"vim"},{"click":"dialog[open] li","hasText":"Toggle Vim Mode"}`. The menu keeps its search text between openings, and a reopened menu can focus the last item instead of the search box, so click `#commandmenu` and clear it with `cmd+a` first. Click the item; Enter does not run it. Such an extension can also open its own tab in front of Marasi; every driver session brings the Marasi page to the front, because Chrome stops painting a hidden page and each screenshot then stalls for about a minute.

Launch and doctor first check that `lsof`, `curl`, `node` and `go` are on PATH (`build.sh` also needs `wails3`) and stop with `Required tool <name> is not on PATH`. `wails3` is usually in `$(go env GOPATH)/bin`, which a non-login shell may not have on PATH. Without `lsof` every port check would read as free.

## Evidence

Each launch creates `.artifacts/verify-marasi/<UTC timestamp>/` (with `-2`, `-3` when sessions launch in the same second). Keep these files as the proof:

- `launch.txt` records the binary, the build's time, PID, isolated home, the app URL and the ports.
- `app.log` records backend startup, proxy messages, and each failed binding call (`ERR Binding call failed: …`).
- `launch-ready.json` and `launch-ready.png` capture the first ready dashboard. `launch-events-socket.json` records the `/wails/events` handshake, `launch-page.json` the page load doctor compares against, `launch-console.json` and `launch-network.json` browser startup.
- `<feature>-before.json` and `<feature>-before.png` capture the state before navigation.
- `<feature>-action.txt` records the exact user input.
- `<feature>-after.json` and `<feature>-after.png` capture the resulting DOM and screen.
- `<label>-click-*` and `<label>-shortcut-*` capture a painted-control compare; `<label>-compare.json` is the pass/fail record.
- `theme-before.*`, `theme-toggled.*`, `theme-restored.*`, and `theme-result.json` prove the global appearance shortcut works after leaving Home.
- `<feature>-<recipe>-action.json`, `-before.*`, `-step-<n>.*`, `-after.*`, `-console.json`, and `-network.json` record a UI-step sequence, including the resulting state on an action failure. `-steps.json` records each step's click point, duration, and failure reason. Use a distinct recipe name for each attempt so earlier evidence is not overwritten.
- `<feature>-console.json` and `<feature>-network.json` record browser events during the action. A failed binding call is a `POST /wails/runtime` answered `422`, with the Go error as the message. Chrome replays the page's earlier console messages when the driver attaches, so a `-console.json` also holds every `422` since launch; match them against `app.log`'s `Binding call failed` lines, and the `-network.json` of the same drive, to find the ones it caused.
- `doctor.txt` proves the process, the service and its listener, config, and SQLite project existed.
- `service-start.json` (attach mode) and `service-status.json` record the instance launch started or the app reached; `service-after-quit.txt` records whether it outlived the app.

Exercise the real user path rather than calling bindings, editing stores, or using a test-only endpoint. Capture both the action and resulting state. For proxy traffic, report export, project edits, or settings changes, also inspect the isolated files or SQLite rows and add that output to the same evidence directory. Use mocks only at an existing production boundary. If a safe path claims to be a dry run, inspect files, network connections, and project rows to establish what it skipped.

Browser screenshots do not need macOS Screen Recording permission. The driver fixes the viewport at `1600x900`, matching the window configured in `main.go`, and records the dimensions in each JSON capture. Use Chrome DevTools against the recorded CDP endpoint when an interactive console or network inspector is useful. The repo ignores `.artifacts`, so proof files do not appear in `git status`.

Known noise, when doctor passes and the expected DOM, screenshot, and side effect all agree: the console's `⚠️ Browser Environment Detected … Only UI previews are available in the browser` (the Wails runtime prints it in any browser; bindings and events still work), `app.log`'s `finding where Marasi is installed: … is not inside an app bundle` (the updater, in a development build), and headless Chrome's `CVDisplayLinkCreateWithCGDisplay failed` on macOS. Record and investigate other errors.

## Cleanup

Run:

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

Cleanup sends `TERM` only to the recorded Chrome and Marasi PIDs, waits for Marasi, and uses `KILL` only if that same PID does not exit. `TERM` shuts the server build down without the unsaved-work prompt, through the same shutdown as a quit. It then records whether the service survived the quit and stops it with `service stop` against the isolated config dir. It removes the state directory: the scratch home, the binary copy and the state files. It leaves `.artifacts/verify-marasi/` untouched. Run cleanup after failed attempts too.

## Helpers

All scripts under `scripts/` are executable and derive the repository root from their own path. Their supported invocations are shown above. `launch.sh`, `doctor.sh`, `reset.sh`, and `drive.sh` call `cdp.mjs`, which resolves targets through `targets.mjs` (`node --test scripts/*.test.mjs` covers the selection rules); call the shell helpers rather than reverse-engineering the CDP protocol. Shortcut compares go through `drive.sh <feature> compare`, not a one-off CDP script.

`bench-seed.sh` and `bench-ledger.sh` benchmark the Ledger against its performance budget; see "Performance budget" in `features/ledger.md`. The benchmark reloads the page, so run `restart.sh` before driving again.

Read `features/README.md` before choosing proof coverage. A check of one easy route does not cover the other mapped entry points.
