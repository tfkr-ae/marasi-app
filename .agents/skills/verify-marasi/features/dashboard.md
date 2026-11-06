# Dashboard, listener, and appearance

## Sub-features

- Startup on the local Marasi service (start or attach), traffic metrics, reporting, and scope summaries
- The service's log table, live from `log.added`
- Listener status (live from `listener.*`) and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions
- Switching projects: the `Switch Projects` picker, the opening screen (steps, a locked project), and the refusal while Checkpoint holds items
- Global light/dark appearance toggle

## How to get to it (user POV)

Launch Marasi or select the rail item titled `Home`. The command shortcut is `Command+1`. Until the app reaches the service, the start screen says `Starting Marasi...` or `Connecting to Marasi...` (`[data-testid=connection-status]`); a failure shows the CLI's or service's error and `Retry`. Home's counts, scope, listener and log come from the service (`homeStore`: `GET /dashboard`, `/scope`, `/listener/status`, `/logs`, `/extension`). Until the counts are first read, those cards show pulsing ghost bars (`.dashboard-ghost`) in place of their figures; Test Cases and Findings come from the Logbook's stores, which don't read the service yet and show 0. A ready scratchpad shows `scratchpad Project Dashboard`, listener address and port, `Open Project`, `Download Certificate`, `Start Chrome`, and an application log table with ID, Level, Message, Request Response ID, Extension, and Timestamp columns.

Shortcuts: every menu shortcut for this feature is a catalog action in context `global` (Home has no page menu; its buttons share the global actions) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh dashboard`. It clicks the actionable `[title="Home"]` through Chrome DevTools and requires `Project Dashboard` in the resulting DOM. Pair it with `scripts/doctor.sh`, which proves the service runs in the isolated config dir, owns the proxy port, and has its scratchpad project. The first log row is the service's `Marasi Service Started on 127.0.0.1:<proxy port>`.

### Live log and listener over `/events`

Change the service behind the app and wait for Home to follow, without navigating. Moving the proxy listener over the control API logs a line and sends `listener.updated`. Proven:

```sh
NP=<free port>
curl -s -H "Authorization: Bearer $(cat "$MARASI_VERIFY_STATE_DIR/service-password")" -X POST "$(cat "$MARASI_VERIFY_STATE_DIR/control-url")/listener/update" -d "{\"address\":\"127.0.0.1\",\"port\":$NP}"
printf '%s\n' "$NP" > "$MARASI_VERIFY_STATE_DIR/proxy-port"
```

```json
{"name":"live-log-listener","steps":[
 {"waitText":"Marasi Service Started on 127.0.0.1:<NP>"},
 {"waitText":"127.0.0.1:<NP>","within":"[data-testid=home-listener]"}]}
```

### Start versus attach

Launch in attach mode (default), then clean up: `service-after-quit.txt` reads `service_after_app_quit=running`. Launch with `MARASI_VERIFY_SERVICE=app`, drive Home, then clean up: it reads `stopped`. In app mode, `ps -ww -o command= -p "$(cat "$MARASI_VERIFY_STATE_DIR/service.pid")"` shows `--port 0` and `--control-address 127.0.0.1:0` and never the password, which the app passes as `MARASI_PASSWORD`.

Drive the listener button (`[data-testid=home-listener]`, `Listener off` when the service has none) only when reconfiguration is under test. Its `Setup Listener` modal starts or moves the service's listener (`POST /listener/start` or `/listener/update`). Proven, with `<NP>` a free port (then write it to `proxy-port`):

```json
{"name":"listener-modal","steps":[
 {"click":"[data-testid=home-listener]"},{"waitText":"Setup Listener"},{"click":"input[placeholder=\"8080\"]"},{"key":"cmd+a"},{"insert":"<NP>"},
 {"text":"Continue"},{"waitText":"Listening on"},{"waitText":":<NP>","within":"[data-testid=home-listener]"}]}
