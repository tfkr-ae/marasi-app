# Ledger

Which files work together on the Ledger page, and how a row-menu action, a shortcut or a bulk change travels from the menu to Marasi. Names are functions and files, so search for them. For anything inside one function, read the function.

## Files

- `frontend/src/routes/ledger/+page.svelte` wires everything together: the components, every action function, toasts and confirmations, the menu arrays for `useMenuActions`, and `drawerHandlers`.
- `frontend/src/stores/createLedgerStore.js` holds the Ledger's state and logic. It takes its API as an argument. `frontend/src/stores/ledgerStore.js` is the only file that maps that API to the v1 bindings in `frontend/src/lib/bindings/App.js`.
- `frontend/src/lib/ledger/` holds the components and pure helpers. `rowMenu.js` describes the row menu as data, `RowMenu.svelte` draws it (the Launchpad reuses it), and `LedgerDrawer.svelte` and `DrawerRail.svelte` make up the drawer.
- The sitemap, highlights and saved queries have their own `create*Store.js` and `*Store.js` pairs.
- Bindings: the ported Ledger bindings in `App.js` call Marasi's `/traffic` routes, `/notes/{id}` and the `marasi-app/ledger.exclusion` client setting, and `frontend/src/lib/bindings/traffic.js` turns Marasi's pairs and traffic events into v1's shapes. `QueryTraffic` reads past Marasi's 500-row page cap by cursor under the first page's `as_of`. The exclusion is the project's client setting when it has one, else the app default (`GetDefaultContentTypeExclusion`). `ListSitemapLevels` and `ListSitemapChildren` both read `POST /traffic/sitemap/levels` (the second as one node), as v1 did. The bulk, highlight, link and saved query bindings are later tickets (`docs/v2-parity.md`); until then they reject as not ported.

## How an action reaches its handler

The page has three entry points, and all of them lead to `runMenuAction`:

- **Row menu.** `menuFor` builds the items. Choosing one calls `runMenuAction`, which switches on the item's `action.type`.
- **Shortcut.** An entry in `drawerMenu` calls `runShortcut`, which finds the row-menu item with the same `actionId` (`menuAction`) and runs it as if it had been chosen.
- **Drawer rail.** `DrawerRail.svelte` sends an action id, and `LedgerDrawer.svelte` passes it on to `drawerHandlers`.

To add a row-menu action:
1. Add the item to `menuFor`, with an `actionId` if it has a shortcut, and `disabled` when it can't run on a ⌘A selection.
2. Add its icon to `ICONS` in `RowMenu.svelte` if it is new.
3. Add a `case` to `runMenuAction`.
4. Add a store method, and map its API name in `ledgerStore.js` and in the tests' fake APIs.
5. Port the binding in `App.js` (see `marasi-service.md`).

For a shortcut, also follow `keybindings-and-menus.md`.

## Bulk changes

A bulk change acts on a selection in Marasi's shape: `selectionSpec` gives a list of ids, or a query with its `as_of` after ⌘A. The Go side wraps the call in `trafficBulk` or `bulk` in `traffic_bulk.go`. Marasi sends no event for bulk changes, so the store reads the rows again (`changed`) or patches them in place (`setHighlight`). Refusals come back as coded errors (see `marasi-service.md`):
- `selection_incomplete`, read by `incompleteJobs` in `selectionIncomplete.js`;
- `launch_pending`, read by `pendingLaunchIDs` in `launchPending.js`.

A count of zero is reported by `unchanged`, with its text from `unchangedText` in `counts.js`.

## Live traffic and project switches

`handlers` in `frontend/src/lib/marasiEvents.js` turns each `traffic.request` and `traffic.response` event into v1's shape (`requestEvent`, `responseEvent`) and sends it to `ledgerStore`, `sitemapStore` and `recentTraffic`; `sitemap.changed` (a sitemap rebuild or a delete) makes `sitemapStore` read its open levels again (`reload`). The Ledger shows new rows when it next flushes (`flush`). The events carry no bytes, so a response for the focused pair makes the store read the pair (`readIncomingResponse`) for the drawer. The Launchpad and Armory still listen in `+layout.svelte`, which hears nothing in v2 until their tickets move them to `handlers`. `ws-open`, `ws-close` and `ws-state` patch rows through `patchWebSocketMetadata`. On a project switch, `openProject` in `frontend/src/stores.js` clears the Ledger and fills it again.

## Decisions

- [Ledger settings are app defaults with project overrides, stored by the app](../../adr/2026-10-16-app-defaults-with-project-overrides.md)
- Selections: marasi `docs/adr/2026-10-14-query-selections-stop-at-as-of.md`
- Deletes: marasi `docs/adr/2026-10-14-deleting-a-pair-deletes-everything-it-owns.md`
- Highlights: marasi `docs/adr/2026-10-14-highlight-is-a-side-table.md`
- The sitemap: marasi `docs/adr/2026-10-14-sitemap-is-stored-by-node-and-content-type.md`
