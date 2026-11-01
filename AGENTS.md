## Go commands

Run Go commands as `GOWORK=off go …`. Agent worktrees can sit inside a checkout whose parent `go.work` excludes this module, and `go` then fails with "main module … does not contain package". A fresh worktree runs `scripts/bootstrap.sh` first, to create `frontend/build`, `frontend/node_modules` and the Wails bindings.

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
