# Request replay

## Sub-features

- Launchpad groups and request entries
- Request editor and HTTPS toggle
- Entry/group navigation and unsaved-edit prompt
- Send, response display, and handoff to other tools

## How to get to it (user POV)

Select the rail item titled `Launchpad` or press `Command+5`. A fresh project shows `No Launchpads` and `Create one from ledger.` Users add an entry from a Ledger request with `Send to Launchpad`. From the request drawer that is `⌘⇧L`, which shows `Request N sent to Launchpad` with a `Jump to Launchpad` action; the row's right-click menu offers it too. Groups and entries have no list. Icon-only arrow buttons labelled `X of Y` and `Request X of Y`, or `⌘]`/`⌘[` and `⌘⇧]`/`⌘⇧[`, move between them.

## Driving it with Chrome CDP

Run `scripts/drive.sh launchpad` for route proof. It requires `Launchpad Settings`. Proven handoff from Ledger:

```json
{"name":"send-to-launchpad","steps":[
 {"click":"tbody tr","hasText":"/compass-allowed"},{"waitSelector":".drawer"},
 {"key":"cmd+shift+l"},{"waitText":"sent to Launchpad"},
 {"text":"Jump to Launchpad"},{"waitPath":"/launchpad"},{"waitNoSelector":".drawer"}]}
```

Then, on Launchpad:

```json
{"name":"edit-and-send","steps":[
 {"waitText":"Request 1 of 1"},
 {"click":"div[role=switch]:has(input[name=\"TLS Toggle\"])"},
 {"waitSelector":"div[role=switch][aria-checked=false]:has(input[name=\"TLS Toggle\"])"},
 {"click":".cm-content","nth":1},{"key":"cmd+a"},
 {"insert":"GET /launchpad-replay HTTP/1.1\nHost: 127.0.0.1:18099\n\n"},
 {"waitEnabledText":"Send"},{"text":"Send"},{"waitText":"Request launched"},
 {"waitText":"Request 2 of 2","timeoutMs":15000},{"waitText":"verification-response /launchpad-replay"}]}
```

Prove linkage with `select l.name, r.path, r.status_code from launchpad l join launchpad_request lr on lr.launchpad_id=l.id join request r on r.id=lr.request_id`.

## Gotchas

- The empty state proves only that the route loaded.
- Navigating away with changed request text opens a `Confirm Action` prompt and discards the changes when accepted.
- The target receives a real network request. Use a local disposable endpoint unless external delivery is the behavior under test.
- `Send` is disabled while the UI's listener state is offline. HTTPS starts enabled each time the route mounts; disable it for a plain local HTTP endpoint.
- `Request launched` appears even when the send fails, because `Repeat` logs and drops launch errors. Require the endpoint's response, a new entry, and persisted linkage.
- The right-click `Send to Launchpad` path opens `/launchpad?lastTab=1`, which the page ignores. It shows the previously active Launchpad, not necessarily the new one. The drawer path uses `?id=`.
- Each send adds a new entry and leaves the original unchanged. With prettify on, the prettified request is what gets sent.
