# Screens and type

Which component draws each part of the app, and the type sizes the pages share. Paths are under `frontend/src/` and names are components, functions and files, so search for them.

## The app frame

`routes/+layout.svelte` draws everything around a page:

- **App rail.** Skeleton's `AppRail`, with one `AppRailAnchor` per page, then one per extension with an interface (its Lua `icon` render, else its web component's `icon` element through `lib/extensions/WebComponent.svelte`, `data-testid="extension-web-ui-tile"`), then Settings. Three icons carry an indicator: Settings shows the update dot (`settingsIconIndicator`), Checkpoint the count of intercepted items (`checkpointBadge.js`, `data-testid="checkpoint-badge"`), and Armory the runs in progress (`lib/armory/armoryBadge.js`, `data-testid="armory-badge"`, from the store's active set through `activeCountsOf`); both counts go in the icon's title too.
- **Connection tile.** `lib/connection/ConnectionRailTile.svelte`, in the rail's trail above the light switch, shows the active connection (`connectionStore`) with a status dot (`lib/connection/status.js`: labels and colours per phase, `data-testid="connection-tile"`, `data-phase`). It opens the Connections modal (`ConnectionsModal.svelte`, registered as `Connections`; `connectionsModal()` in `lib/connection/modal.js`), the connection list beside `ConnectionDetail.svelte`. The Marasi menu's "Connections…" action (`global.connections`, ⌘9 / Ctrl+9, `keybindings-and-menus.md`) opens or closes it from any page. Settings → Connection, the first Settings section, is `ConnectionSettings.svelte`: the same list and details in Settings rows. Both lists end in Add connection (`AddConnection.svelte`: a local connection for a named instance, picked from `LocalInstances` or typed, with an optional proxy port (`localPort.js`); or a remote from a pairing payload, `pairing.js`, or name, address and password). The detail offers Switch on another connection, the refused-password prompt on `auth-failed`, Stop (an Instance row, asking first when the run isn't owned, and always for a remote: "Stop <name>?" with "The app can't start it again.") and "Marasi stopped" once `stopped`, with Start for a local connection and Retry for a remote, a remote's Address and Remove, and an added local connection's Proxy port and Remove (`manage.js`; off with "Switch away first" or "Stop it first", `removeBlock` in `status.js`). The switch banner's text is `reachingText` (`status.js`), the start screen's rule. With no Marasi CLI the detail shows `CLISetup.svelte`, and the modal opens by itself. The start screen's **Connections…** (`data-testid="startup-connections"`, `+layout.svelte`'s `openConnections`) opens it before the app has loaded. Settings → Updates has two parts under sub-headings: Marasi App (the app updater, `updates.md`) and Marasi CLI (`CLISettings.svelte`, anchor `id="cli"`). `?section=cli` and `?section=updates#cli` open Updates scrolled to the CLI part (`lib/settingsSection.js`). Its "Service update" row shows the connected service's own update (`serviceUpdateStore`). `ConnectionBanner.svelte` (over the page) shows reconnecting, restarting (`service.restarting`), project-changed, stopped (Start, or Retry for a remote), Start's own starting and API-level states. It also triggers the connection toasts (`connectionToasts.js`: drop, reconnect, restart failed) and the service-update toasts.
- **Marasi menu.** `GlobalMenu.svelte` (in `lib/components/MarasiMenu/`) is mounted once here. It runs the `global.*` actions, such as going to a page. ⌘K opens `MarasiMenu.svelte`: a square-edged dialog with the search field (`id="commandmenu"`), on a page that mounts one a red (primary) heading named after the page with the page's groups, a sand (tertiary) Marasi heading with a bar and fading rule, one row per menu group (tinted icon tile, label and description, count badge, key badge, chevron) and loose actions aligned to the same right edge, and a footer with the highlighted row's description and real shortcut. `MenuKeys.svelte` draws its key badges (1.5rem, system font). `GlobalMenu` mounts the one for Home and Settings (only the Marasi section). Every page with its own menu mounts its own `MarasiMenu` (its section, then the Marasi section), and the WebSocket modal mounts an overlay-tier one. See `keybindings-and-menus.md`.
- **Modals.** Components are registered by name in `modalRegistery` and opened with `modalStore.trigger({ type: "component", component: "<name>" })`. Most are `lib/components/*Modal.svelte`. Skeleton's built-in `confirm`, `alert` and `prompt` modals take the type scale from the `<Modal>` props here (`regionHeader`, `regionBody`, and `btn-sm` in `buttonPositive`/`buttonNeutral`).
- **Drawer.** `AppDrawer.svelte` is the Skeleton drawer that Compass, Checkpoint and Workshop open through `drawerStore`. The Ledger has its own drawer instead (see `ledger.md`), and so does the Armory: `lib/armory/ArmoryDrawer.svelte` and `ArmoryDrawerRail.svelte`. Both details columns draw the facts with `lib/ledger/DrawerFacts.svelte` and the Linked section with `lib/ledger/DrawerLinked.svelte` (the Armory passes `onUnlink`). The Armory page reports whether it is open to the menu contexts through `armoryDrawer` in `lib/keybindings/app.js`.
- **Chef, Excalidraw and Interactsh.** They are loaded the first time their rail icon is clicked, then stay mounted in the layout, so they keep their state. Their routes only show or hide them.
- **Opening screen and toasts.** `OpeningScreen.svelte` (see `project-open.md`) and Skeleton's `Toast`.
- **The page** renders in `{#key $pagesKey}<slot />`.

A new page needs a route, a rail anchor in `+layout.svelte`, and a `global.go-*` action in the catalog. If it has its own shortcuts, it also needs a context in `contexts.js`.

## Screens

| Screen | Route | Main components |
|---|---|---|
| Home | `routes/+page.svelte` | `Dashboard.svelte`, `LogTable.svelte` |
| Ledger | `routes/ledger/` | `lib/ledger/`, `lib/dock/Dock.svelte` |
| Launchpad | `routes/launchpad/` | `lib/launchpad/` |
| Checkpoint | `routes/checkpoint/` | `lib/checkpoint/`, `lib/dock/Dock.svelte` (see `checkpoint.md`) |
| Armory | `routes/armory/` | `lib/armory/` (`ArmoryDock`, `TemplateHeader`, `TemplateEditor`, `RunSettings`, `TrafficRegion`, `ArmoryDrawer`, `ArmoryDrawerRail`; `rowMenu.js` builds the traffic row menu from the Ledger's item builders, and `RowMenu` draws it; a template row's primary chip is its runs in progress, `runningByTemplate`), `lib/dock/Dock.svelte`, `stores/armoryStore.js` (the active set, `activeRuns`, is one `GET /armory/run?status=in_progress` on load, resync and cancel, then `armory.run.*`) |
| Logbook | `routes/logbook/` | `lib/logbook/` (`LogbookToolbar`, `LogbookOutline`, `LogbookSummary`; the open record is `LogbookRecord`; the modals are `RecordModal` and `ExportReview`), `lib/dock/Dock.svelte`, `stores/logbookStore.js` (see `logbook.md`) |
| Compass, Workshop | `routes/<name>/` | Most of the screen is in the route file. |
| Chef, Excalidraw, Interactsh | `routes/sveltechef/`, `excalidraw/`, `interact/` | `SvelteChef.svelte`, `Excalidraw.svelte`, `Interact.svelte`, mounted by the layout |
| Extension pages | `routes/extension/[name]/` | `lib/extensions/` |
| Settings | `routes/settings/` | One section per `sections` entry. Keybindings opens `KeybindingsModal.svelte`. |
| WebSocket stream | the `WebsocketStream` modal | `WebSocketModal.svelte` and its `WebSocket*.svelte` tabs |

## Editors

Every code editor is `svelte-codemirror-editor`'s `CodeMirror`:

- `lib/logbook/RequestPair.svelte` shows a finding's or test case's linked request and response with the Ledger's `DrawerEditor`, in the Logbook's record view and in `RecordModal.svelte`, the finding and test case modal (registered as `LogbookRecord`; see `logbook.md`).
- `lib/ledger/DrawerEditor.svelte` is the Ledger drawer's editor.
- `LedgerQueryBox.svelte` is the Ledger's query editor.
- `LaunchpadWorkspace.svelte` holds the Launchpad draft.
- `WebSocketInject.svelte`, `WebSocketCheckpoint.svelte` and `WebSocketMessagesTable.svelte` are the WebSocket editors.
- `lib/checkpoint/ItemWorkspace.svelte` holds the intercepted item and its context; `lib/checkpoint/RulesEditor.svelte` holds the Checkpoint rules.
- `lib/extensions/components/Editor.svelte` is the editor an extension interface gets.
- `lib/armory/TemplateEditor.svelte` holds the Armory request template.
- Compass and Workshop create their own in the route file.

A shortcut typed in an editor runs after the editor has handled the key (see `keybindings-and-menus.md`).

## Type scale

The type scale is Tailwind's rem sizes plus two dense sizes, `text-2xs` (0.6875rem) and `text-3xs` (0.625rem), defined in `tailwind.config.js`. The theme (`tfkr-theme.js`) sets only the font, `system-ui`. Text size (`lib/textSize.js`) scales the root font size, so every size below scales with it:

| Use | Classes |
|---|---|
| Page and modal titles | `text-base font-bold` |
| Section headings | `text-sm font-bold` |
| Body text, menus, toolbars, buttons | `text-xs`, with `btn btn-sm` for buttons |
| Dense table rows, labels, metadata, rail labels | `text-2xs` (the Ledger table sets `font-size: 0.6875rem` in its own style) |
| Paths, ids, log lines | `font-mono text-2xs` |
| Counts, badges, group labels | `text-3xs` |

**Exception: the Marasi menu.** `MarasiMenu.svelte` and `MenuKeys.svelte` are larger than the scale on purpose, so the menu reads at a glance (the menu redesign spec): `text-sm` rows and search field, `text-xs` descriptions and counts, and 1.5rem (`h-6`) key and count badges. Leave those sizes as they are, and don't copy them elsewhere. The Keybindings settings are not part of the exception.

Write every text size in rem, including CodeMirror `fontSize` styles. `lib/textSizeRem.test.js` fails on a text size in px and names its file and line.

Marasi is square-edged. `lib/squareEdges.test.js` fails on any `rounded*` class or CSS radius except `rounded-none`, `rounded-0` and `rounded-full` on a dot of at most `h-4 w-4` (other circles go in its `CIRCLES` list with a reason). The theme pins Skeleton's radius tokens to 0px, and `app.css` squares `btn-icon` and `badge-icon`.

Action buttons (`btn`, `btn-icon`) take their variant from `primaryVariant($modeCurrent)`, or `tertiaryVariant`/`neutralVariant`, in `lib/launchpad/format.js`: no other Skeleton `variant-*` and no border or ring. `lib/buttonVariants.test.js` checks them; its `GRANDFATHERED` list holds the existing exceptions.

`app.css` adds the denser `.btn-group-sm` and `.table-dense`. To match the scale, copy from `LedgerTable.svelte`, `DrawerRail.svelte` or `OpeningScreen.svelte` instead of measuring.

## Decisions

- [Text size scales the root font size, not the whole page](../../adr/2026-10-29-text-size-scales-the-root-font-size.md)
