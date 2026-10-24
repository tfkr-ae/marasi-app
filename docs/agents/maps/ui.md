# Screens and type

Which component draws each part of the app, and the type sizes the pages share. Paths are under `frontend/src/` and names are components, functions and files, so search for them.

## The app frame

`routes/+layout.svelte` draws everything around a page:

- **App rail.** Skeleton's `AppRail`, with one `AppRailAnchor` per page, then one per extension with an interface, then Settings. Two icons carry an indicator: Settings shows the update dot (`settingsIconIndicator`), and Checkpoint shows the count of intercepted items (`checkpointBadge.js`, `data-testid="checkpoint-badge"`) and adds it to its title.
- **Marasi menu.** `GlobalMenu.svelte` (in `lib/components/MarasiMenu/`) is mounted once here. It runs the `global.*` actions, such as going to a page. ⌘K opens a `MarasiKeys.svelte` dialog, which each page also mounts with its own actions (see `keybindings-and-menus.md`).
- **Modals.** Components are registered by name in `modalRegistery` and opened with `modalStore.trigger({ type: "component", component: "<name>" })`. Most are `lib/components/*Modal.svelte`.
- **Drawer.** `AppDrawer.svelte` is the Skeleton drawer that Compass, Checkpoint, Logbook and Workshop open through `drawerStore`. The Ledger has its own drawer instead (see `ledger.md`), and so does the Armory: `lib/armory/ArmoryDrawer.svelte` and `ArmoryDrawerRail.svelte`. The Armory page reports whether it is open to the menu contexts through `armoryDrawer` in `lib/keybindings/app.js`.
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
| Armory | `routes/armory/` | `lib/armory/` (`ArmoryDock`, `TemplateHeader`, `TemplateEditor`, `RunSettings`, `TrafficRegion`, `ArmoryDrawer`, `ArmoryDrawerRail`, `ArmoryLinked`; `rowMenu.js` builds the traffic row menu that `RowMenu` draws), `lib/dock/Dock.svelte` |
| Compass, Logbook, Workshop | `routes/<name>/` | Most of the screen is in the route file. |
| Chef, Excalidraw, Interactsh | `routes/sveltechef/`, `excalidraw/`, `interact/` | `SvelteChef.svelte`, `Excalidraw.svelte`, `Interact.svelte`, mounted by the layout |
| Extension pages | `routes/extension/[name]/` | `lib/extensions/` |
| Settings | `routes/settings/` | One section per `sections` entry. Keybindings opens `KeybindingsModal.svelte`. |
| WebSocket stream | the `WebsocketStream` modal | `WebSocketModal.svelte` and its `WebSocket*.svelte` tabs |

## Editors

Every code editor is `svelte-codemirror-editor`'s `CodeMirror`:

- `RequestResponseView.svelte` shows a request and its response. `AppDrawer`, the Launchpad workspace and the finding and test-case modals use it.
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

No config holds the type scale. The theme (`tfkr-theme.js`) sets only the font, `system-ui`. The sizes are a convention of Tailwind classes, set by the Ledger redesign and since applied to the other pages:

| Use | Classes |
|---|---|
| Page and modal titles | `text-base font-bold` |
| Section headings | `text-sm font-bold` |
| Body text, menus, toolbars, buttons | `text-xs`, with `btn btn-sm` for buttons |
| Dense table rows, labels, metadata, rail labels | `text-[11px]` (the Ledger table sets `font-size: 11px` in its own style) |
| Paths, ids, log lines | `font-mono text-[11px]` |
| Counts, badges, group labels | `text-[10px]` |

`app.css` adds the denser `.btn-group-sm` and `.table-dense`. To match the scale, copy from `LedgerTable.svelte`, `DrawerRail.svelte` or `OpeningScreen.svelte` instead of measuring.
