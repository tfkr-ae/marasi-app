## Go commands

Run Go commands as `GOWORK=off go …`. Agent worktrees can sit inside a checkout whose parent `go.work` excludes this module, and `go` then fails with "main module … does not contain package". A fresh worktree runs `scripts/bootstrap.sh` first, to create `frontend/build` and `frontend/node_modules`, install `wails3` at the version `go.mod` pins, and generate the Wails v3 bindings in `frontend/src/lib/bindings`.

## Checks

Run `scripts/check.sh` before you commit; CI runs the same script. It runs `go vet`, the Go tests, `npm test` and `npm run check` (svelte-check, errors only).

## Building the app

The app runs on Wails v3, built through its Taskfile scaffold (`Taskfile.yml` and `build/`); there is no `wails.json`. `wails3 build` builds `bin/marasi-app`, and on macOS `wails3 package` builds `bin/marasi-app.app`. Set `CHANNEL`, `VERSION` and `SIGNING_PUBLIC_KEY` in the environment for a release build; without them it is a development build. Pass extra build tags with `wails3 build -tags a,b`. Don't run `wails3 update build-assets`: it overwrites the hand-kept `build/darwin/Info.plist` and the Windows assets.

## Code maps

Maps live in `docs/agents/maps/`. Read the map there before you change or ask about:

- `ledger.md`: the Ledger page, its row menu, drawer, bulk changes, sitemap or live traffic.
- `launchpad.md`: the Launchpad page, its entry menu, launches and their pending state, or unsaved drafts.
- `logbook.md`: the Logbook page, its outline, filters, record view, inline fixes, the finding and test case modal and its edit session, or report export.
- `checkpoint.md`: the Checkpoint page, its held items, edits, bulk Forward and Drop, the rail badge, or the interception rules.
- `keybindings-and-menus.md`: a shortcut, a ⌘K menu item, the action catalog, menu contexts, or keybinding profiles.
- `project-open.md`: startup, the scratchpad, opening or switching a project, or the opening screen.
- `updates.md`: checking for, installing or relaunching into an update, channels, signing, or the release workflows.
- `ui.md`: which component draws a screen, the app rail, the Marasi menu, a modal or an editor, which text size to use, or the mobile (iOS and Android) layout.
- `marasi-service.md`: the service client, the connection store, the Go shell and its Wails bindings, events, coded errors, app or per-project settings, or the Marasi CLI, the local instance and Marasi's source.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
