---
name: verify-marasi
description: Verify the Marasi Wails desktop app through its browser-connected dev server; use after changing user-visible behavior, proxy startup, navigation, or persisted project data.
---

# Verify Marasi

Marasi is a Wails desktop app backed by a local proxy and SQLite project. The Vite page on port `5173` cannot call the Go backend directly. Wails' dev server on port `34115` proxies Vite, injects the runtime, and connects browser calls to the running Go app through `/wails/ipc`.

## Launch

Run from the repository root on macOS:

```bash
.agents/skills/verify-marasi/scripts/launch.sh
```

The helper runs `wails dev -m -nosyncgomod -nocolour -devserver localhost:34115` with `GOWORK=off`, creates an isolated home directory, and writes verification-only config with `first_run: false`. It starts an isolated headless Chrome against the Wails dev server with the app's `1600x900` window size. It defaults to proxy port `18080`; set `MARASI_VERIFY_PROXY_PORT` before launch to choose another free port. It returns after browser JavaScript sees the scratchpad dashboard through the real Go bindings.

Chrome still starts on Home. During that first navigation, the driver intercepts the root HTML response and removes duplicate Wails bridge script tags; Wails v2.10.1 injects them alongside the explicit tags in `app.html`. The real backend and runtime scripts remain unchanged, and the native GUI still runs. Chrome needs the `loopback-network` DevTools permission, granted only to the Wails origin in the isolated profile, because response interception loses the document's loopback classification.

The driver also intercepts Chrome's compiled layout module during startup. Both the native GUI and Chrome bootstrap the listener; the second `StartProxy` rejects with `listener already active`, which otherwise makes Chrome's UI offline despite a running proxy. Only that startup rejection falls back to the real `UpdateProxy` with the configured address and port. Other failures retain the application's error path, and interactive listener controls remain unchanged. Launch requires the Home listener indicator to be online. Application source files are untouched; this is verification-only response normalization, not a production fix.

Each fresh verification run follows launch → checks → cleanup, so both startup normalizations are reapplied automatically at the next launch. The reload caveat applies only within an active run: `drive.sh` and `doctor.sh` reuse that instance rather than relaunching it. Use in-app navigation during checks. If Chrome is fully refreshed, Vite triggers a full-page reload, or the backend restarts, clean up and relaunch before continuing; reloads can restore duplicate bridges or offline startup behavior after interception detaches. Doctor checks for exactly one copy of each bridge script.

The state directory defaults to `${TMPDIR}/verify-marasi`. Launch refuses to reuse existing state or occupied ports `5173`, `34115`, and `18080`. Chrome chooses a free DevTools port. It does not use the normal `~/Library/Application Support/Marasi` directory. Configure alternate dev and fixed CDP ports with `MARASI_VERIFY_DEV_PORT` and `MARASI_VERIFY_CDP_PORT`. Vite is fixed to `5173` in this repo, so only one verification run can use the default checkout at a time.

Teardown only the instance recorded by the helper:

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

## Restart

To prove that a saved preference survives an app restart, restart the recorded instance instead of cleaning up:

```bash
.agents/skills/verify-marasi/scripts/restart.sh
```

Restart stops the recorded Chrome and Wails processes, keeps the isolated home (including `marasi_appconfig.yaml` and the scratch project), and relaunches with `MARASI_VERIFY_KEEP_CONFIG=1`, so launch reads the existing config instead of rewriting it. It creates a new evidence directory. Inspect the YAML before and after the restart. `cleanup.sh` still removes everything at the end.

## Doctor

Run this first whenever startup, automation, or a result looks wrong:

```bash
.agents/skills/verify-marasi/scripts/doctor.sh
```

It checks the Wails and Chrome PIDs, Wails HTTP endpoint, Chrome DevTools endpoint, injected Wails bridge, `1600x900` viewport, app rail DOM, proxy-port ownership, isolated config, and project database. It also fails while a modal, command palette, or drawer from an earlier drive is still open. Skeleton's modal wrapper uses `display: contents`, so doctor measures the wrapper's card instead. Doctor and drive attach to the Chrome page whose URL matches the Wails origin, not the first `type=page` target. Headless Chrome can also keep `chrome://settings/help` and omnibox pages around. A green doctor writes `doctor.txt` and prints the exact paths.

