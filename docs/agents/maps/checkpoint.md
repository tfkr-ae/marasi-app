# Checkpoint

Which files work together on the Checkpoint page, how a held item reaches the page and leaves it, and where a page action goes. Names are functions and files, so search for them. The UI says "intercepted"; the code and `GLOSSARY.md` say "held" (Checkpoint item, hold, Forward, Drop).

## Files

- `frontend/src/routes/checkpoint/+page.svelte` wires everything together: the dock, the workspace's Items | Rules switch, the toasts, Drop n's confirmation, ↑/↓, and `checkpointMenu` for `useMenuActions` and ⌘K.
- `frontend/src/stores/createCheckpointStore.js` holds the state, the selectors and the event reducers: the held items in hold order, the selection and picks, per-item edits and parse errors, and the bulk actions. It takes its API as an argument. `frontend/src/stores/checkpointApi.js` is that API over the service's `/checkpoint` routes, with the mappers for stream events. `frontend/src/stores/checkpointStore.js` binds it to the app's client, registers `checkpoint` with `projectData` (load, clear, resync), and routes the `checkpoint.*` events. Tests: `checkpointStore.test.js` (fake API) and `checkpointService.test.js` (fake client).
- `frontend/src/lib/checkpoint/`:
  - `CheckpointDock.svelte` is the dock (`lib/dock/Dock.svelte` with `CHECKPOINT_DOCK` limits): Intercept all, `Forward n` / `Drop n`, and the host tree;
  - `ItemWorkspace.svelte` is the selected item's title bar, buttons and request | response split;
  - `RulesEditor.svelte` is the Lua rules editor and Update rules;
  - `httpParse.js` is the editor's malformed warning: a port of what Go's `http.ReadRequest` and `http.ReadResponse` check, giving Go's error text. `httpParse.cases.json` records Go's answers, which `httpParse.test.js` checks;
  - `itemContext.js` reads a held response's request (`GET /traffic/{id}`) and a WebSocket message's connection. One instance, `checkpointItemContext` in `checkpointStore.js`, is loaded by `+layout.svelte` for every held item and shared by the page and the abandon toast;
  - `items.js` holds the pure helpers (`summarize`, `groupByHost`, `treeOrder`, `bulkTargets`, `itemTitle`, `abandonLabel`, `abandonText`, and `KIND_LABELS`, which `KindTag.svelte` shows), tested in `items.test.js`.
- `frontend/src/stores/checkpointRules.js`: the rules. `checkpointCode` is the rules in the editor, `checkpointCodeApplied` the rules Checkpoint runs (both live in `checkpointStore.js`; `stores.js` re-exports them). `checkpointStore.js` binds the rules to `extensionsStore`'s `code` and `run`. Tests: `checkpointRules.test.js`.
- `frontend/src/lib/checkpointBadge.js` gives the rail icon's count badge and title (`Checkpoint · N intercepted`), drawn in `+layout.svelte`.
- Go has no Checkpoint code: every hold, edit, forward and drop is a service call.

## An item's life

1. Marasi holds an item and the service streams `checkpoint.held`. `checkpointStore.js` passes it to the store's `onIntercepted`, which reads `GET /checkpoint` again (`toCheckpointItem` maps each item). Items come back oldest first, each with `InterceptedAt`. A new item takes the selection only when nothing is selected.
2. `edit` keeps the edited text per item and checks it with `httpParseError`, with no call to Go or the service. WebSocket payloads are not parsed. While a check is pending, `isChecking` is true and Forward is greyed out.
3. `forward(id, { interceptResponse })` and `drop(id)` wait for the item's pending parse check, then call `POST /checkpoint/{id}/forward` (the edit as base64 `raw` or `payload`) or `/drop`. They resolve to `"forwarded"`, `"unparsed"`, `"dropped"` or `"gone"`. `gone` means the item had already left: the service refuses with the `checkpoint_gone` code (read by `isCheckpointGone` in `lib/checkpointHeld.js`), and the page toasts `Already gone`. Any other failure reads the queue again and rethrows. `bulk(kind, ids)` waits for pending checks and skips items whose edit doesn't parse. Drop calls `POST /checkpoint/drop` with the ids frozen at the click. Forward sends each edited item on its own, then the rest through `POST /checkpoint/forward`, since the bulk route forwards the bytes as held. It returns its toast text (`Forwarded 6 · 1 skipped · 1 gone · 1 failed`); failed items stay held with their edits. After each, the selection moves to the next item in hold order, or the previous one.
4. Every item that leaves, from this client or another, streams `checkpoint.forwarded` or `checkpoint.dropped` (`toSettled`: ID, Type, a WebSocket message's RequestID, Reason). The Checkpoint store reads the queue again, and `webSocketStore.js` drops the message from the modal's queue, so both stay in step whoever acted.
5. When a client leaves, Marasi drops its item with reason `abandoned`. `onAbandoned` removes the item and tells `onAbandon` listeners whether an edit was lost; `+layout.svelte` toasts `#412 dropped · client left · edit lost` on any page. A held request has no pair number yet, so its title and that toast use `METHOD path`.
6. `checkpoint.updated` carries the Intercept all and WebSocket intercept flags, so a toggle from another client shows here.

A project switch is refused while items are held (the project store reads `GET /checkpoint` first; see `project-open.md`). `projectData` clears the store on a switch, and `resync` reads the queue, the flag and the rules again after a reconnect.

## Rules

The rules are the checkpoint extension's Lua code. `Update rules` runs it with `extensionsStore.run("checkpoint", code)`; the service stores it only once it ran. The rules run without Lua's `string` library, so `string.sub` and `path:find` fail. Match a path with equality or a table lookup:

```lua
local held = { ["/admin"] = true, ["/login"] = true }
function interceptRequest(request)
  return held[request:path()] == true
end
```

## Adding a page action

1. Add a catalog row in the `checkpoint` block of `catalog.js`, and test its key in `menus.test.js` (see `keybindings-and-menus.md`). The `toggle-settings`, `edit-rules` and `update-rules` ids predate the redesign and stay put.
2. Add `{actionId, icon, handler}` to `checkpointMenu`. Use the page's `forward`, `drop` and `bulk`, which toast and confirm; calling the service directly leaves the store and the rail badge stale.
3. If the action needs new state, add a store method, map its route in `checkpointApi.js`, and add it to the fake API in `checkpointStore.test.js`.

## Links to the rest of the app

- **The WebSocket modal** keeps its own per-connection queue in its Checkpoint tab (`WebSocketCheckpoint.svelte`, fed by `webSocketStore`; the logic is in `createWebSocketStore.js`, tested in `webSocketStore.test.js`). `webSocketApi.js` finds a connection's id from its upgrade request id (`GET /traffic/{id}/websocket`), then reads messages, injects and closes through `/websocket/{id}`. Held messages show on this page too, and the `checkpoint.*` events keep the two in step. A modal Forward or Drop of a message that already left clears it without an error.
- **The Launchpad.** A held request launched from a launchpad is flagged with its name, from `launchpadStore`'s `launchesById`.
