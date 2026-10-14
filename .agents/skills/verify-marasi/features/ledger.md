# Traffic ledger

## Sub-features

- HTTP request/response rows, and WebSocket upgrade rows whose ID cell shows the upgrade state
- The WebSocket modal opened from an upgrade: Stream, Checkpoint, Inject, and Connection tabs
- Indexed query search, content-type exclusions, sorting, and pagination
- Request detail, notes, highlights, and handoff to Launchpad, Armory, or Logbook

## How to get to it (user POV)

Select the rail item titled `Ledger` or press `Command+2`. The page opens with one always-visible bar, `#ledgerToolbar`: `#searchBox` (placeholder `Search traffic…`), the query-fields toggle `#ledgerQueryFieldsToggle`, the Types button `#ledgerTypesButton`, and pagination buttons titled `First Page`, `Previous Page`, `Next Page`, and `Last Page` beside a `Rows per page` select. Route proof waits for the `Content Length` column header.

Shortcuts: every menu shortcut for this feature is a catalog action in context `ledger.drawer-closed`, `ledger.drawer-open` and `ledger.drawer-open.websocket` (and, in the WebSocket modal, `websocket` plus `websocket.<tab>`) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh ledger` for route proof. For capture, send a `text/html` request with a unique path through the isolated proxy (`curl -x http://127.0.0.1:18080 …` to a local disposable server), then wait for that path in the table:

```bash
scripts/drive.sh ledger steps '{"name":"capture","steps":[{"waitText":"/ledger-second"}]}'
```

Pair it with a read-only query: `sqlite3 -readonly <project> "select method, host, path, status_code, content_type from request"`.

Search supports field expressions and boolean operators, not just a table substring filter. A proven sequence:

```json
{"name":"search","steps":[
 {"click":"#searchBox"},{"key":"cmd+a"},
 {"insert":"response_body:\"ledger-second\""},{"key":"enter"},
 {"waitSelector":"#ledgerQueryMatchCount"},{"waitText":"1 match"},
 {"waitNoText":"/ledger-first"},{"waitText":"/ledger-second"},
 {"click":"[aria-label=\"Clear query\"]"},{"waitText":"/ledger-first"},
 {"waitNoSelector":"#ledgerQueryMatchCount"}]}
```

The query stays active across navigation until cleared, so the recipe clears it; otherwise later recipes cannot find rows the query excludes.

Enter runs the query at once. Typing alone runs it after a 700 ms debounce. `#ledgerQueryMatchCount` reads `1 match`, `N matches`, or `N+ matches` while older pages remain. The query-help toggle describes the supported fields, operators, and examples. Bare text searches the request, response, note, and metadata, and needs at least three characters; punctuation can require quoting.

For handoff, click a row with `{"click":"tbody tr","hasText":"<path>"}`, wait for `.drawer`, then use the drawer's shortcuts. For example, `cmd+shift+l` sends the row to Launchpad and shows `Request N sent to Launchpad` with a `Jump to Launchpad` action.

## WebSocket streams

A WebSocket message is the whole message, however many frames it arrived in. UI text says "message"; action ids keep `frame` (`websocket.stream.next-frame`, `websocket.checkpoint.forward-frame`, `websocket.inject.inject-frame`).

Drive a WebSocket through the proxy with a raw-socket client: send an absolute-form upgrade (`GET http://127.0.0.1:<port>/<path> HTTP/1.1` with `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version: 13`) to `127.0.0.1:18080`, then read and write masked frames. Use a disposable local server you control, so each state below is a deliberate server behaviour. Offer `Sec-WebSocket-Extensions: permessage-deflate` to get a deflate connection; add another offer (for example `x-webkit-deflate-frame`) to see it stripped.

**Upgrade states.** The ID cell shows a WebSocket icon whose state comes from `frontend/src/lib/websocket/presentation.js`:

| `websocket.state` | Icon | Opens a stream | How to produce it |
| --- | --- | --- | --- |
| `pending` | warning | yes | Hold the server's 101 response |
| `open` | success | yes | Complete the handshake |
| `closed` (or no state) | error | yes | Close the connection from either side |
| `failed` | error, slashed; tooltip `WebSocket handshake failed — see the logs on Home` | no | Offer `permessage-deflate` and have the server answer an extension response that matches no offer (for example `permessage-deflate; server_max_window_bits=20`, or two extensions). Home's logs get `WebSocket handshake failed: …` |
| `dropped` | neutral, slashed; tooltip `Upgrade response dropped` | no | Drop the 101 response in Checkpoint (see [checkpoint.md](checkpoint.md)) |

A failed or dropped upgrade reaches the Ledger live through `ws-state`, with no reload. A slashed row has no drawer `WebSocket` button, and `ledger.drawer-open.websocket` is ineligible, so `⌘⇧O` stays the drawer's `Open Request`. Prove the tooltip with `[title="Upgrade response dropped"]` or the failed text.

**Opening the modal.** Open the upgrade row's drawer and click its `WebSocket` button, or press `Open WebSocket Stream` (`⌘⇧O`; it closes the modal again on every tab but Inject, which binds `⌘⇧O` itself). The header shows `<transport>://<host><path>`, `N messages`, and `Close Connection` (`⌘⇧X`, toast `WebSocket connection closed`, disabled unless the state is open). Tabs, in `⌘[`/`⌘]` order: `Stream`, `Checkpoint`, `Inject`, `Connection`. Each tab's context is `websocket.stream`, `websocket.checkpoint`, `websocket.inject`, or `websocket.connection`; the Connection tab binds no actions of its own.

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

## Gotchas

- The Types button opens `#ledgerTypesMenu`, which mounts only while open: a find box `#ledgerTypesFind`, group chips (`HTML`, `JSON / XML`, `Text`, `Scripts`, `Styles`, `Images`, `Fonts`, `Media`, `Documents`, `Archives & binary`), and `Shown (N)` and `Hidden (N)` lists of exact types with pair counts from `CountContentTypes`. The headings are uppercased by CSS, so wait for `SHOWN (` and `HIDDEN (` in `innerText`. Toggle a type with `{"click":"label","hasText":"<type>","within":"#ledgerTypesMenu"}`; a chip toggles its fixed list of exact types. Typing a full type that is in no list offers a `Hide <type>` button (Enter also adds it); its inner whitespace means waiting for the exact phrase fails, so wait for the type `within` `#ledgerTypesMenu button`. Excluded types with no traffic fold under `N more excluded types with no traffic yet`. `Defaults` appears only when the exclusion differs from Marasi's default; `Show all` clears it.
- The Types badge counts hidden types that have traffic, not the whole exclusion (about 80 types by default).
- Escape closes the menu wherever focus is, as does a click outside it. The find box clears on close; while it holds text, `#ledgerTypesFindClear` (×) clears it and keeps focus there. `⌘P` toggles the menu, `⌘⇧F` opens it with `#ledgerTypesFind` focused (pressing it again closes it), and `⌘⇧S` focuses `#searchBox` (pressing it again blurs the box). Click a non-input element, such as a `th`, before a shortcut.
- Query errors, the query status line and index warnings show in a strip under the bar; `#ledgerQueryFieldsToggle` opens `#ledgerQueryFields` under it too.
- The content-type exclusion hides matching types. The defaults already hide images, fonts, media, JavaScript, CSS, PDF, archives, and office types. Use `text/html` for capture proof. They include `application/octet-stream`, which `python3 -m http.server` sends for extensionless paths, so serve a `.html` path.
- An empty Ledger only proves navigation. Complete capture proof needs traffic through the proxy.
- HTTPS traffic needs the verification instance's generated certificate.
- Search and filters can hide newly captured rows; record their values in evidence.
- The live view batches `request`/`response` events and flushes every 200 ms. Query results are newest first with column sorting disabled. Matching traffic that arrives during a query is staged behind a button labelled `1 new match` or `N new matches`, which appears after the next 5 s poll.
- Content-type exclusions match stored values exactly, not MIME families. Inspect the Types menu or `select filters from app` rather than assuming defaults. A new project's stored default lists `video/x-msvideo` twice. Pairs awaiting a response (content type `""`) are always shown, so their row has no checkbox.