Launch sizes the headless window so the page itself is `1600x900`. Drives do not use a per-session viewport override: that override ends when each CDP session closes, and the page then relayouts at Chrome's smaller default (`1600x813`), which pushes the Settings rail item off screen.

When doctor reports a leftover overlay or drawer, dismiss it with real input (Escape, then a backdrop click) and re-run doctor:

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

Most in-app actions have that painted control plus a MarasiKeys binding. Global bindings (`⌘+key`, including `⌘K` for the menu) live in the action catalog, `frontend/src/lib/keybindings/catalog.js`, with handlers in `frontend/src/lib/components/MarasiMenu/GlobalMenu.svelte`; they work on every route. Page and drawer bindings (mostly `⌘+⇧+key` on macOS) are in the same catalog, keyed to a menu context in `frontend/src/lib/keybindings/contexts.js` (for example `ledger.drawer-closed` and `ledger.drawer-open`); their handlers stay in the route's component. Opening the Ledger or Armory request drawer swaps which actions keys reach and which entries the `⌘K` menu lists. Prove both paths with:

```bash
.agents/skills/verify-marasi/scripts/drive.sh dashboard compare "Open Project" "cmd+o"
```

The compare action requires the feature route to already be visible. It clicks the actionable label, waits for the overlay or route change, and then waits until that text stops changing for 500 ms before capturing. Overlays fill in after they paint; the Project modal shows `No recent projects` until `GetRecentProjects` resolves. It restores the starting page, then sends the shortcut through `Input.dispatchKeyEvent` (`MetaLeft` down, key, key up, `MetaLeft` up). It fails unless both paths paint the same overlay text or land on the same route. Pass or fail, it dismisses its overlay with Escape so the next drive is not blocked.

The dashboard `theme` action leaves Home for Settings, sends `Command+U` twice, and fails unless the global appearance changes and returns to its original mode. This proves the global shortcut still reads live state after Home is destroyed.

For behavioral actions beyond navigation, use a named sequence of real UI inputs:

```bash
.agents/skills/verify-marasi/scripts/drive.sh settings steps '{"name":"vim-toggle","steps":[{"text":"Vim Enabled"}]}'
```

`steps` requires the feature route to already be visible. Use one action per step.

| Step | Meaning |
| --- | --- |
| `{"click": "<css>"}` | Click the one actionable match. Add `"hasText"` to keep matches whose text contains it (for example `{"click":"tbody tr","hasText":"/probe"}`), `"within": "<css>"` to scope, `"nth": n` to pick among several on purpose, `"button": "right"` for a context menu. |
| `{"text": "<label>"}` | Click the one actionable button, link, switch, tab, label, or summary whose normalized text, `aria-label`, or `title` equals the label. Wrappers around a matching control collapse to the control. `within` and `nth` apply. |
| `{"key": "cmd+shift+r"}` | Shortcut, same syntax as compare. Also `escape`, `enter`, `tab`, `backspace`, `[`, `]`. A bare character without `cmd`, `ctrl`, or `alt` (for example `{"key":"l"}`) types itself, so a focused `<select>` jumps to the first option that starts with it. |
| `{"insert": "<text>"}` | Waits for a focused input or editor, inserts, then waits until the text is in that field. |
| `{"waitText": "…"}`, `{"waitNoText": "…"}` | Visible `innerText` contains or lacks the text. Add `within` to read only matching roots, so text the editor already holds cannot satisfy the wait. |
| `{"waitEnabledText": "<label>"}` | The labelled control is actionable and enabled. |
| `{"waitSelector": "<css>"}`, `{"waitNoSelector": "<css>"}` | A visible match appears or none is left. |
| `{"waitPath": "/route"}` | The route changed, for example after a toast's jump action. |

Any step accepts `"timeoutMs"` (1–60000, default 10000). There is no sleep step: wait for the state the next action depends on. Input goes through CDP mouse and keyboard events, never store or backend calls.

To replace text, click the editor or input, send `cmd+a`, then `insert`. This works in CodeMirror with Vim enabled, because `Input.insertText` bypasses Vim's keymap. The route's input-focus filter drops shortcuts while an `INPUT`, `SELECT`, or `TEXTAREA` has focus, so click a non-input control (a CodeMirror editor is fine) before a shortcut.

