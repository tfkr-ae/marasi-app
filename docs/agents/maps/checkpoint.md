# Checkpoint

Which files work together on the Checkpoint page, how a held item reaches the page and leaves it, and where a page action goes. Names are functions and files, so search for them. The UI says "intercepted"; the code and `GLOSSARY.md` say "held" (Checkpoint item, hold, Forward, Drop).

## Files

- `frontend/src/routes/checkpoint/+page.svelte` wires everything together: the dock, the workspace's Items | Rules switch, the toasts, Drop n's confirmation, ↑/↓, and `checkpointMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createCheckpointStore.js` holds the state, the selectors and the event reducers: the held items in hold order, the selection and picks, per-item edits and parse errors, and the bulk actions. It takes its API as an argument. `frontend/src/stores/checkpointStore.js` maps that API to the bindings in `lib/bindings/App.js`, which call the connected instance's `/checkpoint` routes (tests: `lib/bindings/checkpointBindings.test.js`). Tests: `checkpointStore.test.js`.
- `frontend/src/lib/checkpoint/`:
  - `CheckpointDock.svelte` is the dock (`lib/dock/Dock.svelte` with `CHECKPOINT_DOCK` limits): Intercept all, `Forward n` / `Drop n`, and the host tree;
  - `ItemWorkspace.svelte` is the selected item's title bar, buttons and request | response split;
  - `RulesEditor.svelte` is the Lua rules editor and Update rules;
  - `itemContext.js` reads a held response's request (`GetRawDetails`) and a WebSocket message's connection. Both read through Marasi: a held WebSocket message's workspace shows its connection's host and path (`GET /traffic/{request_id}/websocket`). One instance, `checkpointItemContext` in `checkpointStore.js`, is loaded by `+layout.svelte` for every held item and shared by the page and the abandon toast;
  - `httpParse.js` is `CheckHTTPParse`: it reads an edited request or response as Go's `http.ReadRequest` or `http.ReadResponse` would, with Go's error text, since Marasi refuses an unparsable forward with a bare `invalid_checkpoint_request`. Tested in `httpParse.test.js`;
  - `items.js` holds the pure helpers (`summarize`, `groupByHost`, `treeOrder`, `bulkTargets`, `itemTitle`, `abandonLabel`, `abandonText`, and `KIND_LABELS`, which `KindTag.svelte` shows), tested in `items.test.js`.
- `frontend/src/stores.js`: `checkpointCode` is the rules in the editor, `checkpointCodeApplied` the rules Checkpoint runs; `populateCheckpoint` loads both and calls the store's `populate`.
- `frontend/src/lib/checkpointBadge.js` gives the rail icon's count badge and title (`Checkpoint · N intercepted`), drawn in `+layout.svelte`.
- `frontend/src/lib/marasiEvents.js` passes Marasi's `checkpoint.*` events to the store.
- Marasi: `service/checkpoint.go` on `integration/v2-backlog` (routes and events). `ForwardCheckpoints` and `DropCheckpoints` have no route; the bindings loop over the single ones.

## An item's life

1. Marasi holds an item, HTTP or WebSocket, and publishes `checkpoint.held`. `marasiEvents.js` calls the store's `onHeld`, which reads `GET /checkpoint` again. Items come back oldest first, each with `InterceptedAt` (Marasi's `intercepted_at`), which the dock and the title line show as the time held. A new item takes the selection only when nothing is selected.
2. `edit` keeps the edited text per item and checks it with `CheckHTTPParse`. WebSocket payloads are not parsed. While a check is on its way, `isChecking` is true and Forward is greyed out.
3. `forward(id, { interceptResponse })` and `drop(id)` wait for the item's pending parse check, then call the single bindings. An edit is sent as the item's `raw`, or a WebSocket message's `payload`. They resolve to `"forwarded"`, `"unparsed"`, `"dropped"` or `"gone"`. `gone` means the item had already left: Marasi answers `404 not_found` (`isCheckpointGone` in `lib/checkpointHeld.js`), and the page toasts `Already gone`. Any other failure reads the queue again and rethrows. `bulk(kind, ids)` waits for pending checks, then calls `ForwardCheckpoints` or `DropCheckpoints` with the ids frozen at the click (for Drop n, before its confirm). It skips items whose edit doesn't parse and returns its toast text (`Forwarded 6 · 1 skipped · 1 gone · 1 failed`). The bindings count per-item failures in `Failed` and log them; failed items stay held with their edits. After each, the selection moves to the next item in hold order, or the previous one.
4. Marasi publishes `checkpoint.forwarded` or `checkpoint.dropped` (`id`, `type`, `request_id`, `reason`) for every item that leaves, whichever client acted. The store's `onResolved` reads the queue again, so every window drops it; a request forwarded with "intercept response" comes back as its response under the same id.
5. When a client leaves, Marasi drops its item and publishes `checkpoint.dropped` with reason `abandoned`. `onResolved` removes the item and tells `onAbandon` listeners whether an edit was lost; `+layout.svelte` toasts `#412 dropped · client left · edit lost` on any page. A held request has no pair number yet, so its title and that toast use `METHOD path`. Reason `shutdown` is read as a plain drop.
6. Intercept all is `GET /checkpoint`'s `intercept`. Toggling it sets the opposite with `POST /checkpoint/intercept`, and `checkpoint.updated` (`onUpdated`) keeps the switch in step when the CLI or another window sets it.

A project switch waits while items are held (`project.waiting`; see `project-open.md`). `openProject` in `stores.js` clears the store and fills it again.

## Rules

The rules are the checkpoint extension's Lua code. `Update rules` runs it with `RunExtension("checkpoint", code)`. The rules run without Lua's `string` library, so `string.sub` and `path:find` fail. Match a path with equality or a table lookup:

```lua
local held = { ["/admin"] = true, ["/login"] = true }
function interceptRequest(request)
  return held[request:path()] == true
end
```

## Adding a page action

1. Add a catalog row in the `checkpoint` block of `catalog.js`, and test its key in `menus.test.js` (see `keybindings-and-menus.md`). The `toggle-settings`, `edit-rules` and `update-rules` ids predate the redesign and stay put.
2. Add `{actionId, icon, handler}` to `checkpointMenu`. Use the page's `forward`, `drop` and `bulk`, which toast and confirm; calling the bindings directly leaves the store and the rail badge stale.
3. If the action needs new state, add a store method, map its API in `checkpointStore.js`, and add it to the fake API in `checkpointStore.test.js`.

## Links to the rest of the app

- **The WebSocket modal** keeps its own per-connection queue in its Checkpoint tab (`WebSocketCheckpoint.svelte`, fed by `connectionStore`; the logic is in `createConnectionStore.js`, tested in `connectionStore.test.js`). Held messages show on this page too, and `marasiEvents.js` keeps the two in step: `checkpoint.held` of type `websocket` joins its connection's queue (`connectionStore.onHeld`, in hold order by `intercepted_at`), `checkpoint.forwarded` and `checkpoint.dropped` with a `request_id` take it off and read the queue's head again (`onResolved`), whichever client settled it, and `checkpoint.updated`'s `websocket_intercept` sets the modal's `Intercept On`/`Off` (`onUpdated`). `websocket.closed` clears the connection's queue.
- **The Launchpad.** A held request launched from a launchpad is flagged with its name, from `launchpadStore`'s `launchesById`.
