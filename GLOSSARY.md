# Marasi App

The desktop app for Marasi. It presents a project's traffic and the proxy's tools to a researcher. Terms Marasi itself defines, such as traffic, request/response pair, and query, keep Marasi's meaning here.

## Language

### Ledger

**Ledger**:
The app's table of the open project's traffic.
_Avoid_: history, HTTP history, proxy items

**Live view**:
The ledger with no query: every request/response pair, with new traffic appearing at the top as it is captured. Sorted any other way than newest first, new traffic waits as new matches instead, so rows never move under the researcher.
_Avoid_: unfiltered view, all items

**Pair number**:
A pair's number in its project, shown as `#` and in "Request N". Marasi assigns it at capture, in capture order, from 1. It never changes and is never reused, so deleted pairs leave gaps, and a pair keeps it under any query, sort or content-type exclusion. The live view lists pairs by pair number, newest first.
_Avoid_: index, row number, position

**Query**:
A text expression that narrows the ledger to the request/response pairs that match it, as Marasi defines it. The ledger's current query is not stored; a researcher keeps one by making it a saved query.
_Avoid_: search, search string, filter, FTS

**Saved query**:
A named query a researcher keeps for reuse and applies by choosing it. It belongs to one project, or to the app so every project offers it; some ship with the app.
_Avoid_: saved search, saved filter, bookmark

**Highlight**:
A number from 1 to 8 that a researcher puts on a request/response pair to mark it, as Marasi defines it. A pair has at most one highlight, and it stays with the pair in the project. The app shows each number as a colour, set for all projects, and a highlight label. A researcher can choose the ledger's pairs by highlight through the query.
_Avoid_: tag, mark, slot, colour filter

**Highlight label**:
The name that gives a highlight colour its meaning to the researcher, such as "IDOR candidate". It defaults to the colour's own name. A project can give a colour its own label, which wins over the app's. Renaming a label or changing its colour does not change which pairs carry that highlight.
_Avoid_: preset, tag name

**Sitemap**:
The project's traffic as a tree, first by origin and then by path segment, with a count of pairs and of server errors at each node, as Marasi defines it. The ledger shows it beside the table; choosing a node narrows the query to that node and everything under it.
_Avoid_: site tree, target tree

**Selection**:
The pairs a researcher has picked in the ledger for a context-menu action to apply to together, as Marasi defines it: either particular pairs, or every pair in the query results up to the newest one the researcher has seen, including pairs not scrolled into view. New matches are not in it until the researcher shows them.
_Avoid_: checked rows, marked rows, batch

**Drawer**:
The ledger's pane, below the table, that shows one pair's request and response side by side.
_Avoid_: inspector, detail view

**Query results**:
The request/response pairs that match the ledger's current query, newest first.
_Avoid_: search results, filtered items

**New matches**:
Request/response pairs that match the current query but arrived or started matching after the query results were shown. They join the query results only when the researcher asks.
_Avoid_: updates, live results

**Content-type exclusion**:
The list of content types the ledger hides, in both the live view and query results, as Marasi defines it: each type exact or a whole major type such as `image/*`. A project follows the app's default list until the researcher changes the project's own list. A pair with no content type yet is never hidden by it.
_Avoid_: filter, content type filter

### Launchpad

**Launchpad entry**:
An ordinary request/response pair linked to a launchpad rather than copied. A launchpad's entries are a flat list in the launchpad's entry order.
_Avoid_: member, tab, request when referring to the linked pair, original

**Entry order**:
The order of a launchpad's entries, which only the researcher changes. Every entry a launchpad gains, by a Launch or a link, goes last; existing entries keep their capture order until the researcher reorders them.
_Avoid_: position, index, sort, timeline

**Entry selection**:
The launchpad entries a researcher has picked in one launchpad, to move or remove together. It never spans two launchpads, and it is separate from the ledger's selection.
_Avoid_: selection, checked entries

**Move**:
Taking launchpad entries out of one launchpad and putting them into another at a chosen place, or into a new place in the same launchpad. A moved pair is never left in both, so a move into a launchpad that already holds one of the pairs is refused. An entry whose Launch is still pending cannot move to another launchpad.
_Avoid_: copy, transfer, relink

