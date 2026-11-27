# Ledger: streamed pairs

A streamed pair is a gRPC, gRPC-Web, Connect, SSE or NDJSON call whose body Marasi carries as stream messages (see `GLOSSARY.md`). UI text says "message", never "frame" or "event". Streamed pairs need a Marasi with streamed state on rows (nightly `22.11.2026 (nightly 3cf721d)` or later): set `MARASI_VERIFY_CLI` to such a CLI, since an older `marasi` on PATH shows no badge and no stream messages.

## Getting a gRPC call

`scripts/grpc-harness/` is a small Go program (its own module, no protoc) that serves gRPC on h2c plus gRPC-Web, Connect, SSE and NDJSON over HTTP/1.1, and a client that calls it through the Marasi proxy, so each call becomes a streamed pair. Build it once, outside the repo's module:

```bash
GOWORK=off go -C .agents/skills/verify-marasi/scripts/grpc-harness build -o /tmp/chatharness .
PROXY=127.0.0.1:$(cat "$MARASI_VERIFY_STATE_DIR/proxy-port")
/tmp/chatharness server -grpc-port 50051 -http-port 50052 &          # pick free ports; record the PID
/tmp/chatharness converse -proxy $PROXY -addr 127.0.0.1:50051 -every 3s -count 0 </dev/null &
```

Client modes, each with `-proxy $PROXY` and `-addr` naming the server's gRPC port (or its HTTP port for the HTTP modes):

| Mode | Call |
| --- | --- |
| `converse [-every 2s] [-count 0] [-text hi]` | bidi `/chat.v1.ChatService/Converse`: a message every `-every`, which the server echoes. `-count 0` runs until SIGINT; the first SIGINT half-closes, so the server ends with trailers `grpc-status 0`, the second cancels. `-count 1` sends one message and half-closes at once |
| `subscribe -every 1s -count 5` | server stream `/Subscribe` |
| `unary -text hi` | `/Say` (`-text fail…` ends `INVALID_ARGUMENT`) |
| `web`, `connect` | gRPC-Web and Connect server streams |
| `sse`, `ndjson` | `GET /sse`, `GET /ndjson`: response-only streamed pairs |
| `server … -fail-after 2` | a server whose Converse ends `grpc-status 9` after two messages |

The client logs each message sent (`->`) and received (`<-`), then the end: `grpc-status`, `grpc-message` and trailers. That log is the peer-side proof of an edit, an inject, a trailer rewrite or a cancel. Messages are a hand-encoded `ChatMessage { int64 seq = 1; string sender = 2; string text = 3; int64 unix_ms = 4; }`, whose protobuf text form reads `1:VARINT 1` / `2:LEN {"client"}` / `3:LEN {"live"}` / `4:VARINT …`.

The origin is plain h2c, so no CA is needed. Marasi verifies origin TLS against the system roots, so a self-signed TLS origin fails. Stop the server and any client by PID before `cleanup.sh`; a client blocked on a held message hangs until the item is forwarded or dropped.

## The badge and opening the modal

The badges column shows a waves icon titled `Streamed: request grpc, response grpc · live` (`ended`, `cancelled`, `reset`, `cut short`): green while live, plain once ended, red and slashed for any other ending. It appears with the call's first message, before the response starts, and survives `restart.sh`. The query box finds them with `streamed:*`, `NOT streamed:*`, `request_framing = "grpc"` and `response_framing = "*"`. A live gRPC call's row reads status `…` until its response ends, then `200` and type `grpc`. The Ledger lists newest first, so with several calls to one path use `{"click":".ledger-row","hasText":"Converse","nth":1}` for the newest.

Open the row's drawer and click `[aria-label="Open messages"]` (or the row menu's `Open messages`, or `⌘⇧G`; the Launchpad entry menu and the Logbook's linked pair open it too, see `../launchpad/menus.md` and `../logbook.md`). The header reads `POST <host>/chat.v1.ChatService/Converse  #<n> · <count> messages`, with a progress chip while a message is arriving and `Cancel` (`⌘⇧X`). Tabs in `⌘[`/`⌘]` order: `Messages`, `Checkpoint`, `Inject`, `Pair`; contexts `stream`, `stream.messages`, `stream.checkpoint`, `stream.inject`, `stream.pair`. While the pair has held items the Checkpoint tab's label carries a count, so `{"text":"Checkpoint","within":".msg-tabs"}` stops matching: click the tab with `{"click":".msg-tabs label","hasText":"Checkpoint"}`.

