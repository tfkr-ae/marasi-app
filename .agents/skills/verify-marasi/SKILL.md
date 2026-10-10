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

Chrome still starts on Home so its menus and global hotkeys initialize. During that first navigation, the driver intercepts the root HTML response and removes duplicate Wails bridge script tags; Wails v2.10.1 injects them alongside the explicit tags in `app.html`. The real backend and runtime scripts remain unchanged, and the native GUI still runs. Chrome needs the `loopback-network` DevTools permission, granted only to the Wails origin in the isolated profile, because response interception loses the document's loopback classification.

The driver also intercepts Chrome's compiled layout module during startup. Both the native GUI and Chrome bootstrap the listener; the second `StartProxy` rejects with `listener already active`, which otherwise makes Chrome's UI offline despite a running proxy. Only that startup rejection falls back to the real `UpdateProxy` with the configured address and port. Other failures retain the application's error path, and interactive listener controls remain unchanged. Launch requires the Home listener indicator to be online. Application source files are untouched; this is verification-only response normalization, not a production fix.

Each fresh verification run follows launch → checks → cleanup, so both startup normalizations are reapplied automatically at the next launch. The reload caveat applies only within an active run: `drive.sh` and `doctor.sh` reuse that instance rather than relaunching it. Use in-app navigation during checks. If Chrome is fully refreshed, Vite triggers a full-page reload, or the backend restarts, clean up and relaunch before continuing; reloads can restore duplicate bridges or offline startup behavior after interception detaches. Doctor checks for exactly one copy of each bridge script.

The state directory defaults to `${TMPDIR}/verify-marasi`. Launch refuses to reuse existing state or occupied ports `5173`, `34115`, and `18080`. Chrome chooses a free DevTools port. It does not use the normal `~/Library/Application Support/Marasi` directory. Configure alternate dev and fixed CDP ports with `MARASI_VERIFY_DEV_PORT` and `MARASI_VERIFY_CDP_PORT`. Vite is fixed to `5173` in this repo, so only one verification run can use the default checkout at a time.

Teardown only the instance recorded by the helper:

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

## Doctor

Run this first whenever startup, automation, or a result looks wrong:

```bash
.agents/skills/verify-marasi/scripts/doctor.sh
```

It checks the Wails and Chrome PIDs, Wails HTTP endpoint, Chrome DevTools endpoint, injected Wails bridge, `1600x900` viewport, app rail DOM, proxy-port ownership, isolated config, and project database. Doctor and drive attach to the Chrome page whose URL matches the Wails origin, not the first `type=page` target. Headless Chrome can also keep `chrome://settings/help` and omnibox pages around. A green doctor writes `doctor.txt` and prints the exact paths.

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

The driver connects to the isolated Chrome DevTools endpoint, sends a real mouse press to a painted control, and fails unless the expected route or overlay appears. A painted control has a bounding box wider and taller than 10px and is not inside `dialog`. Hidden MarasiKeys menu nodes reuse the same labels at `0,0`; matching innerText alone is not a click.

All driver paths pause 500 ms after each completed click, keyboard shortcut (including Escape), or text insertion before continuing. Readiness checks still wait for the expected UI state; explicit `waitMs` steps add their requested delay.

Most in-app actions have that painted control plus a MarasiKeys binding. Root bindings live in `frontend/src/routes/+page.svelte` as `⌘+key`. Page bindings live in that route's MarasiKeys menu as `⌘+⇧+key` on macOS. Prove both paths with:

```bash
.agents/skills/verify-marasi/scripts/drive.sh dashboard compare "Open Project" "cmd+o"
```

The compare action requires the feature route to already be visible. It clicks the painted label, captures the overlay or route change, restores the starting page, then sends the shortcut through `Input.dispatchKeyEvent` (`MetaLeft` down, key, key up, `MetaLeft` up). It fails unless both paths paint the same overlay text or land on the same route. After a pass it dismisses a leftover overlay with Escape so the next drive is not blocked.

The dashboard `theme` action leaves Home for Settings, sends `Command+U` twice, and fails unless the global appearance changes and returns to its original mode. This proves the dashboard-owned shortcut still reads live state after Home is destroyed.

For behavioral actions beyond navigation, use a named sequence of real UI inputs:

```bash
.agents/skills/verify-marasi/scripts/drive.sh settings steps '{"name":"vim-toggle","steps":[{"text":"Vim Enabled"}]}'
```

`steps` requires the feature route to already be visible. Use one action per step: `click` (CSS selector), `text` (exact painted button/link/label text), `key` (the same shortcut syntax as compare, including `escape` and `enter`), `insert` (text into the focused input/editor), `waitText`, `waitNoText`, `waitEnabledText` (painted, enabled button with exact text), or `waitMs` (1–10000 milliseconds). Clicks scroll the target into view; input goes through CDP mouse/keyboard events, not store or backend calls. To replace text, click the editor/input, send `cmd+a`, then `insert`. Disable Vim through Settings before replacing CodeMirror text this way, and restore the setting afterward. Click a non-editor control before a shortcut when the route's input-focus filter blocks it.

Wait for specific resulting content, not an existing label or text still in the editor; for debounced queries, allow the debounce to settle before checking results. Inspect screenshots and persisted side effects even when the sequence passes. A sequence is an input driver, not an automatic proof of the feature's full behavior. After a failure, run doctor and dismiss any leftover overlay or reset/relaunch a wedged page before another drive.

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
- `<feature>-<recipe>-action.json`, `-before.*`, `-step-<n>.*`, `-after.*`, `-console.json`, and `-network.json` record a UI-step sequence, including the resulting state on an action failure. Use a distinct recipe name for each attempt so earlier evidence is not overwritten.
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

All scripts under `scripts/` are executable and derive the repository root from their own path. Their supported invocations are shown above. `launch.sh`, `doctor.sh`, and `drive.sh` call `cdp.mjs`; call the shell helpers rather than reverse-engineering the CDP protocol. Shortcut compares go through `drive.sh <feature> compare`, not a one-off CDP script.

Read `features/README.md` before choosing proof coverage. A check of one easy route does not cover the other mapped entry points.
