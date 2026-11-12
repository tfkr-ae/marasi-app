# Launchpad: send, launch, cancel, compare, search and the tree

## Driving it with Chrome CDP

Run `scripts/drive.sh launchpad` for route proof. It requires `Group by status`, which the dock paints on every visit (the dock always mounts expanded). A `launchpad` drive therefore fails while the dock is collapsed to its strip: expand it (or start the recipe before collapsing) first. Proven handoff from Ledger:

```json
{"name":"send-to-launchpad","steps":[
 {"click":".ledger-row","hasText":"/compass-allowed"},{"waitSelector":".ledger-drawer"},
 {"key":"cmd+shift+l"},{"waitText":"to a new launchpad"},
 {"text":"Jump to Launchpad"},{"waitPath":"/launchpad"},{"waitNoSelector":".ledger-drawer"},
 {"waitText":"Group by status"}]}
```

The Ledger keeps its selection, so its drawer is open again on the next Ledger visit; close it there before the next Ledger recipe.

Both Ledger paths, `⌘⇧L` with one row selected and the row menu's `Send to Launchpad › New launchpad`, create a launchpad named `Request N`, and their toast's `Jump to Launchpad` opens `/launchpad?id=<id>`. The page opens that launchpad, selects its newest entry, opens its row even after `Collapse all`, and scrolls it into view. The previously open launchpad is not reselected. This also works when the toast is clicked while `/launchpad` is already open. If the id no longer exists, the page shows `That launchpad no longer exists.` and keeps the current launchpad. Other launchpads can already show `entry 1 of 1`, so wait on the sent path instead:

```json
{"name":"right-click-jump","steps":[
 {"click":".ledger-row","hasText":"/seed-7","button":"right"},{"click":"[data-menu-item=launchpad]"},{"click":"[data-menu-item=lp-new]"},{"waitText":"to a new launchpad"},
 {"text":"Jump to Launchpad"},{"waitPath":"/launchpad"},
 {"waitText":"/seed-7","within":".lp-editor"},{"waitSelector":".lp-entry[aria-current=true]"}]}
```

Right-click only a row that is already in view, so the driver does not scroll the table under the open menu.

Then, on Launchpad, edit the draft and Launch:

```json
{"name":"edit-and-launch","steps":[
 {"click":"div[role=switch]:has(input[name=\"TLS Toggle\"])"},
 {"waitSelector":"div[role=switch][aria-checked=false]:has(input[name=\"TLS Toggle\"])"},
 {"click":".lp-editor .cm-content"},{"key":"cmd+a"},
 {"insert":"GET /launchpad-replay HTTP/1.1\nHost: 127.0.0.1:18099\n\n"},
 {"waitText":"Revert draft"},{"waitText":"Request draft","within":".lp-request-title"},{"waitSelector":".lp-row:has([title=\"Unsaved draft\"])"},
 {"click":".lp-launch"},{"waitText":"Request launched"},
 {"waitText":"entry 2 of 2","timeoutMs":15000},
 {"waitText":"verification-response /launchpad-replay","within":".lp-response"},
 {"waitNoText":"Revert draft"}]}
```

Launches are tracked. `Launch` returns a launch id that is the new entry's UUID; the entry is selected when its request arrives and stays pending until Marasi reports how it ended. While the open launchpad has a pending launch, the top bar's `Launch` (`.lp-launch`) becomes `Cancel` (`.lp-cancel`, spinner) in the same place. Entry rows carry `data-launch="pending|completed|cancelled|failed"`: pending shows a spinner, cancelled a ban icon, failed an alert icon whose title ends `· Failed: <reason>`; completed rows show the status code as before. The `Response` pane reads `Waiting for the response…` while pending, `Cancelled — no response` for a cancelled entry, and `Failed: <reason>` (for example `upstream_error` for a closed port) for a failed one. Keep a launch pending with a slow origin: copy the endpoint and delay its answer on `?sleep=<seconds>`, abandoning the timer when the client closes. Proven sequence, after a launchpad with HTTPS off exists:

