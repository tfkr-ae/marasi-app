## Running and testing v2

v2 is an Electron app with no Go code. A fresh worktree runs `scripts/bootstrap.sh` first, to install the root and `frontend/` packages.

- `npm test`: the main process tests (`electron/`) and the frontend's `node --test` store tests.
- `npm run dev`: Vite and Electron on it. Pass Electron flags after `--`, for example `npm run dev -- --remote-debugging-port=9222`.
- `npm run dist`, `dist:mac`, `dist:win`, `dist:linux`: an unsigned package in `dist/`.

Frontend code calls the v1 bindings through `frontend/src/lib/bindings/App.js`. A binding that isn't ported yet rejects with a `NotPorted` error. A ported binding calls the connected instance through the Marasi client module, `marasi` in `frontend/src/lib/bindings/marasi.js`. A coded refusal rejects with an error that the `errorCodes.js` helpers read, and a route the instance doesn't have rejects with "Needs a newer Marasi".

- `MARASI_CONFIG_DIR`, or the Electron flag `--config-dir=DIR` (with `=`), points the app at another Marasi config directory, such as a throwaway one for a test instance. The default is the directory Marasi itself uses, which holds the real `marasi_appconfig.yaml` v1 shares, so tests and verification always use a temp dir.
- `MARASI_BIN` names the Marasi binary for the integration suite (`electron/connect.integration.test.js`). Without it the suite uses `resources/bin/marasi`, and it is skipped when neither exists.

Electron runs as plain Node when `ELECTRON_RUN_AS_NODE` is set, as it is in some agent terminals. `npm run dev` clears it; unset it yourself to run a packaged app.

## Code maps

Maps live in `docs/agents/maps/`. Read the map there before you change or ask about:

- `ledger.md`: the Ledger page, its row menu, drawer, bulk changes, sitemap or live traffic.
- `launchpad.md`: the Launchpad page, its entry menu, launches and their pending state, or unsaved drafts.
- `logbook.md`: the Logbook page, its outline, filters, record view, inline fixes, the finding and test case modal and its edit session, or report export.
- `checkpoint.md`: the Checkpoint page, its held items, edits, bulk Forward and Drop, the rail badge, or the interception rules.
- `keybindings-and-menus.md`: a shortcut, a ⌘K menu item, the action catalog, menu contexts, or keybinding profiles.
- `project-open.md`: startup, the scratchpad, opening or switching a project, or the opening screen.
- `updates.md`: checking for, installing or relaunching into an update, channels, signing, or the release workflows.
- `ui.md`: which component draws a screen, the app rail, the Marasi menu, a modal or an editor, or which text size to use.
- `marasi-service.md`: Wails bindings, events between Go and the frontend, coded errors, app or per-project settings, or the Marasi library and its source.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
