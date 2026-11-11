# Traffic ledger

## Sub-features

- HTTP request/response rows, and WebSocket upgrade rows whose badges column shows the upgrade state
- The WebSocket modal opened from an upgrade: Stream, Checkpoint, Inject, and Connection tabs
- Indexed query search, content-type exclusions, and loading older query pages on scroll
- Request detail in the drawer, notes, highlights, and handoff to Launchpad, Armory, or Logbook

## Parts

Read `getting-there.md` for every Ledger change: it names the entry points a proof has to cover. Then read only the parts your change touches. Read `gotchas.md` too when a recipe uses the toolbar or fails for no clear reason.

| Part | Read it for |
| --- | --- |
| [getting-there.md](ledger/getting-there.md) | The route and `⌘2`, the toolbar, querying and its notices, the sitemap dock, the catalog shortcuts |
| [capture-and-query.md](ledger/capture-and-query.md) | Route proof, capture proof through the proxy, the search recipe, the query box and its autocomplete |
| [drawer.md](ledger/drawer.md) | Handoff from a row, the drawer and its rail, long strings, notes, a refused ⌘A change |
| [selection-and-row-menu.md](ledger/selection-and-row-menu.md) | Click, drag, ⌘/⇧ selection, ⌘A, the row menu and its submenus, highlights, bulk changes, browser view URL, shortcuts with a selection |
| [websocket.md](ledger/websocket.md) | Upgrade states and icons, the WebSocket modal: Stream, flags, Inject, Connection |
| [performance.md](ledger/performance.md) | The performance budget and `bench-seed.sh`/`bench-ledger.sh` |
| [gotchas.md](ledger/gotchas.md) | The Types, Saved queries, Marks and Highlights menus, exclusions, live-view batching, sitemap, delete and prompt quirks, reconnect |
