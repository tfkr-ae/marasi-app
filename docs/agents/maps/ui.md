# Screens and type

Which component draws each part of the app, and the type sizes the pages share. Paths are under `frontend/src/` and names are components, functions and files, so search for them.

## The app frame

`routes/+layout.svelte` draws everything around a page:

- **App rail.** Skeleton's `AppRail`, with one `AppRailAnchor` per page, then one per extension with an interface, then Settings. Two icons carry an indicator: Settings shows the update dot (`settingsIconIndicator`), and Checkpoint shows the count of intercepted items (`checkpointBadge.js`, `data-testid="checkpoint-badge"`) and adds it to its title.
- **Marasi menu.** `GlobalMenu.svelte` (in `lib/components/MarasiMenu/`) is mounted once here. It runs the `global.*` actions, such as going to a page. ⌘K opens a `MarasiKeys.svelte` dialog, which each page also mounts with its own actions (see `keybindings-and-menus.md`).
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
| Armory | `routes/armory/` | `lib/armory/` (`ArmoryDock`, `TemplateHeader`, `TemplateEditor`, `RunSettings`, `TrafficRegion`, `ArmoryDrawer`, `ArmoryDrawerRail`; `rowMenu.js` builds the traffic row menu from the Ledger's item builders, and `RowMenu` draws it), `lib/dock/Dock.svelte` |
| Logbook | `routes/logbook/` | `lib/logbook/` (`LogbookToolbar`, `LogbookOutline`, `LogbookSummary`; the open record is `LogbookRecord`; the modals are `RecordModal` and `ExportReview`), `lib/dock/Dock.svelte`, `stores/logbookStore.js` (see `logbook.md`) |
| Compass, Workshop | `routes/<name>/` | Most of the screen is in the route file. |
| Chef, Excalidraw, Interactsh | `routes/sveltechef/`, `excalidraw/`, `interact/` | `SvelteChef.svelte`, `Excalidraw.svelte`, `Interact.svelte`, mounted by the layout |
| Extension pages | `routes/extension/[name]/` | `lib/extensions/` |
| Settings | `routes/settings/` | One section per `sections` entry. Keybindings opens `KeybindingsModal.svelte`. |
| WebSocket stream | the `WebsocketStream` modal | `WebSocketModal.svelte` and its `WebSocket*.svelte` tabs |

## Editors

Every code editor is `svelte-codemirror-editor`'s `CodeMirror`:

- `RequestResponseView.svelte` shows a request and its response. `AppDrawer` and the Launchpad workspace use it.
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

Write every text size in rem, including CodeMirror `fontSize` styles. `lib/textSizeRem.test.js` fails on a text size in px and names its file and line.

`app.css` adds the denser `.btn-group-sm` and `.table-dense`. To match the scale, copy from `LedgerTable.svelte`, `DrawerRail.svelte` or `OpeningScreen.svelte` instead of measuring.

## Decisions

- [Text size scales the root font size, not the whole page](../../adr/2026-10-29-text-size-scales-the-root-font-size.md)
