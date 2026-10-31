# v2 reaches Marasi only through the control API, and the main process adds the token

Marasi App v2 is an Electron app that doesn't embed the Marasi library. Each window talks to one service instance's control API at its network address. The renderer makes plain `fetch` calls and opens `GET /events` with `EventSource`. The Electron main process adds `Authorization: Bearer <control token>` to that window's requests, through the window's own session (`webRequest.onBeforeSendHeaders`, limited to the instance's origin). The renderer never holds the token. When the app starts an instance, it always gives it a loopback control address. When it connects to a local instance that has none, it turns one on over the socket. The main process reads a local instance's token through the socket, and keeps a remote one in `safeStorage`. It handles processes, tokens and OS features, and nothing in it understands Marasi's domain.

We considered three options:

- **The main process relays every call over IPC.** This keeps the socket usable, but it adds a second transport, and the frontend could no longer run in a plain browser.
- **The renderer holds the token and sends the header itself.** This is the simplest option, but the renderer shows hostile captured content, so the token would sit where an injected script could read it and keep it.
- **The main process adds the header.** This is the option we chose. It keeps one HTTP code path for local and remote instances, lets `EventSource` work, and lets a token rotation change only the main process. The Vite dev server's proxy adds the header in the same way, so the frontend can be verified in a plain browser against a real instance.

## Consequences

- A script injected into a window can still call the API while that window is open. It just can't take the token away with it.
- Any v1 feature with no control API route becomes a Marasi backlog ticket. The GUI doesn't work around it by reading Marasi's files.
