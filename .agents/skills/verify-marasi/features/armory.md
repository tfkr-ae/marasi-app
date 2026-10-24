# Request fuzzing

## Sub-features

- The dock: request templates and their runs as a tree, with run status badges
- The template header (name, description, Save, Delete) and the request editor with `@@x@@` payload positions
- Run settings: attack type, concurrency, HTTPS, wordlists, and the pinned Launch / Save as draft footer
- Persisted runs, status polling, and the run's traffic table
- The request drawer, its details column, and the traffic row menu (Launchpad, Finding, Test case)
- Request detail handoff from Ledger

## How to get to it (user POV)

Select the rail item titled `Armory` or press `Command+6`. The page is a dock and a workspace:

- **Dock.** The header reads `Templates n`, with `Refresh runs` and `Create template` (`+`, title `New template`). Collapsed, the strip reads `Templates` (`Show templates` restores it). Below sit `Search templates…` and the tree (`[role=tree]`): a template is a `treeitem` (`title` is its description or name) with an `Expand`/`Collapse` chevron (`aria-expanded`); its runs are `treeitem`s under a `[role=group]` (`title="<n> workers · <date>"`), showing the attack type and a status badge (`complete`, `in progress`, `draft`; `.badge`). The selected one carries `aria-current=true`. Hovering a run, or selecting it, shows `Start run` (drafts), `Cancel run` (in progress) or `Delete run`. A fresh scratchpad reads `No templates yet` in the tree and `No template selected` in the workspace; a search with no match reads `No matching templates`.
- **Workspace.** A header with `Template name`, `Save` and `Delete template` (icon), and `Description` below. Then the request editor (`.armory-editor`) and `Run settings` side by side, stacked below 1024 px. The `Run settings` button (title `Hide run settings` / `Show run settings`, `⌘P`) folds them. The fields are `Attack type` (a select), `Concurrency`, `Use HTTPS` (`div[role=switch]:has(input[name="Armory HTTPS"])`) and `Wordlists n` with `Add wordlist` and a chip per list (`Remove <file>`). A footer pinned under them holds the validation message, `Launch` and `Save as draft`.
- **Traffic.** At the bottom, `Traffic n items` (title `Hide traffic` / `Show traffic`) folds the table. With rows it has a page-size select, `i / n`, `Previous page` and `Next page`. The table (`[role=grid]`) has the Ledger's columns `# · Time · Method · Host / Path · Status · Length` as 22 px rows (`button[role=row]`). The host and path share one cell (`.tr-url`: `.tr-host`, `.tr-path`); when the column is narrow the host truncates first, so the path stays readable. Without a run it reads `Select a run to view traffic`; with a run but no rows yet, `No requests captured yet`.
- **Drawer.** Clicking a row opens `.armory-drawer-box` over the bottom of the workspace (62 % at first, right of the dock, never over the rail). Dragging its top edge (`.armory-drawer-resize`, title `Drag to resize the drawer`) sets its share of the workspace from 15 % to 85 %, read back from the box's inline `height`; the share survives closing and page visits, and the handle is hidden while maximised. It holds the request (`.armory-drawer-request`) and the response (`.armory-drawer-response`) side by side; when the panes are under 480 px wide (`.armory-drawer-panes[data-stacked=true]`) the request sits over the response. On its left is the icon rail (`.armory-drawer-rail`) or, after `Show the details`, the 240 px details column (`.armory-drawer-column`, `Collapse the details`): `#N`, the facts (`.armory-drawer-facts`), `LINKED` findings and test cases (hover a link for its unlink ×), and `Actions`: `Copy request`, `Copy response`, `Copy URL` and `More actions`. Both carry `Previous request`, `Next request`, `Maximise the drawer`/`Restore the workspace`, and `Close the drawer`. Esc closes it wherever focus is, unless a modal, the Marasi menu or the row menu is open: those close first, one Esc each.
- **Row menu.** Right-clicking a row, or the drawer's `Actions` / `More actions`, opens the Ledger's `.ledger-row-menu` pared down to `Send to Launchpad` (`lp-new`, `lp-add`), `Finding` and `Test case` (`f-new`/`t-new`, `f-link`/`t-link`, `f-unlink`/`t-unlink`). Its footer has no `⇧-click to extend` hint, because the table has no multi-select. Toasts: `Sent to a new launchpad` (named `Request <n>`), `Saved finding`, `Saved test case`, `Linked to test case "<title>"`, `Unlinked from test case "<title>"`.

