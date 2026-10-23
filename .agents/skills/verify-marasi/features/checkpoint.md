# Request interception

## Sub-features

- Lua interception rules for requests, responses and WebSocket messages
- The Intercept all toggle
- The dock: every intercepted item, grouped by host, with picks and `Forward n` / `Drop n`
- The item workspace: edit, Forward, Forward + intercept response, Drop
- Items whose client left
- HTTP intercepted items, including dropped WebSocket upgrade responses
- The WebSocket modal's Checkpoint tab: a separate per-connection message queue

## How to get to it (user POV)

Select the Checkpoint rail item or press `Command+4`. With items held, the rail item carries a count badge and its title reads `Checkpoint · N intercepted`.

The page is a dock and a workspace:

- **Dock.** The header reads `Intercepted n`; collapsed, the strip reads `Intercepted`. Below it sit the `Intercept all` toggle and `Forward n` / `Drop n`, where n counts the picked items, or every item when none are picked. The tree groups entries (`.cp-entry`) by host. Each shows `REQ`/`RES`/`WS`, the method, status or direction, the path, ● (title `Edited`) when edited, `!` on a parse error, and how long it has been intercepted. A click selects; ⌘-click and shift-click pick (`N picked`, `Clear`). With nothing held, the tree reads `Nothing intercepted`.
- **Workspace.** An `Items | Rules` switch at the top. Items shows the title (`#pair · METHOD path`, or `METHOD path` for a held request, which has no pair number yet), the line `host · intercepted 1m ago · item i of n`, and `Forward`, `Forward + intercept response` (requests only) and `Drop`. Below is the request | response split: the intercepted side is marked `Intercepted` and editable, with `Revert` once edited. A held request's response side reads `Not sent yet`. With nothing held, Items shows `Nothing intercepted` and an `Edit rules` button. Rules shows the full-width Lua editor and `Update rules`, with `Not applied` (and ● on the Rules tab) until the editor matches the applied rules.

Palette commands and shortcuts:

| Command | Shortcut |
| --- | --- |
| `Toggle Rules` | `⌘P` |
| `Edit Rules` | `⌘⇧E` |
| `Update Rules` | `⌘⇧R` |
| `Edit Intercepted Item` | `⌘⇧I` |
| `Forward Intercepted Item` | `⌘⇧F` |
| `Drop Intercepted Item` | `⌘⇧D` |
| `Forward + Intercept Response` | `⌘⇧S` |
| `Forward Picked Items` | `⌘⇧A` |
| `Drop Picked Items` | `⌘⇧X` |
| `Show Logs` | `⌘⇧L` |

Global `⌘I` toggles Intercept all. ↑/↓ outside an editor move the selection in the tree's order.

