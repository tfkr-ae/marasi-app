# Ledger

Which files work together on the Ledger page, and how a row-menu action, a shortcut or a bulk change travels from the menu to Marasi. Names are functions and files, so search for them. For anything inside one function, read the function.

## Files

- `frontend/src/routes/ledger/+page.svelte` wires everything together: the components, every action function, toasts and confirmations, the menu arrays for `useMenuActions`, and `drawerHandlers`.
- `frontend/src/stores/createLedgerStore.js` holds the Ledger's state and logic. It takes its API as an argument. `frontend/src/stores/ledgerStore.js` binds it to the service client: `ledgerApi.js` maps the store's API names to service calls, and `trafficApi.js` maps traffic reads, rows and `traffic.*` events.
- `frontend/src/lib/ledger/` holds the components and pure helpers. `rowMenu.js` describes the row menu as data, `RowMenu.svelte` draws it (the Launchpad reuses it), and `LedgerDrawer.svelte` and `DrawerRail.svelte` make up the drawer.
- The sitemap, highlights and saved queries have their own `create*Store.js` and `*Store.js` pairs, with `sitemapApi.js`, `highlightsApi.js` and `savedQueriesApi.js` over the service.
- Saved-query match counts (`loadCounts` in `createSavedQueriesStore.js`) run four at a time through `GET /traffic/count`. `scheduleCounts` recounts 1.5 s after a project load, a resync or new traffic, so the menu usually opens with numbers. A recount keeps the last numbers, dimmed (`stale`), until new ones arrive. A project switch (`clearCounts`) forgets them, so an unknown count shows `…`.
- The content-type exclusion is `contentTypeExclusion.js`: the app default stays in the app config (the `GetDefaultContentTypeExclusion` binding), the project override is a client setting (`clientSettingsApi.js`, `/client-settings/marasi-app/...`). Saved queries and highlight labels are client settings too.
- Tests drive the API files against `fakeServiceClient.js`.

## How an action reaches its handler

The page has three entry points, and all of them lead to `runMenuAction`:

- **Row menu.** `menuFor` builds the items. Choosing one calls `runMenuAction`, which switches on the item's `action.type`.
- **Shortcut.** An entry in `drawerMenu` calls `runShortcut`, which finds the row-menu item with the same `actionId` (`menuAction`) and runs it as if it had been chosen.
- **Drawer rail.** `DrawerRail.svelte` sends an action id, and `LedgerDrawer.svelte` passes it on to `drawerHandlers`.

To add a row-menu action:
1. Add the item to `menuFor`, with an `actionId` if it has a shortcut, and `disabled` when it can't run on a ⌘A selection.
2. Add its icon to `ICONS` in `RowMenu.svelte` if it is new.
3. Add a `case` to `runMenuAction`.
4. Add a store method, map its API name to a service call in `ledgerApi.js`, and add it to the tests' fake APIs.

For a shortcut, also follow `keybindings-and-menus.md`.

## Bulk changes

A bulk change acts on a selection in Marasi's shape: `selectionSpec` gives a list of ids, or a query with its `as_of` after ⌘A. `ledgerApi.js` sends it to the service's bulk endpoints. Marasi sends no event for bulk changes, so the store reads the rows again (`changed`) or patches them in place (`setHighlight`). Refusals come back as coded errors (see `marasi-service.md`):
- `selection_incomplete`, read by `incompleteJobs` in `selectionIncomplete.js`;
- `launch_pending`, read by `pendingLaunchIDs` in `launchPending.js`.

A count of zero is reported by `unchanged`, with its text from `unchangedText` in `counts.js`.

## Live traffic and project switches

`ledgerStore.js` and `sitemapStore.js` follow the service's `traffic.request` and `traffic.response` events (`toRequestEvent`, `toResponseEvent` in `trafficApi.js`). The Ledger shows new rows when it next flushes (`flush`). `websocket.opened`, `websocket.closed` and `websocket.handshake_ended` patch rows through `patchWebSocketMetadata`. Both stores register with `projectData`: a project switch clears and loads them; a reconnect to the same project runs `resync`, which rereads rows and the exclusion in place and keeps scroll, selection and the open drawer. The sitemap reads once the Ledger's first rows and the exclusion are in (`setContext`).

## Decisions

- [Ledger settings are app defaults with project overrides, stored by the app](../../adr/2026-10-16-app-defaults-with-project-overrides.md)
- Selections: marasi `docs/adr/2026-10-14-query-selections-stop-at-as-of.md`
- Deletes: marasi `docs/adr/2026-10-14-deleting-a-pair-deletes-everything-it-owns.md`
- Highlights: marasi `docs/adr/2026-10-14-highlight-is-a-side-table.md`
- The sitemap: marasi `docs/adr/2026-10-14-sitemap-is-stored-by-node-and-content-type.md`