Shortcuts: every menu shortcut for this feature is a catalog action in context `armory.page` (drawer closed) and `armory.drawer` (drawer open: `⌘⇧]`/`⌘⇧[` step the requests) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh armory` for route proof (`/armory` plus `Templates`).

**Seeding a run.** Start `python3 scripts/bench-server.py` (127.0.0.1:18999), write a wordlist of paths (one per line, for example 40 lines starting `admin`) to `$APP_CONFIG_DIR/wordlists/common-paths.txt`, and drive:

```json
{"name":"seed-run","steps":[
 {"click":"[aria-label=\"Create template\"]"},{"waitSelector":".modal-example-form input"},
 {"click":".modal-example-form input"},{"insert":"api-path-discovery"},{"text":"Create","within":".modal-example-form"},
 {"waitText":"Template created"},{"waitNoSelector":".modal-example-form"},
 {"click":".armory-editor .cm-content"},{"key":"cmd+a"},{"insert":"GET /@@x@@?size=256 HTTP/1.1\nHost: 127.0.0.1:18999\nAccept: */*\n\n"},
 {"text":"Save"},{"waitText":"Template saved"},
 {"click":"div[role=switch]:has(input[name=\"Armory HTTPS\"])"},
 {"waitSelector":"div[role=switch][aria-checked=false]:has(input[name=\"Armory HTTPS\"])"},
 {"text":"Add wordlist"},{"waitSelector":"[aria-label=\"Refresh wordlists\"]"},{"click":"[aria-label=\"Refresh wordlists\"]"},
 {"text":"common-paths.txt"},{"waitSelector":"[aria-label=\"Remove common-paths.txt\"]"},
 {"waitEnabledText":"Launch"},{"text":"Launch"},{"waitText":"Run started"},
 {"waitText":"complete","within":"[role=tree] .badge","timeoutMs":20000},
 {"waitText":"40 items","timeoutMs":20000}]}
```

Then query `select status, max_concurrent from armory_run`, and check that `request` rows carry `json_extract(metadata,'$.armory_run_id')`.

**Drawer and row menu** (rows are `button[role=row]`; scope them by path). This assumes `/admin` is linked to the test case "API path probe" (`t-new` on a row, then `More actions` › `Test case` › `Link to test case` in the drawer):

```json
{"name":"drawer","steps":[
 {"click":"[role=grid] button[role=row]","hasText":"/admin?size=256"},
 {"waitSelector":".armory-drawer-box"},{"waitText":"HTTP/1.0 200","within":".armory-drawer-response"},
 {"key":"escape"},{"waitNoSelector":".armory-drawer-box"},
 {"click":"[role=grid] button[role=row]","hasText":"/admin?size=256","button":"right"},
 {"waitSelector":".ledger-row-menu"},{"hover":".ledger-row-menu [data-menu-item=testcase]"},
 {"waitSelector":".ledger-row-submenu [data-menu-item=t-link]"},{"hover":"[data-menu-item=t-link]"},
 {"waitSelector":".ledger-row-submenu[data-menu-level=\"2\"] [role=menuitemcheckbox][aria-checked=true][aria-disabled=true]"},
 {"key":"escape"},{"key":"escape"},{"key":"escape"},{"waitNoSelector":".ledger-row-menu"}]}
```

Esc closes the drawer even with focus in the template editor or a field. The details column stays expanded once opened (`Show the details`), so wait for `.armory-drawer-column` or `.armory-drawer-rail` rather than clicking the toggle blind. A linked target is labelled `Already linked`; to link one, click it by text in the level-2 submenu (`{"click":".ledger-row-submenu[data-menu-level=\"2\"] button","hasText":"API path probe"}`). The finding and test case modals close with `[aria-label=Close]`, which saves (`Saved finding`, `Saved test case`); the finding title is `label.col-span-3 input`, the test case title `#titleInput`.

**Narrow widths.** The driver keeps the page at 1600x900. To check reflow, resize the headless window with `Browser.setWindowBounds` after `Page.bringToFront` on the Wails page (otherwise the window can resize while the page keeps 1600 px, as when a stray `chrome://settings/help` tab is in front), then restore 1600x900 before the next drive.

## Gotchas

- Wordlists live in `$APP_CONFIG_DIR/wordlists`, not the `.marasi` file. A list seeded after startup appears after `Refresh wordlists` in the Add wordlist modal; changing routes alone does not reload it.
- A new template's request is empty. Validation then requires at least one `@@x@@` payload position, a `Host` header, and concurrency from 1 to 100.
- Validation is debounced by 300 ms and starts out pending, so `Launch` is disabled until it finishes. Wait with `waitEnabledText`.
- Harpoon and broadside require exactly one wordlist; tandem and maelstrom require one per payload position.
- Run status comes from a 1.5 s poll. Wait for `[role=tree] .badge` to read `complete`, not for any `complete` text. Traffic rows can arrive after the run completes, in arrival order, so numbers can be slightly out of order.
- Toasts such as `Run started` and `Template saved` cover the bottom right; wait them out (`waitNoText`, `timeoutMs` 20000) before a screenshot or a click there.
- Doctor and reset treat an open `.armory-drawer-box`, and an open confirm such as `Delete Template`, as residue. End each recipe with the drawer closed (Esc, or `Close the drawer`).
- Armory traffic goes through the proxy listener, so the listener must be online.
