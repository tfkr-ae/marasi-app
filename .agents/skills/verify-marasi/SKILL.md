---
name: verify-marasi
description: Verify Marasi App v2 by driving its frontend in headless Chrome against a real throwaway Marasi instance, and Electron for windows, menus and the updater; use after changing user-visible behavior, connecting, or anything a page shows from the instance.
---

# Verify Marasi

Marasi App v2 is an Electron client of a Marasi service instance's control API. Verification drives the same Svelte frontend in a plain headless Chrome, through the Vite dev server. The dev server stands in for Electron's main process (`frontend/devBridge.js`): it lists and connects to the instances in `MARASI_CONFIG_DIR`, serves the app config there, and proxies the page's calls and `/events` to the connected instance with its control token. The page never holds the token, as in Electron. Only Start, OS dialogs (Choose…, Browse…, file save), keybinding profile files, windows, native menus and the updater need Electron (see [Electron](#electron)).

## Launch

From the repository root (a fresh worktree runs `scripts/bootstrap.sh` first, which also builds the bundled Marasi):

```bash
.agents/skills/verify-marasi/scripts/launch.sh
```

Launch:

1. Starts instance `default` in a new config directory `/tmp/mv2.XXXXXX`, with free proxy and control ports, using `resources/bin/marasi` (`npm run marasi` builds it) or `MARASI_BIN`. It seeds `marasi_appconfig.yaml` with `first_run: false`.
2. Starts Vite with `MARASI_CONFIG_DIR` set to that directory and `MARASI_DEV_PORT` set to the first free port from `5190` (or `MARASI_VERIFY_DEV_PORT`).
3. Starts an isolated headless Chrome (`MARASI_VERIFY_CHROME_BIN` to override) with a free DevTools port, and sizes the page to `1600x900`.
4. Opens the app. A fresh dev server has no connection, so the page shows the connection screen. Launch clicks `Connect to default` and is ready when Home shows `Project Dashboard`.

It never touches the researcher's own Marasi config directory or instances: without `MARASI_CONFIG_DIR` the bridge refuses to reach any. State lives in `${TMPDIR}/verify-marasi` (`MARASI_VERIFY_STATE_DIR`), and launch refuses to run while that state exists. One dev server holds one connection, shared by every tab on it, so run one verification per state directory.

## Doctor

Run this first whenever a launch, a drive or a result looks wrong:

```bash
.agents/skills/verify-marasi/scripts/doctor.sh
```

It is read-only. It checks that the instance answers `running` on its socket, that the recorded Vite PID owns the dev port, that the bridge is connected to `default` and calls reach it, that Chrome's DevTools answer, and that the page is connected (app rail, no connection screen) at `1600x900` with no modal, menu or drawer left open. A green doctor writes `doctor.txt`.

When doctor reports a leftover overlay, or a window left on the connection screen, run:

```bash
.agents/skills/verify-marasi/scripts/reset.sh
```

It dismisses overlays with Escape (and a backdrop click or `Discard` when needed), connects again with `Connect to default`, then requires a green doctor. If reset fails, run cleanup and launch again.

## Drive

```bash
.agents/skills/verify-marasi/scripts/drive.sh home
.agents/skills/verify-marasi/scripts/drive.sh connection
.agents/skills/verify-marasi/scripts/drive.sh home shots
.agents/skills/verify-marasi/scripts/drive.sh connection shots
.agents/skills/verify-marasi/scripts/drive.sh home theme
.agents/skills/verify-marasi/scripts/drive.sh <feature> compare "<visible label>" "<shortcut>"
.agents/skills/verify-marasi/scripts/drive.sh <feature> steps '<json>'
```

Features: `home`, `connection`, `ledger`, `compass`, `checkpoint`, `launchpad`, `armory`, `logbook`, `workshop` and `settings`. Each drive runs doctor first, sends real mouse and keyboard input through the Chrome DevTools Protocol, and fails unless the destination paints its own text. `connection` disconnects with `⌘⇧⌫` (the page reloads onto the connection screen), captures it, and connects again with `Connect to default`, so every drive ends on Home.

