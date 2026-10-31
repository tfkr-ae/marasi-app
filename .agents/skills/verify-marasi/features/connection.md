# Connection screen

## Sub-features

- The list of running local instances: name, open project, proxy listener and Marasi version, or `Not answering`; `Refresh`
- Connect: double-click an instance, or pick it and click `Connect to <instance>`; a failed connect shows why and lists the instances again
- Disconnect: `⌘⇧⌫` or `Disconnect` in the Marasi menu (`global.disconnect`), which leaves the instance running
- Start an instance: project (`Choose…`, or the scratchpad), name, the Marasi that Start runs (`Choose…`, `Use bundled`), and `Start <name>`
- The connection the window had survives a reload; a disconnected window stays on this screen

## How to get to it (user POV)

A window with no connection shows it: a fresh dev server (launch), or after Disconnect. In the app, a window that launches connects to the default instance, starting it when it isn't running (`electron/local.js`), so it shows this screen only after Disconnect or a failed start. The screen covers the app (`fixed inset-0 z-[998]`) under `Connect to Marasi`, `Instances running on this machine`.

## Driving it with Chrome CDP

Run `scripts/drive.sh connection`. It sends `⌘⇧⌫`, waits for `Connect to Marasi` after the page reloads, captures it, then clicks `Connect to default` and waits for `Project Dashboard`. `connection-before.*`, `connection-after.*` and `connection-left.*` record the three states. Run `scripts/drive.sh connection shots` for light and dark.

Drive the screen's controls with `steps` from Home, starting with the disconnect, and end connected so doctor stays green:

```json
{"name":"refresh-and-connect","steps":[
 {"key":"cmd+shift+backspace"},{"waitText":"Connect to Marasi"},
 {"text":"Refresh"},{"waitText":"v2-backlog"},
 {"click":"ul[aria-label=Instances] button","hasText":"default"},{"text":"Connect to default"},{"waitText":"Project Dashboard"}]}
```

A step that captures during the reload can fail with `Inspected target navigated or closed`. Wait for text on the screen right after the key, as above.

To show a second instance, start one in the same config directory (`resources/bin/marasi --config-dir <config_dir> --instance web --json service start --port 0 --control-address 127.0.0.1:0`), then `Refresh`. Stop it with `service stop` before cleanup, because cleanup stops only `default`. An instance with no control listener gets one at loopback on Connect, and the window shows the toast `Turned on <listener> for <instance>`.

Start, both `Choose…` buttons and `Use bundled` need Electron. In the browser they fail with `Open Marasi v2 to do this`. Drive them with `electron.sh` (see `electron.md`).

## Gotchas

- The bridge holds one connection for the whole dev server. A second tab on it, or a `curl -X POST …/__marasi/disconnect`, disconnects every page. Drive through the page only.
- The connection screen has no shortcuts: MarasiKeys starts once the window connects. Its reload takes the OS appearance, so `shots` emulates the OS preference.
- The instance's own view is `resources/bin/marasi --config-dir <config_dir> --json service list`.