Shortcuts: every menu shortcut for this feature is a catalog action in context `checkpoint` (and the WebSocket modal's `websocket.checkpoint` tab) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh checkpoint` for route proof, with or without held items. Its marker is `Intercepted`, the dock's header or strip label.

Rules run without Lua's `string` library: `string.sub`, `path:find` and the like fail. Match paths with equality or a table lookup on `request:path()`. Proven rule sequence, with `Intercept all` off:

```json
{"name":"narrow-rule","steps":[
 {"text":"Rules"},{"waitSelector":"div[data-language=lua]"},{"waitText":"interceptRequest"},
 {"click":"div[data-language=lua]"},{"key":"cmd+a"},
 {"insert":"local held = { [\"/cp-a\"] = true, [\"/cp-b\"] = true, [\"/cp-c\"] = true }\nfunction interceptRequest(request)\nreturn held[request:path()] == true\nend\nfunction interceptResponse(response)\nreturn false\nend\nfunction interceptWebSocketMessage(message)\nreturn false\nend"},
 {"waitText":"Not applied"},
 {"text":"Update rules"},{"waitText":"Rules updated"},{"waitNoText":"Not applied"},
 {"text":"Items"},{"waitText":"Nothing intercepted"}]}
```

Serve an upstream that logs each request it receives, such as `python3 -I -m http.server 18765 --bind 127.0.0.1` run from an empty directory. Start each sender in the background and record its timing, one at a time, in this order: `curl -s -o /dev/null -w 'status=%{http_code} at=%{time_total}s\n' -x http://127.0.0.1:18080 http://127.0.0.1:18765/cp-a &`, then `/cp-b`, then `/cp-c`. A sender must finish only after its forward. A dropped request never reaches the upstream, and its sender gets status `200`.

With `/cp-a`, `/cp-b` and `/cp-c` held, the shortcuts:

```json
{"name":"shortcuts-forward","steps":[
 {"waitText":"item 1 of 3"},{"waitText":"/cp-a"},
 {"key":"cmd+shift+s"},{"waitText":"404"},{"waitText":"item 1 of 3"},
 {"click":".cp-entry","hasText":"404"},{"waitText":"item 3 of 3"},
 {"key":"cmd+shift+f"},{"waitNoText":"404"},{"waitText":"item 2 of 2"},
 {"click":".cp-entry","hasText":"/cp-b"},{"waitText":"item 1 of 2"},
 {"click":".cp-entry","hasText":"/cp-c","modifiers":["cmd"]},
 {"waitText":"2 picked"},{"waitText":"Forward 2"},
 {"key":"cmd+shift+a"},{"waitText":"Forwarded 2"},{"waitText":"Nothing intercepted"}]}
```

`⌘⇧S` forwards `/cp-a` and holds its response, which joins the tree last as a `RES 404` entry. After a forward or drop the selection moves to the next item in hold order, or to the previous one when the last item left.

Hold `/cp-a` and `/cp-b` again. `Drop n` asks; `Drop` on one item doesn't:

```json
{"name":"drop-n","steps":[
 {"waitText":"Drop 2"},
 {"key":"cmd+shift+x"},{"waitText":"Drop 2 intercepted items?"},
 {"text":"Drop","within":".modal-footer"},{"waitText":"Dropped 2"},{"waitText":"Nothing intercepted"}]}
```

Edits and a client that leaves: hold `/cp-a`, then `/cp-c` with `curl -m 15 …`, so its client gives up while held.

```json
{"name":"edit-forward-and-leave","steps":[
 {"waitText":"item 1 of 2"},{"waitText":"GET /cp-a"},
 {"click":".cp-request .cm-content"},{"key":"cmd+a"},{"insert":"GET http://127.0.0.1:18765/cp-edited HTTP/1.1\nHost: 127.0.0.1:18765\n\n"},
 {"waitSelector":".cp-entry [title=Edited]"},{"waitText":"Revert"},
 {"text":"Forward"},{"waitText":"GET /cp-c"},{"waitText":"item 1 of 1"},
 {"click":".cp-request .cm-content"},{"key":"cmd+a"},{"insert":"GET http://127.0.0.1:18765/cp-lost HTTP/1.1\n\n"},
 {"waitSelector":".cp-entry [title=Edited]"},
 {"waitText":"GET /cp-c dropped · client left · edit lost","timeoutMs":20000},{"waitText":"Nothing intercepted"}]}
```

The upstream logs `/cp-edited`, never `/cp-a` or `/cp-lost`.

The `dropped · client left` toast shows on any page, once. To prove it, turn `Intercept all` on, go to the Ledger, hold a request with `curl -m 6 …`, and wait for `GET /cp-leave dropped · client left` (`timeoutMs` 20000) while the badge goes.

A Forward shortcut sent straight after an edit waits for the edit's parse check: insert `BROKEN` into `.cp-request .cm-content`, press `cmd+shift+f` at once, and wait for `Edit doesn't parse` with the item still held. Forward is greyed out while a check is on its way. A Forward or Drop of an item that already left removes it with the toast `Already gone`.

The Items | Rules switch and focus, with one item held:

```json
{"name":"switch-keys","steps":[
 {"waitText":"item 1 of 1"},
 {"key":"cmd+p"},{"waitSelector":"div[data-language=lua]"},{"waitText":"Update rules"},
 {"key":"cmd+p"},{"waitText":"item 1 of 1"},{"waitNoSelector":"div[data-language=lua]"},
 {"key":"cmd+shift+e"},{"waitSelector":".cm-content[data-language=lua]:focus"},
 {"key":"cmd+shift+i"},{"waitSelector":".cp-request .cm-content:focus"},
 {"click":".cp-meta"},{"waitNoSelector":".cm-content:focus"},
 {"key":"cmd+shift+i"},{"waitSelector":".cp-request .cm-content:focus"},
 {"key":"cmd+shift+f"},{"waitText":"Nothing intercepted"}]}
```

CodeMirror puts `data-language` on `.cm-content`, so `div[data-language=lua] .cm-content` matches nothing.

### WebSocket upgrade drop

Narrow `interceptResponse` to the upgrade path (`return response:request():path() == "/ws-drop"`), start the upgrade, select its `RES 101` entry, and click `Drop`. The Ledger row then shows the neutral slashed icon titled `Upgrade response dropped` and cannot open a stream (see [ledger.md](ledger.md)). Drop the response, not the request: a dropped request never reaches the response pipeline, so it does not set `dropped`.

### WebSocket messages

A held WebSocket message shows in the dock as a `WS` entry under its connection's host. Its workspace shows the connection (host, path, direction, opcode) on the left and the editable message on the right.

The WebSocket modal's Checkpoint tab keeps its own per-connection queue. Open the upgrade's WebSocket modal from the Ledger and select `Checkpoint`. The toolbar shows `Queue empty`, `1 message queued`, or `N messages queued`, and the buttons `Forward` (`⌘⇧F`, `Forward WebSocket Message`), `Intercept On`/`Intercept Off` (`⌘⇧I`, `Toggle WebSocket Intercept`), and `Drop` (`⌘⇧D`, `Drop WebSocket Message`). An empty queue reads `No WebSocket messages in the interception queue`. A held message shows its direction (`Client to server`/`Server to client`), opcode, time, the same properties grid as Stream, and an editable payload.

Prove each path on one connection: turn `Intercept On`, send a message, then forward one unchanged, edit and forward another (the peer receives the edit), and drop a third. In Stream, forwarded rows read `Forwarded intercepted message` on hover and the dropped row is struck through with the `Dropped` flag. Turn `Intercept Off` afterwards.

#### The page and the modal stay in step

A forward or drop on either side emits `checkpoint-settled`, so the other side drops the message too. A real connection needs no npm package: from a scratch directory outside the repo, run a Node upstream that answers the upgrade with `101` and logs each text frame it receives, and a Node client that opens a raw TCP socket to `127.0.0.1:18080`, sends `GET http://127.0.0.1:<port>/socket HTTP/1.1` with the upgrade headers, and writes a masked text frame for each line appended to a control file. Run both in the background and stop them yourself before `cleanup.sh`.

The upgrade's `101` row has no content type and reads as `application/octet-stream`, which the default Types filter hides (`1 hidden`). Show it before opening the row: `{"click":"#ledgerTypesButton"}`, `{"click":".ledger-types-row[data-type=\"application/octet-stream\"] input"}`, then `{"click":".ledger-status"}`.

Open the modal and turn interception on:

```json
{"name":"ws-on","steps":[
 {"click":".ledger-row","hasText":"/socket"},{"waitSelector":".ledger-drawer"},
 {"click":"[aria-label=\"Open WebSocket stream\"]"},{"waitText":"Connection"},
 {"text":"Checkpoint"},{"waitText":"Queue empty"},{"text":"Intercept Off"},{"waitText":"Intercept On"}]}
```

Send one message, then forward it from the modal. The rail badge clears with the modal still open, and the Checkpoint page then reads `Nothing intercepted`:

```json
{"name":"modal-forward","steps":[
 {"waitText":"1 message queued"},{"waitSelector":"[data-testid=checkpoint-badge]"},
 {"click":"button","hasText":"Forward","within":".card"},{"waitText":"Queue empty"},
 {"waitNoSelector":"[data-testid=checkpoint-badge]"},{"key":"escape"},{"waitNoText":"Queue empty"}]}
```

Then on the Checkpoint page, send another and forward it with `{"waitSelector":".cp-entry","hasText":"WS"}`, `{"click":".cp-forward"}`, `{"waitText":"Nothing intercepted"}`. Back in the Ledger, reopen the modal's `Checkpoint` tab: it reads `Queue empty`, not `1 message queued`. `Drop` in the modal clears the badge the same way, and the upstream never logs the dropped message.

## Gotchas

- Broad rules can hold unrelated traffic. Use a unique verification host or path.
- `Intercept all` holds every HTTP request and response regardless of a narrow Lua rule, but only while the checkpoint extension is enabled.
- An edit that doesn't parse shows under the intercepted pane and as `!` in the tree; Forward is disabled until it parses. `Forward n` skips such items (`Forwarded 1 · 1 skipped`). An item whose forward or drop fails on the Go side stays held and counts as `· 1 failed` in a warning toast.
- Wait for an item's own text (`item 1 of 2`, its path) before acting: items arrive through the `intercepted` event, after the sender starts.
- A request left intercepted keeps its client waiting during cleanup.
- WebSocket interception has its own `Intercept On`/`Intercept Off` toggle, independent of `Intercept all`; both need the checkpoint extension enabled. The toggle is process-global and holds every message on every connection; the modal's queues are per connection. With it off, `interceptWebSocketMessage` in the Lua rules decides.
