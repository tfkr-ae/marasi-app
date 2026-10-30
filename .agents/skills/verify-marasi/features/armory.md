# Request fuzzing

## Sub-features

- The dock: request templates and their runs as a tree, with run status badges
- The template header (name, description, Save, Delete) and the request editor with `@@x@@` payload positions
- Run settings: attack type, concurrency, HTTPS, wordlists, and the pinned Launch / Save as draft footer
- Persisted runs, status polling, and the run's traffic table: read a page at a time, sorted by #, Time, Status or Length
- Group by None, Status or Length: a section per value, counted by Marasi, with fold, Expand all and Collapse all
- The traffic Selection: ⌘-click, ⇧-click, the selected count and Clear
- The request drawer, its details column, and the traffic row menu (Launchpad, Finding, Test case), on one pair or the Selection
- Request detail handoff from Ledger

## How to get to it (user POV)

Select the rail item titled `Armory` or press `Command+6`. The page is a dock and a workspace:

- **Dock.** The header reads `Templates n`, with `Refresh runs` and `Create template` (`+`, title `New template`). Collapsed, the strip reads `Templates` (`Show templates` restores it). Below sit `Search templates…` and the tree (`[role=tree]`): a template is a `treeitem` (`title` is its description or name) with an `Expand`/`Collapse` chevron (`aria-expanded`); its runs are `treeitem`s under a `[role=group]` (`title="<n> workers · <date>"`), showing the attack type and a status badge (`complete`, `in progress`, `draft`; `.badge`). The selected one carries `aria-current=true`. Hovering a run, or selecting it, shows `Start run` (drafts), `Cancel run` (in progress) or `Delete run`. A fresh scratchpad reads `No templates yet` in the tree and `No template selected` in the workspace; a search with no match reads `No matching templates`.
- **Workspace.** A header with `Template name`, `Save` and `Delete template` (icon), and `Description` below. Then the request editor (`.armory-editor`) and `Run settings` side by side, stacked below 1024 px. The `Run settings` button (title `Hide run settings` / `Show run settings`, `⌘P`) folds them. The fields are `Attack type` (a select), `Concurrency`, `Use HTTPS` (`div[role=switch]:has(input[name="Armory HTTPS"])`) and `Wordlists n` with `Add wordlist` and a chip per list (`Remove <file>`). A footer pinned under them holds the validation message, `Launch` and `Save as draft`.
- **Traffic.** At the bottom, `Traffic n items` (title `Hide traffic` / `Show traffic`) folds the table; `n` counts the rows read so far, with `+` while more pages are unread. The table (`[role=grid]`) is one scrolled list that reads the next 200 rows (`QueryArmoryRunTraffic`) as it nears the end. It has the Ledger's columns `# · Time · Method · Host / Path · Status · Length` as 22 px rows (`button[role=row]`, `data-pair-id`). The `#`, `Time`, `Status` and `Length` headers are buttons (`[role=columnheader]`, title `Sort by <label>`, `aria-sort`): one click sorts ascending, the next descending, the third back to # order; the sorted header is primary-coloured with an up or down arrow. Pending pairs sort last both ways. While sorted other than `#`/`Time` ascending, pairs a live run sends don't move the rows: the bar shows `n new · Show` (title `Show them, from the top`), which reads the rows again. In # order they join the end. The run, sort, scroll position and open pair survive page visits; the sort also carries to the next run. The host and path share one cell (`.tr-url`: `.tr-host`, `.tr-path`); when the column is narrow the host truncates first, so the path stays readable. Without a run it reads `Select a run to view traffic`; with a run but no rows yet, `No requests captured yet`.
- **Group by.** After `Traffic n items` the bar reads `Group by` and three square chips (`[role=radiogroup][aria-label="Group by"] [role=radio]`, `aria-checked`): `None` (the default when a run first opens), `Status` and `Length`; the active chip takes the theme's primary variant. Grouped, `n` is the run's exact count (`CountArmoryRunTraffic`, no `+`), and two icon buttons follow the chips, `Expand all` and `Collapse all`. The table becomes a header per value (`[role=grid] button[aria-expanded]`): a chevron, the value (`403`, an exact length such as `1,245 B`, or `…` for pairs with no response), a count chip (amber `variant-soft-warning` with title `Outlier: the only pair with this value` for one pair), and the share right-aligned with one decimal (`69.0%`). The header is tinted primary up to its share, with a sliver for the smallest. Groups are rarest first, ties by value; a group over 40 % of the run starts folded and shows no rows. Clicking a header folds or expands it (its title is `Fold` or `Expand`); an expanded group reads its own rows, 200 at a time, with a `Load more` row where its unread pages start. Grouped by status, the Status header is plain text, not a sort button, and a Length sort orders rows within each status group. Grouped by length, a Length sort orders the groups by length (pending last) and their rows stay in # order. Grouping by the sorted column's field puts the sort back to #. Folds reset when the grouping changes; grouping and sort carry to the next run. In a live run, counts and shares follow arrivals, groups the run adds join the end, and new pairs wait behind `n new · Show`, which counts and orders the groups again.
- **Selection.** As in the Ledger: ⌘-click a row toggles it, ⇧-click selects the rows shown from the anchor (the last row clicked without ⇧, including one a plain click opened) to it, in the current sort, and ⌘⇧-click adds that range. Selected rows take the full-row tint `bg-primary-500/25` (`aria-selected=true`). While a Selection exists the bar's right end reads `n selected · right-click for actions` and a `Clear` button. A plain click opens the pair and empties the Selection; ⌘-click and ⇧-click leave the drawer as it was. The open pair carries `aria-current=true` and the Ledger's focus frame (`.tr-focus`, a primary border), not a tint. The Selection survives a sort and empties when another run opens.
- **Drawer.** Clicking a row opens `.armory-drawer-box` over the bottom of the workspace, right of the dock, never over the rail. Until it is dragged, its top edge meets the top of the traffic section (the box's top equals the `Traffic n items` section's top, border included), so the editor and `Run settings` don't move; with the traffic section folded it opens at 38 % of the workspace. Dragging its top edge (`.armory-drawer-resize`, title `Drag to resize the drawer`) sets its share of the workspace from 15 % to 85 %, read back from the box's inline `height`; the share survives closing and page visits, opening another project puts it back to the default, and the handle is hidden while maximised. It holds the request (`.armory-drawer-request`) and the response (`.armory-drawer-response`) side by side; when the panes are under 480 px wide (`.armory-drawer-panes[data-stacked=true]`) the request sits over the response. On its left is the icon rail (`.armory-drawer-rail`) or, after `Show the details`, the 240 px details column (`.armory-drawer-column`, `Collapse the details`): `#N`, the facts (`.armory-drawer-facts`), `LINKED` findings and test cases (hover a link for its unlink ×), and `Actions`: `Copy request`, `Copy response`, `Copy URL` and `More actions`. Both carry `Previous request`, `Next request` (they step in the table's order; grouped, through the open pair's group only, and each is `disabled` at that group's or the run's end; Next reads the next page when it needs to), `Maximise the drawer`/`Restore the workspace`, and `Close the drawer`. Esc closes it wherever focus is, unless a modal, the Marasi menu or the row menu is open: those close first, one Esc each.
- **Row menu.** Right-clicking a selected row targets the whole Selection (the header reads `3 requests`, `lp-new` reads `New launchpad with 3 entries`, the launchpad is named `3 requests` with description `Launchpad for Requests 4, 5, 6`); right-clicking an unselected row targets that row alone and keeps the Selection. Right-clicking a row, or the drawer's `Actions` / `More actions` (always the open pair), opens the Ledger's `.ledger-row-menu` pared down to `Send to Launchpad` (`lp-new`, `lp-add`), `Finding` and `Test case` (`f-new`/`t-new`, `f-link`/`t-link`, `f-unlink`/`t-unlink`). Its footer has no `⇧-click to extend` hint. Toasts: `Sent to a new launchpad` (named `Request <n>`), `Saved finding`, `Saved test case`, `Linked to test case "<title>"`, `Unlinked from test case "<title>"`.

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