```json
{"name":"launch-cancel","steps":[
 {"click":".lp-editor .cm-content"},{"key":"cmd+a"},
 {"insert":"GET /slow?sleep=60 HTTP/1.1\nHost: 127.0.0.1:18099\n\n"},
 {"click":".lp-launch"},{"waitText":"Request launched"},
 {"waitSelector":".lp-cancel"},{"waitSelector":".lp-entry[data-launch=pending]"},
 {"click":".lp-topbar"},{"key":"cmd+shift+."},
 {"waitSelector":".lp-launch"},{"waitSelector":".lp-entry[data-launch=cancelled]"},
 {"waitText":"Cancelled — no response","within":".lp-response"},
 {"click":".lp-editor .cm-content"},{"key":"cmd+a"},
 {"insert":"GET /closed HTTP/1.1\nHost: 127.0.0.1:18097\n\n"},
 {"click":".lp-launch"},
 {"waitSelector":".lp-entry[data-launch=failed][aria-current=true]","timeoutMs":20000},
 {"waitText":"Failed: upstream_error","within":".lp-response"}]}
```

Prove outcomes persisted with `select r.path, r.status_code, json_extract(r.metadata,'$.launch') from launchpad_request lr join request r on r.id=lr.request_id` (a cancelled launch stores its request with status `-1` and `{"status":"cancelled"}`; a closed port stores `502` with `{"reason":"upstream_error","status":"failed"}`). Switching projects or quitting ends pending launches as `failed` with reason `interrupted`.

Compare, with three entries and entry 3 selected (`Compare` stays disabled below two entries). Entry rows carry `data-compare="A"`/`"B"`; chips are `.lp-chip[data-side=left|right]`. Stored request lines use absolute URLs (`GET http://127.0.0.1:18099/… HTTP/1.1`), so wait on `/path HTTP/1.1`, not `GET /path`. The tab buttons render `capitalize`d lowercase text; match them with `hasText:"equest"`. The diff is a `@codemirror/merge` MergeView inside `.lp-diff`: changed lines carry `.cm-changedLine`, and each collapsed unchanged run is a `.cm-collapsedLines` bar (`⦚ N unchanged lines ⦚`) that expands on click. A 3-line request with one changed line has no collapsed run, so give the entries a longer body or skip that step.

```json
{"name":"compare","steps":[
 {"text":"Compare"},{"waitText":"click any entry in the sidebar"},{"waitSelector":".lp-entry[data-compare=\"A\"]"},
 {"text":"Previous (#2)"},{"waitSelector":".lp-diff"},{"waitSelector":".lp-entry[data-compare=\"B\"]"},
 {"click":".lp-diff .cm-collapsedLines"},{"waitNoSelector":".lp-diff .cm-collapsedLines"},
 {"click":".lp-compare-strip button","hasText":"equest"},
 {"click":".lp-chip[data-side=\"left\"]"},{"waitText":"to use as the new A"},
 {"click":".lp-entry","hasText":"/cmp-one"},{"waitText":"#1","within":".lp-chip[data-side=\"left\"]"},
 {"text":"Swap A and B"},{"waitText":"#1","within":".lp-chip[data-side=\"right\"]"},
 {"click":".lp-chip[data-side=\"right\"]"},{"key":"escape"},{"waitNoText":"to use as the new B"},
 {"key":"escape"},{"waitNoSelector":".lp-compare-strip"},{"waitNoSelector":"[data-compare]"}]}
```

Search. The `Search launchpads` box matches launchpad names and descriptions locally on every keystroke; a match lists the whole launchpad. For entries it asks Marasi 250 ms after the last keystroke, only for 3 or more characters (shorter text shows `Type 3 or more characters to search entries.`), through the `SearchLaunchpadEntries` binding: the text, trimmed, becomes one quoted literal searched in `request_head` (request line plus headers, so method, path and host match), `request_body`, `response_head` and `response_body`, case-insensitively. Each launchpad with matches lists `N matching entries` (`.lp-match-count`) and only those entries, Ledger-linked pairs included. `Searching entries…` shows while a query is in flight; an invalid query or failed search shows its message in `.lp-search-error` under the box. Quotes, backslashes, `OR`, `)`, `NEAR(` and `launchpad = "x"` in the text match literally. Seed a term that appears only in a response body with a copy of the endpoint that appends a fixed word to the body (not the URL), proxy one request with it through the Ledger and `Send to Launchpad`, and launch another from a second launchpad. Proven, with `zebracorn` only in the bodies of `/orig-one?withsecret=1` (Request 1's first entry, sent from the Ledger) and `/launched-b?withsecret=1` (Request 3's second entry):

