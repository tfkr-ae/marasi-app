# Ledger

Which files work together on the Ledger page, and how a row-menu action, a shortcut or a bulk change travels from the menu to Marasi. Names are functions and files, so search for them. For anything inside one function, read the function.

## Files

- `frontend/src/routes/ledger/+page.svelte` lays out the page and wires the parts together: the sitemap dock, the table, the drawer and the status bar. In `frontend/src/lib/ledger/`, `LedgerToolbar.svelte` is the toolbar and query box, `LedgerRowMenu.svelte` opens the row menu and runs shortcuts (`runShortcut`), `ledgerActions.js` holds the row-menu actions with their toasts and confirmations (`runMenuAction`), and `ledgerMenus.js` holds the ⌘K menu arrays for `useMenuActions` and `drawerHandlers`.
- `frontend/src/stores/createLedgerStore.js` holds the Ledger store's core and lists its public API. It takes its API as an argument. Each area's logic is in `frontend/src/stores/ledger/`: `state.js` (state shape, row helpers), `selectors.js` (labels, `selectionTarget`), `window.js` (pages, the window, counts, new matches), `live.js` (traffic events, `flush`, stream patches), `query.js` (query box, sort), `exclusion.js` (`populate`, `resync`, the exclusion), `selection.js`, `navigation.js` (steps and jumps), and `bulk.js` (notes, highlights, bulk actions). `frontend/src/stores/ledgerStore.js` binds it to the service client: `ledgerApi.js` maps the store's API names to service calls, and `trafficApi.js` maps traffic reads, rows and `traffic.*` events.
- `frontend/src/lib/ledger/` holds the components and pure helpers. `rowMenu.js` describes the row menu as data, `RowMenu.svelte` draws it (the Launchpad reuses it), and `LedgerDrawer.svelte` and `DrawerRail.svelte` make up the drawer.
- The sitemap, highlights and saved queries have their own `create*Store.js` and `*Store.js` pairs, with `sitemapApi.js`, `highlightsApi.js` and `savedQueriesApi.js` over the service.
- Toolbar menu match counts come from `createMatchCounts.js`. It takes the list of queries and a count function, counts four at a time and fills in each count as it returns. A recount keeps the last numbers, marked `stale`, until the new ones arrive, and the menus show stale numbers dimmed (`opacity-30`). `schedule` counts 1.5 s after the first call in a burst, after a project load or resync, so a menu opens with numbers; a scheduled run is never stopped by another schedule, which waits for it and then for the delay again. `changed` (the trigger events) only marks the counts stale, and schedules a recount only while the menu is open (`setOpen`, from `ToolbarMenu`'s `open` and `close` events), so counts nobody is looking at never keep Marasi busy during capture. `clear` forgets every count on a project switch, so an unknown count shows `…`. Opening a menu recounts it at once. There are three users:
  - Saved queries: `createSavedQueriesStore.js` mirrors the counts into `state.counts` (`loadCounts`, `scheduleCounts`, `countsChanged`, `setCountsOpen`, `clearCounts`) and counts through `GET /traffic/count` with the exclusion.
  - Highlights and Marks: `ledgerMenuCounts.js` holds `highlightCounts` (`HIGHLIGHT_TERMS`) and `markCounts` (`MARKS`) and counts through `ledgerStore.countQuery`. It registers with projectData to clear on a switch and schedule on a load or resync. `LedgerToolbar.svelte` calls `setOpen` from each menu's `open` and `close`.
  - Triggers: each store calls `changed` on the events in `countChanges.js` (`COUNT_CHANGE_EVENTS`): new or changed traffic, `metadata.updated` (highlights), `note.*`, and finding and launchpad links.
- The content-type exclusion is `contentTypeExclusion.js`: the app default stays in the app config (the `GetDefaultContentTypeExclusion` binding), the project override is a client setting (`clientSettingsApi.js`, `/client-settings/marasi-app/...`). Saved queries and highlight labels are client settings too.
- Tests drive the API files against `fakeServiceClient.js`.

## How an action reaches its handler

The page has three entry points, and all of them lead to `runMenuAction`:

- **Row menu.** `menuFor` builds the items (`LedgerRowMenu.svelte` passes it `rowMenuContext`). Choosing one calls `runMenuAction`, which switches on the item's `action.type`.
- **Shortcut.** An entry in `drawerMenu` calls `runShortcut`, which finds the row-menu item with the same `actionId` (`menuAction`) and runs it as if it had been chosen.
- **Drawer rail.** `DrawerRail.svelte` sends an action id, and `LedgerDrawer.svelte` passes it on to `drawerHandlers`.

To add a row-menu action:
1. Add the item to `menuFor`, with an `actionId` if it has a shortcut, and `disabled` when it can't run on a ⌘A selection.
2. Add its icon to `ICONS` in `RowMenu.svelte` if it is new.
3. Add a `case` to `runMenuAction` in `ledgerActions.js`.
4. Add a store method (bulk actions go in `stores/ledger/bulk.js`), map its API name to a service call in `ledgerApi.js`, and add it to the tests' fake APIs.

For a shortcut, also follow `keybindings-and-menus.md`. ⌘K opens `MarasiMenu` with `menuOptions`, which follow the drawer: `ledgerMenu` when it is closed, `drawerMenu` (with the WebSocket stream action for an upgrade) when it is open. Their menu groups are the `group` flags on the `ledger.drawer-open` and `ledger.drawer-closed` rows in `catalog.js`, defined in `menuGroups.js`.

## Bulk changes

A bulk change acts on a selection in Marasi's shape: `selectionSpec` gives a list of ids, or a query with its `as_of` after ⌘A. `ledgerApi.js` sends it to the service's bulk endpoints. The store reads the rows again (`changed`) or patches them in place (`setHighlight`). Every bulk route also publishes `traffic.changed`, which names the selection but not the new values. Its handler (`onTrafficChanged`) reads the rows again in place once `EVENT_SETTLE_MS` passes without another, so another client's bulk change shows too, and the app's own runs one extra read. Refusals come back as coded errors (see `marasi-service.md`):
- `selection_incomplete`, read by `incompleteJobs` in `selectionIncomplete.js`;
- `launch_pending`, read by `pendingLaunchIDs` in `launchPending.js`.

A count of zero is reported by `unchanged`, with its text from `unchangedText` in `counts.js`.

## Live traffic and project switches

`ledgerStore.js` and `sitemapStore.js` follow the service's `traffic.request` and `traffic.response` events (`toRequestEvent`, `toResponseEvent` in `trafficApi.js`). The Ledger shows new rows when it next flushes (`flush`). `websocket.opened`, `websocket.closed` and `websocket.handshake_ended` patch rows through `patchWebSocketMetadata`.

Another client's changes show without a resync:
- `metadata.updated` replaces the pair's `Metadata` (`onMetadataUpdated`), and `note.updated` and `note.deleted` set `has_note` (`onNoteUpdated`, `onNoteDeleted`). Each makes a new row object. `LedgerDrawer.svelte` reads the note and an open metadata pane again whenever its row changes. While the note pane is open, the new text replaces it only when nothing typed waits to save, and `noteVersion` restarts the editor.
- `traffic.changed` reads the rows again in place, debounced (see Bulk changes).
- `traffic.index_complete` reads the results again when they were read while the index was building (`onIndexComplete`).
- `sitemap.changed` (a rebuild, or another client's delete) reads the sitemap's open levels again after `SITEMAP_SETTLE_MS` (`onChanged` in `createSitemapStore.js`). Both stores register with `projectData`: a project switch clears and loads them; a reconnect to the same project runs `resync`, which rereads rows and the exclusion in place and keeps scroll, selection and the open drawer. The sitemap reads once the Ledger's first rows and the exclusion are in (`setContext`).

## Decisions

- [Ledger settings are app defaults with project overrides, stored by the app](../../adr/2026-10-16-app-defaults-with-project-overrides.md)
- Selections: marasi `docs/adr/2026-10-14-query-selections-stop-at-as-of.md`
- Deletes: marasi `docs/adr/2026-10-14-deleting-a-pair-deletes-everything-it-owns.md`
- Highlights: marasi `docs/adr/2026-10-14-highlight-is-a-side-table.md`
- The sitemap: marasi `docs/adr/2026-10-14-sitemap-is-stored-by-node-and-content-type.md`
