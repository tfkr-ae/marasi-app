# Request interception

## Sub-features

- Lua interception rules for requests and responses
- Global HTTP intercept enable/disable state
- Edit, forward, and drop actions
- HTTP intercepted items and the separate per-connection WebSocket checkpoint queue

## How to get to it (user POV)

Select the rail item titled `Checkpoint` or press `Command+4`. User commands include `Toggle Checkpoint Settings`, `Edit Checkpoint`, `Update Checkpoint Code`, `Show Logs`, `Edit Intercepted Item`, `Forward Intercepted Item`, and `Drop Intercepted Item`.

## Driving it with Chrome CDP

Run `scripts/drive.sh checkpoint` for route proof. For interception behavior, configure a narrow rule for a verification-only destination, leave `Global Intercept` off, and send one matching request through the isolated proxy. Capture the sender waiting, the intercepted item in the real window, the forward or drop action, and the sender's final response or connection failure. Query the isolated project if the path should persist traffic.

## Gotchas

- Broad rules can hold unrelated traffic. Use a unique verification host or path.
- Enabling `Global Intercept` intercepts every HTTP request and response regardless of a narrow Lua rule.
- A request left intercepted can keep clients waiting during cleanup.
- WebSocket interception uses a separate toggle and queue inside each Ledger WebSocket modal.