Wait for specific resulting content: the unique marker you inserted, a count, or a toast. An existing label or text still in the editor is not a result. Inspect screenshots and persisted side effects even when the sequence passes. A sequence is an input driver, not an automatic proof of the feature's full behavior. End each sequence with its modal or drawer closed. Doctor runs before every drive and refuses residue. After a failure, run `reset.sh`, or clean up and relaunch.

The shipped CDP helper uses Node's built-in `WebSocket`, so it adds no npm package. Chrome defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; override `MARASI_VERIFY_CHROME_BIN` when needed.

## Evidence

Each launch creates `.artifacts/verify-marasi/<UTC timestamp>/`. Keep these files as the proof:

- `launch.txt` records the build, PID, isolated home, and selected port.
- `app.log` records backend startup and proxy messages.
- `launch-ready.json` and `launch-ready.png` capture the first ready dashboard.
- `launch-bridge.json`, `launch-root-original.html`, and `launch-root-normalized.html` record the startup-only bridge deduplication. `launch-listener-startup.json` and `launch-layout-{original,normalized}.js` record the listener-startup fallback; `launch-console.json` records whether it ran, and `launch-network.json` records browser startup, including IPC connections.
- `<feature>-before.json` and `<feature>-before.png` capture the state before navigation.
- `<feature>-action.txt` records the exact user input.
- `<feature>-after.json` and `<feature>-after.png` capture the resulting DOM and screen.
- `<label>-click-*` and `<label>-shortcut-*` capture a painted-control compare; `<label>-compare.json` is the pass/fail record.
- `theme-before.*`, `theme-toggled.*`, `theme-restored.*`, and `theme-result.json` prove the global appearance shortcut works after leaving Home.
- `<feature>-<recipe>-action.json`, `-before.*`, `-step-<n>.*`, `-after.*`, `-console.json`, and `-network.json` record a UI-step sequence, including the resulting state on an action failure. `-steps.json` records each step's click point, duration, and failure reason. Use a distinct recipe name for each attempt so earlier evidence is not overwritten.
- `<feature>-console.json` and `<feature>-network.json` record browser events during the action.
- `doctor.txt` proves the process, listener, config, and SQLite project existed.

Exercise the real user path rather than calling Wails methods, editing stores, or using a test-only endpoint. Capture both the action and resulting state. For proxy traffic, report export, project edits, or settings changes, also inspect the isolated files or SQLite rows and add that output to the same evidence directory. Use mocks only at an existing production boundary. If a safe path claims to be a dry run, inspect files, network connections, and project rows to establish what it skipped.

Browser screenshots do not need macOS Screen Recording permission. The driver fixes the viewport at `1600x900`, matching the Wails window configured in `main.go`, and records the dimensions in each JSON capture. Inspect `app.log` for Go and Wails output. Use Chrome DevTools against the recorded CDP endpoint when an interactive console or network inspector is useful. The repo ignores `.artifacts`, so proof files do not appear in `git status`.

With Wails v2.10.1, browser-connected startup currently writes `runtime:ready -> Unknown message from front end: runtime:ready` to `app.log`. Headless Chrome on macOS may also log `CVDisplayLinkCreateWithCGDisplay failed`. Treat these known messages as tool noise only when doctor passes and the expected DOM, screenshot, and side effect all agree. Record and investigate other errors.

## Cleanup

Run:

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

Cleanup sends `TERM` only to the recorded Chrome and Wails PIDs, waits for Wails, and uses `KILL` only if that same Wails PID does not exit. It removes the scratch home and state files. It leaves `.artifacts/verify-marasi/` untouched. Run cleanup after failed attempts too.

Run one verification instance at a time. This repo fixes Vite to port `5173`, so separate state directories or checkouts do not make parallel runs safe without a source change.

## Helpers

All scripts under `scripts/` are executable and derive the repository root from their own path. Their supported invocations are shown above. `launch.sh`, `doctor.sh`, `reset.sh`, and `drive.sh` call `cdp.mjs`, which resolves targets through `targets.mjs` (`node --test scripts/*.test.mjs` covers the selection rules); call the shell helpers rather than reverse-engineering the CDP protocol. Shortcut compares go through `drive.sh <feature> compare`, not a one-off CDP script.

Read `features/README.md` before choosing proof coverage. A check of one easy route does not cover the other mapped entry points.