```json
{"name":"search-body","steps":[
 {"click":"input[aria-label=\"Search launchpads\"]"},{"insert":"zebracorn"},
 {"waitText":"/launched-b?withsecret=1","within":".lp-scroll"},{"waitText":"/orig-one?withsecret=1","within":".lp-scroll"},
 {"waitNoText":"/launched-c","within":".lp-scroll"},{"waitText":"1 matching entry","within":".lp-scroll"}]}
```

The editors also carry `.lp-scroll`, so `waitNoText` within it also reads the open entry's request; pick a path the open entry does not show. Hostile text (`x" OR "1 ) NEAR( launchpad = "y" \`) settles on `No matching launchpads or entries` with no `.lp-search-error`.

Tree, prompts and dock:

```json
{"name":"tree","steps":[
 {"text":"Show 4 more"},{"waitNoText":"earlier entries"},
 {"click":"div[role=switch]:has(input[name=\"Group by status\"])"},{"waitSelector":".lp-group"},
 {"click":".lp-group","hasText":"200"},
 {"click":"input[aria-label=\"Search launchpads\"]"},{"insert":"replay-1"},{"key":"escape"},
 {"click":".lp-entry","hasText":"/replay-13"},{"waitText":"Discard the draft?"},{"text":"Confirm"},
 {"text":"New launchpad"},{"insert":"Scratch pad"},{"key":"enter"},{"waitText":"Empty launchpad"},
 {"text":"Delete launchpad"},{"waitText":"Delete Scratch pad?"},{"text":"Confirm"},
 {"text":"Collapse sidebar"},{"waitSelector":".lp-strip"},{"text":"Show launchpads"},{"waitSelector":".lp-dock"}]}
```

`End of <launchpad>` appears at the bottom of the tree while the list holding the row at the top of the tree (under the sticky launchpad row) has its last entry cut off, so it needs one list longer than the tree (about 24 rows at 1600x900). The tree measures this after each render and on `scroll`, but the hidden headless page never fires `scroll` events (they run on animation frames), so after scrolling with `wheel`, cause a render, for example by clicking a visible entry. Proven with a 26-entry launchpad `22 requests` (Ledger ⌘A, `⌘⇧L`, then four launches), every other launchpad collapsed:

```json
{"name":"end-of","steps":[
 {"wheel":"[data-launchpad-tree]","deltaY":-40},
 {"click":".lp-entry","hasText":"/a5","within":"[data-launchpad-tree]"},{"waitText":"entry 5 of 26"},
 {"waitText":"End of 22 requests"},
 {"click":"button[title=\"Jump to the end of 22 requests\"]"}]}
``` Drag-resize with `{"drag":".lp-resize","to":"<css>"}`: dropping on a control to the right widens the dock, and dropping on the rail (`[title="Ledger"]`) collapses it. `.lp-resize` takes no layout width: it is an 8px grab area drawn over the dock's border, so hovering it changes only that strip's colour.

Prove linkage and entry order with `select l.name, r.path, r.status_code, lr.position from launchpad l join launchpad_request lr on lr.launchpad_id=l.id join request r on r.id=lr.request_id order by l.name, lr.position`. `position` is Marasi's fractional order key (text such as `a0`, `a3G`, `Zz`): order by it, never by the pair. Proxied traffic can no longer be tagged for a launchpad (Marasi PR #28 removed `x-launchpad-id`), so the `+1` unseen badge needs a launch whose request arrives after another launchpad is opened; the store tests cover it, and no driver sequence for it is proven yet.
