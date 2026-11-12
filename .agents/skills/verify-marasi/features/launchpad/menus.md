# Launchpad: the entry and launchpad menus, records, browser view and moves

## Entry selection, moves and the entry menu

**Entry menu.** Right-click an entry: outside the selection it becomes the selection, without reseeding. The menu is the Ledger's `.ledger-row-menu`: a header (`#n`, method, status and URL for one entry; `N entries · in <launchpad>` with method and status counts for several), then `[data-menu-item=move]` (`Move N to launchpad`, a submenu `Adds at the end` listing the other launchpads with counts, each greyed with its refusal as the `title`), `top`, `up`, `down`, `bottom` (greyed `Already first`/`Already last`, `Grouped by status` or `Searching`), `browser-view` (`Copy browser view URL`, greyed `One entry at a time` for several, `No response yet` for a pending or cancelled entry, `Not for a WebSocket upgrade` for a `101`), `finding` and `testcase` (see below), and `remove` (`Remove N from launchpad`, greyed `N launching`). A pending entry greys `move` itself, so its submenu does not open. Disabled items cannot be hovered by the driver; read their `title` from the capture instead.

**Findings and test cases.** The entry menu's `[data-menu-item=finding]` and `[data-menu-item=testcase]` act on the entry selection's requests; the launchpad menu's act on all of that launchpad's entries. Each is a submenu with `f-new`/`t-new` (`New finding from this request`, or `New finding with N requests`), which opens the Logbook record modal (`[data-record-modal=finding]` or `testCase`, see `logbook.md`) with those requests linked on Save and close, then `f-link`/`t-link` (`Link to finding ›`, listing the project's records as `[role=menuitemcheckbox]`: checked when every request is linked, which greys it as `Already linked`; mixed when some are) and `f-unlink`/`t-unlink` (`Unlink from finding ›`) when any is linked. Linking toasts `Linked N requests to finding "<title>"`, counting only the requests not yet linked; read `finding_requests` and `test_case_requests` to prove it. With focus in the tree, `⌘⇧F` and `⌘⇧B` open the same modal for the selection. Proven on a launchpad `3 requests` (Ledger ⌘A then `⌘⇧L` over `/o1.html`, `/o2.html`, `/o3.html`), in this order:

```json
{"name":"tree-create-finding","steps":[
 {"click":".lp-entry","hasText":"/o1.html","within":"[data-launchpad-tree]"},{"key":"cmd+a"},{"waitSelector":".lp-entry[data-selected=true]","hasText":"/o3.html"},
 {"key":"cmd+shift+f"},{"waitSelector":"[data-record-modal=finding]"},{"click":"input[placeholder=\"Finding title\"]"},{"insert":"LP finding A"},
 {"text":"Save and close"},{"waitNoSelector":"[data-record-modal]"},{"waitText":"Finding created"}]}
```

```json
{"name":"entry-menu-records","steps":[
 {"click":".lp-entry","hasText":"/o2.html","within":"[data-launchpad-tree]"},{"waitText":"entry 2 of 3"},
 {"click":".lp-entry","hasText":"/o2.html","within":"[data-launchpad-tree]","button":"right"},{"hover":".ledger-row-menu [data-menu-item=finding]"},
 {"waitText":"New finding from this request","within":".ledger-row-submenu"},{"hover":"[data-menu-item=f-link]"},
 {"waitSelector":".ledger-row-submenu[data-menu-level=\"2\"] [role=menuitemcheckbox][aria-checked=true][aria-disabled=true]"},
 {"key":"escape"},{"key":"escape"},{"key":"escape"},{"waitNoSelector":".ledger-row-menu"},
 {"click":".lp-entry","hasText":"/o2.html","within":"[data-launchpad-tree]","button":"right"},{"hover":".ledger-row-menu [data-menu-item=testcase]"},
 {"click":".ledger-row-submenu [data-menu-item=t-new]"},{"waitSelector":"[data-record-modal=testCase]"},
 {"click":"input[placeholder=\"Test case title\"]"},{"insert":"LP case 1"},{"text":"Save and close"},{"waitNoSelector":"[data-record-modal]"}]}
```

Right-clicking inside a selection keeps it, so with all three selected the submenu reads `New finding with 3 requests`; click one entry first. A launch-free `⌘⇧B` check: click an entry, `{"key":"cmd+shift+b"},{"waitSelector":"[data-record-modal=testCase]"},{"text":"Close without saving"}`.

**Launchpad menu.** Right-click a launchpad row (`.lp-row`): the same `.ledger-row-menu` with `finding` and `testcase` over all its entries (greyed with `title="No entries"` on an empty launchpad), then `rename` (`Rename…`: a prompt `Rename launchpad`, `[data-testid=modal][aria-label="Rename launchpad"] .modal-prompt-input`, focused and holding the name, submitted with `Rename`) and `delete` (`Delete launchpad`, greyed `Launching: cancel or wait` while a launch from it is pending; it confirms `Delete <name>?`). The row is outlined while its menu is open; the open launchpad, its draft and the entry selection do not change. Proven after the recipes above:

```json
{"name":"launchpad-menu","steps":[
 {"click":".lp-row","hasText":"3 requests","button":"right"},{"hover":".ledger-row-menu [data-menu-item=testcase]"},
 {"hover":".ledger-row-submenu [data-menu-item=t-link]"},{"click":".ledger-row-submenu[data-menu-level=\"2\"] button","hasText":"LP case 1"},
 {"waitText":"Linked 2 requests to test case \"LP case 1\""},{"waitNoSelector":".ledger-row-menu"},
 {"click":".lp-row","hasText":"3 requests","button":"right"},{"click":".ledger-row-menu [data-menu-item=rename]"},
 {"waitSelector":"[data-testid=modal][aria-label=\"Rename launchpad\"] .modal-prompt-input:focus"},{"key":"cmd+a"},{"insert":"Origin trio"},
 {"text":"Rename","within":"[data-testid=modal] footer"},{"waitNoSelector":"[data-testid=modal]"},{"waitSelector":".lp-row","hasText":"Origin trio"},
 {"text":"New launchpad"},{"insert":"Scratch pad"},{"key":"enter"},{"waitText":"Empty launchpad"},
 {"click":".lp-row","hasText":"Scratch pad","button":"right"},{"waitSelector":".ledger-row-menu [data-menu-item=finding][aria-disabled=true]"},
 {"click":".ledger-row-menu [data-menu-item=delete]"},{"waitText":"Delete Scratch pad?"},{"text":"Confirm"},{"waitNoText":"Scratch pad","within":"[data-launchpad-tree]"}]}
```

`waitNoSelector` ignores `hasText`, so wait for a row's absence with `waitNoText` within the tree.

**Browser view URL.** With an entry open, the Response header has `Browser view` (`.lp-browser-view`, disabled with the same reason as its `title`), and `⌘⇧V` (`launchpad.copy-browser-view-url`; it yields to a focused editor, so click `.lp-topbar` first) runs it: both copy `http://marasi/view/<entry uuid>` and toast `Copied the browser view URL. Open it in a browser that uses Marasi's proxy`; on a pending entry `⌘⇧V` only toasts `No response yet`. Through the proxy that URL answers `302` to the pair's original URL, and the stored response is served there without contacting the origin (marasi `docs/adr/2026-10-20-a-browser-view-serves-the-stored-response-once-at-its-original-url.md`): `curl -s -L -x 127.0.0.1:<proxy port> http://marasi/view/<uuid>` returns the stored body and the origin logs no request. Proven:

```json
{"name":"browser-view-header","steps":[
 {"waitSelector":".lp-browser-view:not([disabled])"},{"click":".lp-browser-view"},{"waitText":"Copied the browser view URL","within":".snackbar-wrapper"},
 {"click":".lp-topbar"},{"key":"cmd+shift+v"},{"waitText":"Copied the browser view URL","within":".snackbar-wrapper"},
 {"click":".lp-entry","hasText":"/launchpad-replay","button":"right"},{"waitSelector":".ledger-row-menu [data-menu-item=browser-view]:not([disabled])"},
 {"click":"[data-menu-item=browser-view]"},{"waitText":"Copied the browser view URL","within":".snackbar-wrapper"}]}
```

During `launch-cancel`, while the entry is pending: `{"waitSelector":".lp-browser-view[disabled][title=\"No response yet\"]"},{"click":".lp-topbar"},{"key":"cmd+shift+v"},{"waitText":"No response yet","within":".snackbar-wrapper"}`.

```json
{"name":"menu-move","steps":[
 {"click":".lp-entry","hasText":"/b1","modifiers":["cmd"]},
 {"click":".lp-entry","hasText":"/a5","modifiers":["cmd"]},
 {"click":".lp-entry","hasText":"/a5","button":"right"},{"waitSelector":".ledger-row-menu"},
 {"hover":"[data-menu-item=move]"},{"waitSelector":".ledger-row-submenu"},
 {"click":".ledger-row-submenu button","hasText":"Gamma"},{"waitNoSelector":".ledger-row-menu"}]}
```

Order items and keys, with the selection in the second launchpad: `{"click":".lp-entry","hasText":"/b3","button":"right"},{"click":"[data-menu-item=top]"},{"waitText":"/b3","within":"[data-launchpad]:nth-child(2) .lp-entry:nth-child(2)"},{"key":"cmd+shift+down"},{"key":"cmd+shift+up"},{"key":"cmd+down"},{"key":"cmd+up"}`. The right-click focuses the tree, so the keys reach it. `[data-launchpad]:nth-child(k) .lp-entry:nth-child(p+1)` is the entry at position `p` (the launchpad row is the first child). `remove` unlinks the selection from this launchpad only; the pairs stay in the project and in other launchpads.

**The draft follows its entry.** When a move takes the entry a launchpad's draft was seeded from to another launchpad, the draft goes with it, dirty or not, and the source reseeds from its last entry (or shows `Empty launchpad`). If that was the open launchpad's draft, the open launchpad switches to the target; otherwise it stays. A clean target draft is replaced silently; a dirty one asks `Discard the draft?` (`The target launchpad's draft has unsaved edits. The draft moving with its entry replaces them.`), and Cancel cancels the move. Proven, with Alpha open on its draft entry `/slow…` and Gamma's draft dirty:

```json
{"name":"draft-follows","steps":[
 {"click":".lp-editor .cm-content"},{"key":"cmd+a"},
 {"insert":"GET /dirty-follows HTTP/1.1\nHost: 127.0.0.1:18099\n\n"},{"waitText":"Revert draft"},
 {"drag":".lp-entry","hasText":"/slow","to":".lp-row","toHasText":"Beta"},
 {"waitText":"Beta","within":".lp-topbar"},{"waitText":"/dirty-follows","within":".lp-editor"},
 {"drag":".lp-entry","hasText":"/slow","to":".lp-row","toHasText":"Gamma"},
 {"waitText":"Discard the draft?"},{"text":"Confirm"},
 {"waitText":"Gamma","within":".lp-topbar"},{"waitText":"/dirty-follows","within":".lp-editor"}]}
```

Open a launchpad by its name button, `{"click":".lp-row button.flex-1","hasText":"Alpha"}`; the row's other button is the chevron (`aria-label="Expand Alpha"`/`"Collapse Alpha"`).
