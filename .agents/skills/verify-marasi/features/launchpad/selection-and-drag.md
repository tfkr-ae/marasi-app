# Launchpad: entry selection, drag and refusals

## Entry selection, moves and the entry menu

Seed two or more launchpads with a few launched entries each (`Alpha` with `/a1`…`/a5`, `Beta` with `/b1`…`/b3`), and a launchpad that shares pairs with them (Ledger ⌘A, then `⌘⇧L`) for the `already in` refusal. The recipes here and in `menus.md` ran in that order on one project. Expand the launchpads you drag between first (`Collapse all`, then `{"text":"Expand Alpha"}`); an open launchpad with the same paths makes `hasText` ambiguous.

**Entry selection.** A plain click selects one entry, opens its launchpad and seeds the draft (a dirty draft asks first). `⌘`-click toggles and `⇧`-click selects the range from the anchor; neither reseeds, so `entry X of N` stays. Selected rows carry `data-selected="true"` and a 3 px primary bar (`span.w-\[3px\]`) on the left; the draft's entry keeps `aria-current="true"`. The selection never spans two launchpads: a `⌘`-click in another launchpad starts a new selection there. `⌘A` selects the focused launchpad's entries, hidden ones included, and Esc collapses two or more to the anchor (the last `⌘`-clicked entry, or where a range started).

```json
{"name":"selection","steps":[
 {"click":".lp-entry","hasText":"/a1"},{"waitText":"entry 1 of 5"},
 {"click":".lp-entry","hasText":"/a3","modifiers":["shift"]},
 {"click":".lp-entry","hasText":"/a5","modifiers":["cmd"]},
 {"click":".lp-entry","hasText":"/a2","modifiers":["cmd"]},
 {"waitText":"entry 1 of 5"},{"key":"cmd+a"},{"key":"escape"}]}
```

Read the result from the capture: `.lp-entry[data-selected=true]` per step (a1–a3, then a1–a3 + a5, then a1, a3, a5, then all five, then only a2).

**Drag.** Press any entry row and move 5 px to start a drag. Dragging a selected entry drags the whole selection in entry order; an unselected one drags alone and becomes the selection, without reseeding the draft. While dragging, the dragged rows fade, a pill `.lp-drag-pill` follows the pointer (`N entries`, plus `· <reason>` when refused), and the drop point shows as `.lp-drop-line` (a 2 px line with a dot) on the top or bottom edge of the entry under the pointer: the top half inserts before that entry, the bottom half after it. Over a launchpad row (`.lp-row`) the row is tinted (`.lp-drop-row`) and the drop appends at the end; held over a collapsed launchpad's row for 0.6 s, it expands. `body[data-launchpad-drag]` is `move` or `refused` during a drag. Esc cancels. Use `hold` to see the drag in progress and `toEdge` to choose the half:

```json
{"name":"drag-reorder","steps":[
 {"click":".lp-entry","hasText":"/a1"},{"waitText":"entry 1 of 5"},
 {"click":".lp-entry","hasText":"/a2","modifiers":["shift"]},
 {"drag":".lp-entry","hasText":"/a1","to":".lp-entry","toHasText":"/a4","toEdge":"bottom","hold":true},
 {"waitSelector":".lp-drop-line"},{"waitText":"2 entries","within":".lp-drag-pill"},
 {"release":true},{"waitNoSelector":".lp-drag-pill"}]}
```

That leaves `a3, a4, a1, a2, a5`, renumbered `1`–`5`, with a1 and a2 still selected; check `launchpad_request.position`. To another launchpad, drop between its rows (`{"drag":".lp-entry","hasText":"/a5","to":".lp-entry","toHasText":"/b2","toEdge":"top"}` puts a5 before b2) or on its row (`"to":".lp-row","toHasText":"Gamma"` appends, and the collapsed target expands). After a move, the selection follows the moved entries and the target scrolls them into view; the open launchpad does not change unless the move takes its draft's entry (`menus.md`, "The draft follows its entry").

**Refusals.** A refused drop shows a not-allowed cursor, `· <reason>` on the pill and an error outline on a launchpad row, and releasing it changes nothing. Reasons: `N already in <launchpad>` when the target holds one of the pairs, `N launching` when a moving entry's launch from this launchpad is pending (to another launchpad only: reordering it within its launchpad works), and `Grouped by status` or `Searching` for any drop between rows or within the launchpad while the tree is grouped or searching (a drop on another launchpad's row still moves). Keep a launch pending with the slow origin (`GET /slow?sleep=600`, see "Launches are tracked" in `send-launch-compare.md`), then:

```json
{"name":"pending-drag","steps":[
 {"drag":".lp-entry[data-launch=pending]","to":".lp-row","toHasText":"Beta","hold":true},
 {"waitText":"1 launching","within":".lp-drag-pill"},
 {"key":"escape"},{"waitNoSelector":".lp-drag-pill"},{"release":true},
 {"drag":".lp-entry[data-launch=pending]","to":".lp-entry","toHasText":"/a3","toEdge":"top","hold":true},
 {"waitSelector":".lp-drop-line"},{"release":true},{"waitNoSelector":".lp-drag-pill"}]}
```

While the launch is pending, `Delete launchpad` in the top bar is disabled with `title="Launching: cancel or wait"`, and the Ledger greys `Delete` and that launchpad's `Remove from launchpad` item (see `../ledger/selection-and-row-menu.md`). For searching, the entry search needs 3 or more characters before entries list: `{"click":"input[aria-label=\"Search launchpads\"]"},{"insert":"18099/a"},{"waitText":"matching entries","within":"[data-launchpad-tree]"}`.