## Messages

One list of both directions in arrival order (`#`, direction arrow, time, size, preview), filtered by `All`, `↑ Request`, `↓ Response`. Rows carry `Edited`, `Intercepted`, `Injected`, `Dropped` (struck through) and the other flag chips. Selecting a row shows the protobuf text form for gRPC, gRPC-Web and Connect (UTF-8 text for SSE and NDJSON, read-only hex otherwise), with `Raw` (`⌘⇧R`), `Copy to Inject` (`⌘⇧I`) and `Metadata` (`⌘⇧M`); `⌘⇧[`/`⌘⇧]` step, `⌘J` jumps to the bottom. A long list scrolls rows out of the viewport: pick a row by text unique to it (`{"click":"tr","hasText":"Edited client","within":".card"}`), since two off-screen matches fail.

## Checkpoint

The pair's held stream messages and trailer blocks, oldest first, from the same store as the Checkpoint page (see [checkpoint.md](../checkpoint.md)). The bar reads `Nothing intercepted` or `N intercepted`, the `Stream intercept` switch (the dock's setting), `Forward` (`⌘⇧F`) and `Drop` (`⌘⇧D`); `⌘⇧I` turns Stream intercept over. Empty, it reads `No intercepted messages for this pair` and `Turn on Stream intercept to intercept its messages` or `Stream intercept is on`. Each list row (`.sc-list`) shows ↑/↓, `STREAM` or `TRAILER`, the framing, ● when edited and the hold time; the selected item edits in `.sc-panes .cm-content`, with `Revert` once edited and Marasi's refusal under the editor. An edit made here shows on the Checkpoint page and the reverse. Forwarding one item lets the next one in, so wait for it (`{"waitText":"↓","within":".sc-list"}`) before the next `⌘⇧F`.

Proven: with `converse -count 0` running, turn on `Stream intercept` in the tab, wait for `1 intercepted`, replace the text with `3:LEN {"EDITED in modal"}` (and the other fields), `⌘⇧F`, and the client logs `<- #77 server: "echo: EDITED in modal"`. Trailers: with Stream intercept on, run `converse -count 1`; the tab holds the request message, then the echo, then a `TRAILER` block reading `grpc-status: 0`. Rewrite it to `grpc-status: 5` / `grpc-message: rewritten in modal`, forward it here or on the Checkpoint page, and the client ends `grpc-status 5 (NotFound) grpc-message "rewritten in modal"`; the Pair tab then lists those trailers.

## Inject and Cancel

`Inject`: `Direction` (only open, streamed directions; `⌘⇧D`), the framing chip, `Send uncompressed`, and `Inject` (`⌘⇧Enter`, toast `Message injected`). gRPC injects are written as the text form, for example `1:VARINT 99` / `2:LEN {"marasi"}` / `3:LEN {"INJECTED from app"}`; a text error marks its line and column. An inject Checkpoint intercepts shows `Intercepted in Checkpoint`. The injected row shows `Injected` in Messages, and the server logs `<- #99 marasi: "INJECTED from app"`.

`Cancel` sends no confirmation: both directions' endings turn `cancelled` in Pair, the client logs `grpc-status 1 (Canceled) … RST_STREAM … CANCEL`, and `Cancel` greys out (`button[aria-label="Cancel"][disabled]`).

## Pair

Each direction's `Framing`, `Messages`, `Ending` (`complete`, `cancelled`, `reset <code>`, `cut short`, or live) and `Trailers`, updating live.

## Gotchas

- Turning Stream intercept off does not release held items: forward or drop them, or the client hangs. With it on, both directions and the trailer block are held in turn.
- An inject into a direction whose own message is held waits behind that message and is not held itself.
- `streamed_pair.started` names only the request direction; the response framing arrives with the response's first message.
- gRPC-Web trailers and the Connect end-of-stream are stored as the last response message (flags 128 or 2), not as trailers; the Messages tab marks them `Trailers` / `End of stream`.
- The phone layout of the modal is not in the server build; check it on a simulator or emulator (see [README.md](../README.md)).