`shots` captures `<feature>-light.png` and `<feature>-dark.png` and records them in `<feature>-shots.json`. Prove every UI change in both. A connected page switches with `⌘U` and goes back to its starting appearance. The connection screen has no shortcuts, and its reload takes the OS appearance (the layout's `autoModeWatcher`), so it is shot under an emulated OS `prefers-color-scheme` that ends with the drive.

Read [`driving.md`](driving.md) before you write a `steps` recipe or a `compare`. It covers target rules, every step type, and the shortcuts Chrome keeps for itself. Read [`features/README.md`](features/README.md) before you choose proof coverage: a feature is proven through every entry point its file lists.

## Restart

```bash
.agents/skills/verify-marasi/scripts/restart.sh
```

Restart stops Chrome and Vite and starts them again on the same instance, keeping the Chrome profile, then connects through the connection screen again. Use it to prove that something survives a fresh page load. The instance, its project and the app config stay. Evidence goes to a new directory.

## Electron

Use Electron only for what the browser lacks: windows, native menus and the updater (and Start or OS dialogs, when those are under test).

```bash
.agents/skills/verify-marasi/scripts/electron.sh start
.agents/skills/verify-marasi/scripts/electron.sh stop
```

`start` runs `npm run dev` with `--remote-debugging-port` and `--config-dir` set to the recorded config directory, on its own dev port. It prints the window's `cdp` and `app_url`, waits for Home (the window connects to the recorded `default` at launch, as the app does), and captures `electron-ready.png`. Drive the window with the same driver, passing those two values:

```bash
node .agents/skills/verify-marasi/scripts/cdp.mjs drive <cdp-port> <app_url> "$(cat "$TMPDIR/verify-marasi/evidence-dir")" 1600 900 home steps '<json>'
```

`doctor.sh`, `drive.sh` and `shots` act on the Chrome page only. Native menus and OS dialogs are outside the page, so DevTools can't see them; prove those with their effect in the page or in the files. `stop` quits Electron, which stops its dev server; the instance keeps running.

## Evidence

Each launch creates `.artifacts/verify-marasi/<UTC timestamp>/` (git ignores `.artifacts`). Keep it as the proof:

- `launch.txt`: the Marasi binary, config directory, proxy and control listeners, dev server, PIDs and DevTools port. `instance-status.json` is the instance's `service status`.
- `launch-connection.*`, `launch-action.txt` and `launch-ready.*`: the connection screen, the Connect click, and Home. `launch-console.json` and `launch-network.json` record the page's console and requests: every Marasi call goes to `/__marasi/…` on the dev server, none carries an `Authorization` header, and none goes to the instance directly.
- `vite.log`, `chrome.log`, `marasi-start.log`, and `electron.log` with `electron-ready.*`.
- `<feature>-before.*`, `-action.txt` and `-after.*` for a route drive; `connection-left.*` after reconnecting.
- `<feature>-light.*`, `<feature>-dark.*` and `<feature>-shots.json` for shots.
- `theme-*` and `theme-result.json`; `<label>-click-*`, `<label>-shortcut-*` and `<label>-compare.json`; `<feature>-<recipe>-action.json`, `-step-<n>.*`, `-steps.json`, `-after.*`, `-console.json` and `-network.json` for steps. Use a distinct recipe name for each attempt.
- `doctor.txt`.

Proof standards:

- Exercise the real user path: clicks and keys on the page, never store, binding or `/__marasi` calls made by hand.
- Capture the action and the resulting state.
- Check side effects at their source: the instance through the CLI (`resources/bin/marasi --config-dir <config_dir> --json …`, for example `traffic`, `launchpad`, `service status`), and the app config in `<config_dir>/marasi_appconfig.yaml`. Add that output to the evidence directory.
- Send proxy traffic through the `proxy_listener` in `launch.txt`.
- A `Not ported yet` toast is a binding no ticket has ported (`docs/v2-parity.md`), not a verification fault. Record any other console error and look into it.

## Cleanup

```bash
.agents/skills/verify-marasi/scripts/cleanup.sh
```

Cleanup stops only what launch and `electron.sh` started: the recorded Electron, Chrome and Vite PIDs (TERM, then KILL after 10 s), and the instance in the recorded `/tmp/mv2.*` directory (`service stop`). It then removes that directory and the state directory. It keeps `.artifacts/verify-marasi/`. Run it after failed attempts too.

## Helpers

Every script under `scripts/` is executable, derives the repository root from its own path, and is invoked as shown above. `common.sh` holds the shared state and process helpers. `cdp.mjs` is the driver (modes `launch`, `electron`, `doctor`, `reset`, `drive`), and `targets.mjs` selects its targets (`node --test .agents/skills/verify-marasi/scripts/*.test.mjs`). `bench-seed.sh [N]` fills the project with N requests through the proxy, using `bench-server.py` as the upstream. The v1 Ledger benchmark called Wails bindings; the Ledger's port brings it back (see `features/ledger.md`).
