# The app reaches Marasi only through a service's control API

The app no longer embeds the Marasi library to run a proxy in-process. The Svelte frontend talks to one service instance at a time over its HTTP control API and follows it through the `GET /events` SSE stream, reconnecting and resyncing its stores in place when the stream drops. The Go side keeps only what a webview can't do: native dialogs, clipboard, window and menu, app updates, app config, keychain access, running the Marasi CLI, and launching Chrome. The same app then works against a local instance or a remote one, and the CLI, the app and other clients share one instance instead of each owning a proxy.

Chrome is the deliberate exception: the app launches it with the library's `chrome.Launcher` on this machine, aimed at the connection's proxy listener and pinned to its certificate's SPKI hash, never through `POST /chrome/start`, which would open Chrome on the service's host. A feature the control API can't serve is disabled in the app and recorded as a Marasi gap, not rebuilt on the client or patched into the library from here.

## Consequences

- The SSE stream has no event IDs, so a reconnect can't replay what it missed; every store needs an in-place resync that keeps drafts, selection and scroll.
- Projects and their paths live on the service's host. The native file picker only applies to the local connection.
- Going back to the embedded library would mean rewriting every store's API layer again.