**Launchpad draft**:
The working request of a launchpad, held only in memory, seeded from one launchpad entry and sent by Launch. It is dirty when it differs from the request of the entry it was seeded from, and it is lost when the project closes. When that entry moves to another launchpad, the draft moves with it. Marasi asks for confirmation only before something discards a dirty draft, such as seeding over it, removing its entry, deleting its launchpad, or switching the project or quitting. A clean draft is replaced without asking, and Cancel changes nothing. Switching the project or quitting asks once for all dirty drafts.
_Avoid_: edit, buffer, saved request

### Checkpoint

**Checkpoint item**:
A request, response or WebSocket message that Checkpoint holds, as Marasi defines it. The app lists every held item in hold order, oldest first, and the researcher can forward or drop any of them in any order.
_Avoid_: intercepted item, intercept, queue item, paused request
_Note_: The UI copy says "Intercepted" by design, and the time an item was held is named `InterceptedAt`; elsewhere, say Checkpoint item.

**Hold**:
What Checkpoint does to an item until the researcher forwards it, the researcher drops it, or its client leaves. A held item is "held", not "intercepted".
_Avoid_: intercept, pause, catch
_Note_: The UI copy keeps "intercepted" and "Intercept" by design ("Nothing intercepted", "Forward + intercept response"), as does `InterceptedAt`; elsewhere, say hold.

**Intercept all**:
The switch that makes Checkpoint hold every request and response, whatever its rules say. The name is the UI's, kept by design.
_Avoid_: hold all, intercept mode

**Forward**:
Releasing a held item to continue on its way, with any edits the researcher made to it.
_Avoid_: send, release, continue, accept

**Drop**:
Ending a held item so it never reaches its destination. Marasi drops an item itself when its client leaves.
_Avoid_: discard, cancel, block, reject

### Marasi menu keybindings

**Menu action**:
A Marasi-defined operation exposed through the Marasi menu, such as navigating to a page or focusing an editor. Its behavior and availability are not changed by rebinding its keys.
_Avoid_: editable action, user-defined command

**Menu context**:
A Marasi-defined page or interface state that determines which menu actions are available, such as Ledger with its drawer open or closed.
_Avoid_: keybinding mode

**Keybinding profile**:
A named collection of bindings for Marasi menu actions that a researcher can select and customize. Factory defaults remain recoverable independently of those customizations.
_Avoid_: Vim mode, Chrome profile

### Updates

**Channel**:
The stream of builds an installed app follows: release or nightly. An app starts on the channel of the build that was installed, and a researcher can switch it. A development build has no channel.
_Avoid_: track, ring, stable, beta

**Release**:
A build of Marasi App from main, named by the date it was cut.
_Avoid_: main release, stable release

**Nightly**:
The latest daily build of Marasi App. Only one nightly exists at a time; each one replaces the last.
_Avoid_: beta, preview, snapshot

**Update**:
A build on the app's channel that is newer than the running one and replaces it once the researcher installs it. It is never an older build; going back to an older release is a reinstall.
_Avoid_: upgrade, patch; not to be confused with new matches

### Projects

**Scratchpad**:
The project the app opens at startup, kept in the app's config directory. A researcher works in it until they open another project.
_Avoid_: default project, temporary project

**Locked project**:
A project the app can't open because another Marasi, an app or a service instance, holds its project ownership as Marasi defines it. It stays locked until that Marasi closes it. Opening a locked project leaves the open project as it was; a locked scratchpad at startup leaves no project open.
_Avoid_: project lock (Marasi's file lock behind ownership), in use, busy (Marasi's project busy is work blocking a switch)

**Database upgrade**:
The one-time step that brings an older project's database up to the running build, which Marasi runs as it opens the project. The app shows it as the Upgrade step while opening.
_Avoid_: migration in what researchers see; not to be confused with an update

**Upstream proxy**:
A named proxy on this machine that a project's traffic goes through on its way to the origin, as Marasi defines it. The list is shared by every project on the machine; each project selects at most one, or none for a direct connection. A request the selected upstream proxy can't carry fails and is never sent direct.
_Avoid_: upstream on its own (it means the origin), proxy chain, outbound proxy
