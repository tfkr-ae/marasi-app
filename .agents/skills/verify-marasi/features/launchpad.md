# Request replay

## Sub-features

- Launchpad dock: drag to resize, snap-collapse to a strip, auto-hide while editing
- Launchpad file tree: Launchpad entries in entry order, numbered by position and windowed to the last 10, Group by status, Expand all / Collapse all, the floating `End of …` button
- Entry selection (click, ⌘-click, ⇧-click, ⌘A, Esc), drag to reorder or move entries to another launchpad, the entry context menu (Move to launchpad, Order, Copy browser view URL, Finding, Test case, Remove from launchpad) and ⌘⇧↑/⌘⇧↓/⌘↑/⌘↓ moves
- Findings and test cases from entries: the entry menu's and the launchpad menu's `Finding ›`/`Test case ›` (new, link, unlink) and the tree's `⌘⇧F`/`⌘⇧B`, which open the Logbook record modal with the entries' requests
- Moves and deletes refused while a launch is pending, a pair is already in the target, or the tree is grouped or searching; the Launchpad draft follows its entry when it moves
- Search (names locally; entry heads and bodies through Marasi), create empty launchpad, rename and description
- Launchpad context menu (right-click a launchpad row): Finding, Test case, `Rename…`, `Delete launchpad`
- Per-launchpad entry count and last status from Marasi's launchpad summary, updated live by launches
- Launchpad draft editor, HTTPS toggle, Launch, response display, unsaved-draft prompts
- Tracked launches (marasi `docs/adr/2026-10-13-launches-are-tracked-and-cancellable.md`): pending state, Cancel, and each entry's outcome (completed, cancelled, failed with a reason)
- Compare two entries: A/B picking, quick picks, read-only CodeMirror MergeView with Request/Response tabs, chip re-pick, swap, Esc

## Parts

Read `getting-there.md` for every Launchpad change: it names the entry points a proof has to cover. Then read only the parts your change touches. Read `gotchas.md` too before a first run, or when a recipe fails for no clear reason.

| Part | Read it for |
| --- | --- |
| [getting-there.md](launchpad/getting-there.md) | The route and `⌘5`, launchpad rows, the catalog shortcuts, `⌘J`, seeding a launchpad without the Ledger |
| [send-launch-compare.md](launchpad/send-launch-compare.md) | Sending from the Ledger, editing and launching, tracked launches and Cancel, Compare, search, the tree, `End of …`, the dock |
| [selection-and-drag.md](launchpad/selection-and-drag.md) | Seeding several launchpads, entry selection, drag to reorder or move, refused drops while a launch is pending |
| [menus.md](launchpad/menus.md) | The entry menu, findings and test cases, the launchpad menu (rename, delete), browser view URL, Move and Order, the draft following its entry |
| [gotchas.md](launchpad/gotchas.md) | Long strings, drafts and prompts, waits and scoping, listener and HTTPS, sticky rows, theme captures |