**Sorting by Length.** Seed a run whose responses differ in length: the seed recipe with template `GET /probe?size=@@x@@ HTTP/1.1` and a wordlist of 250 shuffled numbers (`seq 1 250 | sort -R`). Watched live in # order, the run's pairs join the end, so it reads `250 items`. A sort reads from the top, 200 rows at a time:

```json
{"name":"sort-length","steps":[
 {"click":"[role=grid] [role=columnheader]","hasText":"Length"},
 {"waitSelector":"[role=columnheader][aria-sort=ascending]"},{"waitText":"200+ items"},
 {"click":"[role=grid] [role=columnheader]","hasText":"Length"},
 {"waitSelector":"[role=columnheader][aria-sort=descending]"},{"waitText":"/probe?size=250"},
 {"wheel":"[role=grid]","deltaY":20000},{"waitText":"250 items"},
 {"click":"[role=grid] [role=columnheader]","hasText":"Length"},
 {"waitNoSelector":"[role=columnheader][aria-sort=descending]"}]}
```

`Next request` in the drawer then steps in the sorted order. `hasText` matches substrings, so `/probe?size=2` also matches `size=25…`; pick a row by its number and time (`"207 09:28:30"`) read from the `-after.json` text. To see arrivals wait, sort by Length and `Launch` again: the new run's first pairs read straight into the empty table, later ones wait behind `n new · Show`, and the rows plus `n` add up to the run. The proxy's own `502 Bad Gateway` pairs store length 0, so they sort as the shortest, and the Length cell is blank.