```

`lsof -nP -t -iTCP:<NP> -sTCP:LISTEN` must print the service PID (`service.pid`), not the app's. Prove Open Project with `scripts/drive.sh dashboard compare "Open Project" "cmd+o"`; that clicks the dashboard button and then sends `⌘+O` (the catalog's `global.open-project` action), and both must paint the same `Switch Projects` overlay. Compare waits for the overlay text to settle before capturing, because the modal shows `No recent projects` until the list loads. `Browse Files...`, Download Certificate and Copy Certificate need a native dialog or the clipboard; see [native.md](native.md) for what the server build shows and how to check them.

Run `scripts/drive.sh dashboard theme` to leave Home for Settings, toggle light/dark mode with `Command+U`, and toggle it back. This proves the global shortcut reads the live theme after navigating away from the dashboard.

### Switching projects

`⌘O` or `Open Project` opens `Switch Projects`: a `Search or enter new project name...` field (`input[type=search]`) over the service's named projects (`GET /project/list`, most recent first). Enter or `Open Selected` opens the highlighted project by name, or with no match the typed text: a name opens `<config dir>/projects/<name>.marasi` on the service, and an absolute path (`.marasi` added when missing) opens that file, as `Browse Files...` would. Both go through `POST /project/open`; check the result with `GET /service/status`'s `project`. A slow or failed open covers the app with the opening screen (the project's name and path, steps Lock, Open, Upgrade, Wait, Load, one sentence, and a collapsed `Details` listing the service's `project.*` events); a quick open shows none, so the screen is reached by failing. Proven, opening a new project and switching back:

```json
{"name":"open-second","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"waitText":"scratchpad"},{"click":"input[type=search]"},{"insert":"second"},
 {"waitText":"Create New Project"},{"key":"enter"},{"waitText":"second Project Dashboard","timeoutMs":20000},{"waitText":"Opened second project"}]}
{"name":"back-to-scratchpad","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"click":"li.project-item","hasText":"scratchpad"},{"text":"Open Selected"},
 {"waitText":"scratchpad Project Dashboard","timeoutMs":20000}]}
```

A project another instance holds is refused (`409 project_already_open`, read as `project_locked`): the screen reads `The project is opened by another instance.`, lists `Open another project` with `Browse…`, and offers `Stay in <open project>`, `Try again` and `Open <picked>`. Stand in for the other instance with a second isolated service holding a project file: `MARASI_PASSWORD=<any> "$MARASI_VERIFY_CLI" --config-dir /tmp/<dir>/cfg service start --port 0 --control-address 127.0.0.1:0 --project /tmp/<dir>/locked.marasi`, and stop it afterwards with `service stop` against the same `--config-dir`. Proven:

```json
{"name":"locked","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"click":"input[type=search]"},{"insert":"/private/tmp/<dir>/locked.marasi"},{"key":"enter"},
 {"waitText":"The project is opened by another instance.","timeoutMs":20000},{"waitText":"Open another project"},
 {"text":"Details"},{"waitText":"project.opening_failed"},{"text":"Stay in scratchpad"},
 {"waitNoText":"opened by another instance"},{"waitText":"scratchpad Project Dashboard"}]}
```

The service keeps the scratchpad open (`GET /service/status`).

While Checkpoint holds an item, `⌘O` and `Open Project` open `Checkpoint has intercepted items` (`Forward or drop them to switch projects.`) instead of the picker, with `Open Checkpoint` (goes to `/checkpoint`) and `Cancel`; `⌘O` closes it again. An item held after the picker opened refuses the open the same way (the project store reads `GET /checkpoint` before `POST /project/open`, because the service would wait instead), and the same modal shows; doctor refuses a drive while the picker is open, so that case is covered by `projectStore.test.js`. Hold one with intercept on (`POST /checkpoint/intercept {"intercept":true}` with the service password) and a background request through the proxy, then, from Home:

```json
{"name":"held-switch-open-checkpoint","steps":[
 {"key":"cmd+o"},{"waitText":"Checkpoint has intercepted items"},{"waitText":"Forward or drop them to switch projects."},{"waitNoText":"Switch Projects"},
 {"text":"Open Checkpoint"},{"waitText":"item 1 of 1"},{"waitNoText":"Checkpoint has intercepted items"}]}
```

After `Forward`, `⌘O` opens `Switch Projects` again.

## Gotchas

- Each verification launch picks its own free proxy port (`<proxy port>`, in `$MARASI_VERIFY_STATE_DIR/proxy-port`); an instance the app starts picks one with `--port 0`. The proxy belongs to the service process, never the app.
- Switching projects (below) still goes through the app's old in-process path until the projects ticket moves it to the service; don't treat a failure there as a regression of startup.
- The proxy itself answers the host `marasi`: `curl -x 127.0.0.1:<proxy port> http://marasi/cert` returns the CA certificate (`application/x-x509-ca-cert`), the URL the first-run setup shows. Download Certificate needs a native save dialog ([native.md](native.md)). Start Chrome opens an external process. Record and clean up anything those actions create.
- The Marasi menu (MarasiKeys) keeps a closed `<dialog>` of the same labels. The driver's hit-test skips those copies; never target a label by `textContent`.
- `Project Dashboard` paints before the cards, log table, and listener status finish loading. Counts and scope refresh when Home mounts; the log and the listener update live from the stream. Wait for the specific value.
- Shortcuts are gated by `frontend/src/lib/keybindings/gate.js`: unmodified keys never fire from inputs or editors; modified ones are dropped from form fields except on `/ledger`, `/logbook`, `/launchpad` and `/settings` (and the menu's own search field). An open modal (other than the WebSocket overlay) blocks all menu shortcuts, including global ones; the binding that opened the modal can still close it via `isModalToggle`. The WebSocket modal keeps its own contexts plus global.
