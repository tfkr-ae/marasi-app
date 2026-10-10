# Request interception

## Sub-features

- Lua interception rules for requests and responses
- Global HTTP intercept enable/disable state
- Edit, forward, and drop actions
- HTTP intercepted items and the separate per-connection WebSocket checkpoint queue

## How to get to it (user POV)

Select the rail item titled `Checkpoint` or press `Command+4`. The page shows `Intercept Queue: N` or `No items in interception queue`, and the buttons `Forward`, `Intercept Response` (requests only), `Global Intercept (On)`/`Global Intercept (Off)`, and `Drop`. `Checkpoint Settings` holds the Lua rules editor and an `Update Intercept Rules` button.

Palette commands and shortcuts:

| Command | Shortcut |
| --- | --- |
| `Toggle Checkpoint Settings` | `⌘P` |
| `Edit Checkpoint` | `⌘⇧E` |
| `Update Checkpoint Code` | `⌘⇧R` |
| `Edit Intercepted Item` | `⌘⇧I` |
| `Forward Intercepted Item` | `⌘⇧F` |
| `Drop Intercepted Item` | `⌘⇧D` |
| `Show Logs` | `⌘⇧L` |

Global `⌘+I` toggles global intercept.

## Driving it with Chrome CDP

Run `scripts/drive.sh checkpoint` for route proof. Its marker is `Checkpoint Settings`, because the rail label `Checkpoint` is always visible. Proven sequence, with `Global Intercept` left off:

```json
{"name":"narrow-rule","steps":[
 {"text":"Checkpoint Settings"},{"waitSelector":"div[data-language=lua]"},{"waitText":"interceptRequest"},
 {"click":"div[data-language=lua]"},{"key":"cmd+a"},
 {"insert":"function interceptRequest(request)\nreturn request:path() == \"/checkpoint-probe\"\nend\nfunction interceptResponse(response)\nreturn false\nend\nfunction interceptWebSocketMessage(message)\nreturn false\nend"},
 {"text":"Update Intercept Rules"},{"waitText":"Updated checkpoint rules"},
 {"text":"Checkpoint Settings"},{"waitNoSelector":"div[data-language=lua]"}]}
```

Start the matching request in the background and record its timing, for example `curl -w 'status=%{http_code} at=%{time_total}s' -x … /checkpoint-probe &`. Then drive:

```json
{"name":"hold-and-forward","steps":[
 {"waitText":"Intercept Queue: 1"},{"waitText":"/checkpoint-probe"},{"waitText":"No Error"},
 {"text":"Forward"},{"waitText":"No items in interception queue"}]}
```

The sender must finish only after the forward.

## Gotchas

- Broad rules can hold unrelated traffic. Use a unique verification host or path.
- `Global Intercept` holds every HTTP request and response regardless of a narrow Lua rule, but only while the checkpoint extension is enabled.
- `Edit Intercepted Item` (`⌘⇧I`) currently throws: it looks for `div[data-language="javascript"]`, which the intercepted-item editor never has. That is a product bug, not drift.
- Parse errors arrive asynchronously after each edit. Wait for `No Error` before `Forward`.
- The queue view refreshes only on the next `intercepted` event or a remount. Items removed elsewhere stay visible until then.
- A request left intercepted can keep clients waiting during cleanup.
- WebSocket interception uses a separate `Intercept On`/`Intercept Off` toggle and queue inside each Ledger WebSocket modal. The toggle is process-global; the queued frames are per connection.