**Grouping a run with mixed statuses and lengths.** `bench-server.py` only answers 200, so run a scratch server outside the repo that answers `GET /s/<status>/<size>` with that status and a `<size>`-byte body (on 127.0.0.1:18998), seed a wordlist such as 30× `404/1245`, 6× `403/1245`, 2× `403/990`, 2× `200/512`, `404/1251` and `500/88` (`sort -R`), and use the seed recipe with template `GET /s/@@x@@ HTTP/1.1` and `Host: 127.0.0.1:18998`. Under concurrency 10 the proxy answers a few probes `502` with length 0, so the counts vary run to run; read them from `-after.json`. Then:

```json
{"name":"group","steps":[
 {"click":"[role=radiogroup] [role=radio]","hasText":"Status"},{"waitSelector":"[role=radio][aria-checked=true]","hasText":"Status"},
 {"click":"[role=grid] button[aria-expanded=false]","hasText":"404"},{"waitSelector":"[role=grid] button[role=row]","hasText":"/s/404/1245"},
 {"text":"Collapse all"},{"waitNoSelector":"[role=grid] button[role=row]"},
 {"text":"Expand all"},{"waitSelector":"[role=grid] button[role=row]","hasText":"/s/404/1245"},
 {"click":"[role=radiogroup] [role=radio]","hasText":"Length"},{"waitText":"1,245 B"},
 {"click":"[role=grid] [role=columnheader]","hasText":"Length"},{"waitSelector":"[role=columnheader][aria-sort=ascending]"}]}
```

Prefix `{"key":"cmd+u"},{"waitSelector":"html.dark"}` for the dark theme.

Stepping within a group: grouped by status with everything expanded, open a group's first row (pick it with `nth`, counted from the `-after.json` text), `Show the details`, then `Next request` or `⌘⇧]` until the column reads the group's last `#N`. There `.armory-drawer-column [aria-label="Next request"][disabled]` matches and another `⌘⇧]` leaves `#N`; a `⌘⇧[` then steps back inside the group. At the group's first row `Previous request` is disabled.

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

**Selection to a new launchpad.** On the seeded run (8 paths; read the row order from `-after.json`, here `/orders`, `/status`, `/items` were adjacent):

```json
{"name":"selection","steps":[
 {"click":"[role=grid] button[role=row]","hasText":"/orders?size"},
 {"waitSelector":".armory-drawer-box"},{"key":"escape"},{"waitNoSelector":".armory-drawer-box"},
 {"click":"[role=grid] button[role=row]","hasText":"/items?size","modifiers":["shift"]},
 {"waitText":"3 selected · right-click for actions"},
 {"click":"[role=grid] button[role=row]","hasText":"/status?size","button":"right"},
 {"waitSelector":".ledger-row-menu"},{"hover":".ledger-row-menu [data-menu-item=launchpad]"},
 {"waitText":"New launchpad with 3 entries","within":"[data-menu-item=lp-new]"},
 {"click":"[data-menu-item=lp-new]"},{"waitText":"Sent to a new launchpad"}]}
```

Then `select r.path from launchpad_request lr join request r on r.id = lr.request_id` lists the three paths. The drawer opens over the traffic section and hides the rows; to see the open pair's frame with rows beside it, shrink the drawer first: `{"drag":".armory-drawer-resize","to":".armory-drawer-box","toEdge":"bottom"}`.

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
