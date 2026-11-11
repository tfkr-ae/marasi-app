# Ledger: WebSocket streams

## WebSocket streams

A WebSocket message is the whole message, however many frames it arrived in. UI text says "message"; action ids keep `frame` (`websocket.stream.next-frame`, `websocket.checkpoint.forward-frame`, `websocket.inject.inject-frame`).

Drive a WebSocket through the proxy with a raw-socket client: send an absolute-form upgrade (`GET http://127.0.0.1:<port>/<path> HTTP/1.1` with `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version: 13`) to `127.0.0.1:<proxy port>`, then read and write masked frames. Use a disposable local server you control, so each state below is a deliberate server behaviour. Offer `Sec-WebSocket-Extensions: permessage-deflate` to get a deflate connection; add another offer (for example `x-webkit-deflate-frame`) to see it stripped. Have the server's `101` carry a `Content-Type` such as `text/plain`: without one Marasi stores the upgrade as `application/octet-stream`, which the default content-type exclusion hides, so the row never shows in the table.

**Upgrade states.** The badges column shows a WebSocket icon (its label is the badge's `title` and `aria-label`; past three badges, hover the `+N` slot `.ledger-badges-more` for the full list) whose state comes from `frontend/src/lib/websocket/presentation.js`:

| `websocket.state` | Icon | Opens a stream | How to produce it |
| --- | --- | --- | --- |
| `pending` | warning | yes | Hold the server's 101 response |
| `open` | success | yes | Complete the handshake |
| `closed` (or no state) | error | yes | Close the connection from either side |
| `failed` | error, slashed; tooltip `WebSocket handshake failed — see the logs on Home` | no | Offer `permessage-deflate` and have the server answer an extension response that matches no offer (for example `permessage-deflate; server_max_window_bits=20`, or two extensions). Home's logs get `WebSocket handshake failed: …` |
| `dropped` | neutral, slashed; tooltip `Upgrade response dropped` | no | Drop the 101 response in Checkpoint (see [checkpoint.md](../checkpoint.md)) |

A failed or dropped upgrade reaches the Ledger live through `ws-state`, with no reload. A slashed row has no drawer `Open WebSocket stream` button, and `ledger.drawer-open.websocket` is ineligible, so `⌘⇧G` does nothing there (`⌘⇧O` is Open request in every Ledger state). Prove the tooltip with `[title="Upgrade response dropped"]` or the failed text.

**Opening the modal.** Open the upgrade row's drawer and click `Open WebSocket stream` in its rail or details column, or press `Open WebSocket Stream` (`⌘⇧G`; it closes the modal again from every tab, Inject included, whose `⌘⇧O` cycles the opcode). The header shows `<transport>://<host><path>`, `N messages`, and `Close Connection` (`⌘⇧X`, toast `WebSocket connection closed`, disabled unless the state is open). Tabs, in `⌘[`/`⌘]` order: `Stream`, `Checkpoint`, `Inject`, `Connection`. Each tab's context is `websocket.stream`, `websocket.checkpoint`, `websocket.inject`, or `websocket.connection`; the Connection tab binds no actions of its own.

**Progress chip.** While a message is still arriving, the header shows `↓ receiving <size> · <n> frames` (`↑` for client to server), titled `A message is still arriving; it appears in Stream once its last frame is in`. Produce it with a fragmented message whose frames arrive more than 100 ms apart (Marasi emits progress at most every 100 ms): send a text frame with FIN clear, then continuations a second apart, then the final frame. The chip clears when the message lands in Stream, or when Checkpoint holds it.

**Stream.** Selecting a row shows the properties grid above the payload: `Type`, `Direction` (`client → server`/`server → client`, plus `(sent by Marasi)` on Marasi's own closes), `Size`, `Frames`, `Compressed` (`yes`/`no`), `Flags`, and a `Note` when the payload shown is not the message. Buttons: `Metadata`/`View Message` (`⌘⇧M`) and `Copy to Inject` (`⌘⇧I`, toast `Copied to Inject`). Flags, their row edge, and how to produce them:

| Flag | Edge | Produce it |
| --- | --- | --- |
| `Proxy` | warning | Any close Marasi sends, for example after `Too large` |
| `Too large` | error | Add `websocket_max_message_size: 1024` to `marasi_config.yaml` in the isolated config directory, run `scripts/restart.sh`, then send a 2 KB message. Marasi closes with 1009 to the sender and 1001 to the receiver; `Size` reads `> <size seen>` |
| `Corrupt` | error | On a deflate connection, send an RSV1 frame whose payload is not valid deflate (close 1007) |
| `Cut short` | error | Start a fragmented message and drop the TCP connection before its final frame |
| `Bad close` | error | Send a close frame with an invalid code or a 1-byte payload |
| `Dropped` | strike-through, no edge | Drop it in the Checkpoint tab |
| `Injected` | tertiary text | Inject it from the Inject tab |

Hover a row to read `<label>: <flag tooltip>` lines; a forwarded interception reads `Forwarded intercepted message`.

**Inject.** `Direction` (`Client to server`/`Server to client`, `⌘⇧D`), `Opcode` (`Text`, `Binary`, `Close`, `Ping`, `Pong`, `⌘⇧O`), and `Inject` (`⌘⇧Enter`, toast `WebSocket message injected`) beside a `Connection Open`/`Connection Closed` chip. On a deflate connection with `Text` or `Binary`, a `Send uncompressed` checkbox appears under the toolbar. Prove both choices: inject once with it clear and once checked, then check the injected rows' `Compressed` reads `yes` and `no`.

**Connection.** Read-only: `URL`, `State` chip, `Close` (`<code> <reason>`, with `— closed by Marasi` in warning colour when any stored message is a Marasi close), a `Compression` section (`Extension` `permessage-deflate` with client/server context takeover and max window rows, `none negotiated`, or `not recorded` without a connection record), and `Stripped by Marasi` with one `Offer` row per stripped extension or `none`.
