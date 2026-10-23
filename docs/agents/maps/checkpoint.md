# Checkpoint

Which files work together on the Checkpoint page, how a held item reaches the page and leaves it, and where a page action goes. Names are functions and files, so search for them. The UI says "intercepted"; the code and `GLOSSARY.md` say "held" (Checkpoint item, hold, Forward, Drop).

## Files

- `frontend/src/routes/checkpoint/+page.svelte` wires everything together: the dock, the workspace's Item | Rules switch, the toasts, Drop n's confirmation, ↑/↓, and `checkpointMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createCheckpointStore.js` holds the state, the selectors and the event reducers: the held items in hold order, the selection and picks, per-item edits and parse errors, and the bulk actions. It takes its API as an argument. `frontend/src/stores/checkpointStore.js` maps that API to Wails bindings. Tests: `checkpointStore.test.js`.
- `frontend/src/lib/checkpoint/`:
  - `CheckpointDock.svelte` is the dock (`lib/dock/Dock.svelte` with `CHECKPOINT_DOCK` limits): Intercept all, `Forward n` / `Drop n`, and the host tree;
  - `ItemWorkspace.svelte` is the selected item's title bar, buttons and request | response split;
  - `RulesEditor.svelte` is the Lua rules editor and Update rules;
  - `itemContext.js` reads a held response's request (`GetRawDetails`) and a WebSocket message's connection. One instance, `checkpointItemContext` in `checkpointStore.js`, is loaded by `+layout.svelte` for every held item and shared by the page and the abandon toast;
  - `items.js` holds the pure helpers (`summarize`, `groupByHost`, `treeOrder`, `bulkTargets`, `itemTitle`, `abandonLabel`, `abandonText`, and `KIND_LABELS`, which `KindTag.svelte` shows), tested in `items.test.js`.
- `frontend/src/stores.js`: `checkpointCode` is the rules in the editor, `checkpointCodeApplied` the rules Checkpoint runs; `populateCheckpoint` loads both and calls the store's `populate`.
- `frontend/src/lib/checkpointBadge.js` gives the rail icon's count badge and title (`Checkpoint · N intercepted`), drawn in `+layout.svelte`.
- Go: `checkpoint.go` (handlers, interception times, `GetCheckpointItems`, `ForwardCheckpoints`, `DropCheckpoints`); `ForwardCheckpoint`, `DropCheckpoint`, `CheckHTTPParse`, `GetInterceptFlag` and `ToggleIntercept` in `app.go`.

## An item's life

1. Marasi holds an item and calls the intercept handler that `configureCheckpointHandlers` registers. It stamps the time and emits `intercepted`. A held WebSocket message arrives as `ws-intercepted` from `websocket.go`.
2. `+layout.svelte` passes both events to the store's `onIntercepted`, which reads `GetCheckpointItems` again. Items come back oldest first, each with `InterceptedAt`. A new item takes the selection only when nothing is selected.
3. `edit` keeps the edited text per item and checks it with `CheckHTTPParse`. WebSocket payloads are not parsed. While a check is on its way, `isChecking` is true and Forward is greyed out.
4. `forward(id, { interceptResponse })` and `drop(id)` wait for the item's pending parse check, then call the single bindings. They resolve to `"forwarded"`, `"unparsed"`, `"dropped"` or `"gone"`. `gone` means the item had already left: Go refuses with the `checkpoint_gone` code (`checkpointGoneError`, read by `isCheckpointGone` in `lib/checkpointHeld.js`), and the page toasts `Already gone`. Any other failure reads the queue again and rethrows. `bulk(kind, ids)` waits for pending checks, then calls `ForwardCheckpoints` or `DropCheckpoints` with the ids frozen at the click. It skips items whose edit doesn't parse and returns its toast text (`Forwarded 6 · 1 skipped · 1 gone · 1 failed`). Go counts per-item failures in `CheckpointBulkResult.Failed` and logs them; failed items stay held with their edits. After each, the selection moves to the next item in hold order, or the previous one.
5. Every forward or drop that succeeds goes through `settleCheckpoint`, which emits `checkpoint-settled` (`CheckpointSettled`: ID, Type and a WebSocket message's RequestID). `+layout.svelte` reads the queue again and calls `connectionStore.onSettled`, so the page and the WebSocket modal's Checkpoint tab drop the item whichever of them acted.
6. When a client leaves, Marasi drops its item and calls the abandoned handler, which emits `checkpoint-abandoned`. `onAbandoned` removes the item and tells `onAbandon` listeners whether an edit was lost; `+layout.svelte` toasts `#412 dropped · client left · edit lost` on any page. A held request has no pair number yet, so its title and that toast use `METHOD path`.

A project switch is refused while items are held (`checkpointHeldError` in `app.go`; see `project-open.md`). `openProject` in `stores.js` clears the store and fills it again.

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

- **The WebSocket modal** keeps its own per-connection queue in its Checkpoint tab (`WebSocketCheckpoint.svelte`, fed by `connectionStore`; the logic is in `createConnectionStore.js`, tested in `connectionStore.test.js`). Held messages show on this page too, and `checkpoint-settled` keeps the two in step. A modal Forward or Drop of a message that already left clears it without an error.
- **The Launchpad.** A held request launched from a launchpad is flagged with its name, from `launchpadStore`'s `launchesById`.
