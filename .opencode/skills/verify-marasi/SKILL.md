---
name: verify-marasi
description: Verify the Marasi Wails desktop app through its browser-connected dev server; use after changing user-visible behavior, proxy startup, navigation, or persisted project data.
---

# Verify Marasi

Marasi is a Wails desktop app backed by a local proxy and SQLite project. The Vite page on port `5173` cannot call the Go backend directly. Wails' dev server on port `34115` proxies Vite, injects the runtime, and connects browser calls to the running Go app through `/wails/ipc`.

## Launch

Run from the repository root on macOS:

```bash
.opencode/skills/verify-marasi/scripts/launch.sh
```

The helper runs `wails dev -m -nosyncgomod -nocolour -devserver localhost:34115`, creates an isolated home directory, and writes verification-only config with `first_run: false`. It starts an isolated headless Chrome against the Wails dev server with the app's `1600x900` window size. It defaults to proxy port `18080`; set `MARASI_VERIFY_PROXY_PORT` before launch to choose another free port. It returns after browser JavaScript sees the scratchpad dashboard through the real Go bindings.

The state directory defaults to `${TMPDIR}/verify-marasi`. Launch refuses to reuse existing state or occupied ports `5173`, `34115`, and `18080`. Chrome chooses a free DevTools port. It does not use the normal `~/Library/Application Support/Marasi` directory. Configure alternate dev and fixed CDP ports with `MARASI_VERIFY_DEV_PORT` and `MARASI_VERIFY_CDP_PORT`. Vite is fixed to `5173` in this repo, so only one verification run can use the default checkout at a time.

Teardown only the instance recorded by the helper:

```bash
.opencode/skills/verify-marasi/scripts/cleanup.sh
```

## Doctor

Run this first whenever startup, automation, or a result looks wrong:

```bash
.opencode/skills/verify-marasi/scripts/doctor.sh
```

It checks the Wails and Chrome PIDs, Wails HTTP endpoint, Chrome DevTools endpoint, injected Wails bridge, `1600x900` viewport, app rail DOM, proxy-port ownership, isolated config, and project database. A green doctor writes `doctor.txt` and prints the exact paths.

## Drive

Use the executable driver with one mapped route:

```bash
.opencode/skills/verify-marasi/scripts/drive.sh dashboard
.opencode/skills/verify-marasi/scripts/drive.sh ledger
.opencode/skills/verify-marasi/scripts/drive.sh compass
.opencode/skills/verify-marasi/scripts/drive.sh checkpoint
.opencode/skills/verify-marasi/scripts/drive.sh launchpad
.opencode/skills/verify-marasi/scripts/drive.sh armory
.opencode/skills/verify-marasi/scripts/drive.sh logbook
.opencode/skills/verify-marasi/scripts/drive.sh workshop
.opencode/skills/verify-marasi/scripts/drive.sh settings
```

The driver connects to the isolated Chrome DevTools endpoint, sends a real mouse press to a painted control, and fails unless the expected route or overlay appears. A painted control has a bounding box wider and taller than 10px and is not inside `dialog`. Hidden MarasiKeys menu nodes reuse the same labels at `0,0`; matching innerText alone is not a click.

Most in-app actions have that painted control plus a MarasiKeys binding. Root bindings live in `frontend/src/routes/+page.svelte` as `⌘+key`. Page bindings live in that route's MarasiKeys menu as `⌘+⇧+key` on macOS. Prove both paths with:

```bash
.opencode/skills/verify-marasi/scripts/drive.sh dashboard compare "Open Project" "cmd+o"
```

The compare action clicks the painted label, captures the overlay or route change, restores the starting page, then sends the shortcut through `Input.dispatchKeyEvent` (`MetaLeft` down, key, key up, `MetaLeft` up). It fails unless both paths paint the same overlay text or land on the same route.

The shipped CDP helper uses Node's built-in `WebSocket`, so it adds no npm package. Chrome defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; override `MARASI_VERIFY_CHROME_BIN` when needed.

## Evidence

Each launch creates `.artifacts/verify-marasi/<UTC timestamp>/`. Keep these files as the proof:

- `launch.txt` records the build, PID, isolated home, and selected port.
- `app.log` records backend startup and proxy messages.
- `launch-ready.json` and `launch-ready.png` capture the first ready dashboard.
- `<feature>-before.json` and `<feature>-before.png` capture the state before navigation.
- `<feature>-action.txt` records the exact user input.
- `<feature>-after.json` and `<feature>-after.png` capture the resulting DOM and screen.
- `<label>-click-*` and `<label>-shortcut-*` capture a painted-control compare; `<label>-compare.json` is the pass/fail record.
- `<feature>-console.json` and `<feature>-network.json` record browser events during the action.
- `doctor.txt` proves the process, listener, config, and SQLite project existed.

Exercise the real user path rather than calling Wails methods, editing stores, or using a test-only endpoint. Capture both the action and resulting state. For proxy traffic, report export, project edits, or settings changes, also inspect the isolated files or SQLite rows and add that output to the same evidence directory. Use mocks only at an existing production boundary. If a safe path claims to be a dry run, inspect files, network connections, and project rows to establish what it skipped.

Browser screenshots do not need macOS Screen Recording permission. The driver fixes the viewport at `1600x900`, matching the Wails window configured in `main.go`, and records the dimensions in each JSON capture. Inspect `app.log` for Go and Wails output. Use Chrome DevTools against the recorded CDP endpoint when an interactive console or network inspector is useful. The repo ignores `.artifacts`, so proof files do not appear in `git status`.

With Wails v2.10.1, browser-connected startup currently writes `runtime:ready -> Unknown message from front end: runtime:ready` to `app.log`. Headless Chrome on macOS may also log `CVDisplayLinkCreateWithCGDisplay failed`. Treat these known messages as tool noise only when doctor passes and the expected DOM, screenshot, and side effect all agree. Record and investigate other errors.

## Cleanup

Run:

```bash
.opencode/skills/verify-marasi/scripts/cleanup.sh
```

Cleanup sends `TERM` only to the recorded Chrome and Wails PIDs, waits for Wails, and uses `KILL` only if that same Wails PID does not exit. It removes the scratch home and state files. It leaves `.artifacts/verify-marasi/` untouched. Run cleanup after failed attempts too.

Run one verification instance at a time. This repo fixes Vite to port `5173`, so separate state directories or checkouts do not make parallel runs safe without a source change.

## Helpers

All scripts under `scripts/` are executable and derive the repository root from their own path. Their supported invocations are shown above. `launch.sh`, `doctor.sh`, and `drive.sh` call `cdp.mjs`; call the shell helpers rather than reverse-engineering the CDP protocol. Shortcut compares go through `drive.sh <feature> compare`, not a one-off CDP script.

Read `features/README.md` before choosing proof coverage. A check of one easy route does not cover the other mapped entry points.
