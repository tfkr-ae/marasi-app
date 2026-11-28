# Dashboard, listener, and appearance

## Sub-features

- Startup on the local Marasi service (start or attach), and Home's figure tiles, each opening the page it counts
- Listener status (live from `listener.*`) and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions
- Switching projects: the `Switch Projects` picker, the opening screen (steps, a locked project), and the refusal while Checkpoint holds items
- Global light/dark appearance toggle; the app reopens in the scheme chosen last (`⌘U`, Settings › Appearance › Dark mode), else the system's
- The Connections modal: the rail's connection tile (`[data-testid=connection-tile]`, the connection's name, `Local`) or `⌘9` (`global.connections`, `Connections…` in the menu). It holds every connection control: Restart, Stop, service updates and channel, the local CLI path and carried CLI, and When quitting (Settings has no Connection section)

## How to get to it (user POV)

Launch Marasi or select the rail item titled `Home`. The command shortcut is `Command+1`. Until the app reaches the service, the start screen says `Starting Marasi…`, `Connecting to Marasi…`, or `Connecting to <name>…` for a remote (`[data-testid=connection-status]`); a failure says `Couldn't reach <name>` and shows the CLI's or service's error and `Retry`. While starting, connecting or failed, `Connections…` (`[data-testid=startup-connections]`) opens the Connections modal over the start screen. Home's counts, scope and listener come from the service (`homeStore`: `GET /dashboard`, `/scope`, `/listener/status`, `/traffic/count/by-field`); the Service log's lines come from `serviceLogStore` (`GET /logs`, `/extension`, live by `log.added`); In Checkpoint, Armory runs and Test cases done come from the Checkpoint, Armory and Logbook stores. Home (`[data-testid=home-overview]`) shows the project name (`[data-testid=home-project]`) with the capture controls (`[data-testid=home-capture]`): the listener address and port, `Stop`/`Start`, `Open Project`, `Download Certificate`, `Start Chrome` (not on a phone) and `Service log`. From 40rem up they form a row that wraps between controls, never clipping one; below it they stack full-width. Under them are eight figure tiles (`[data-testid=home-figure]`, `data-figure` = `pairs`, `intercepted`, `notes`, `launchpads`, `held`, `armory`, `test-cases`, `scope`; the value is `[data-testid=home-figure-value]`). Each opens the page that lists what it counts: Pairs the unfiltered Ledger, Intercepted the Ledger with `metadata.intercepted = true`, With a note the Ledger with `note:*`, Test cases done the Logbook's test cases, and the rest Launchpad, Checkpoint, Armory and Compass. Until the counts and scope are first read, their tiles show a pulsing ghost bar (`.ghost`) in place of the value.

Shortcuts: every menu shortcut for this feature is a catalog action in context `global` (Home has no page menu; its buttons share the global actions) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh dashboard`. It clicks the actionable `[title="Home"]` through Chrome DevTools and requires Home's root, `[data-testid=home-overview]`, in the resulting DOM. Pair it with `scripts/doctor.sh`, which proves the service runs in the isolated config dir, owns the proxy port, and has its scratchpad project.

### Live listener over `/events`

Change the service behind the app and wait for Home to follow, without navigating. Moving the proxy listener over the control API sends `listener.updated`. Proven:

```sh
NP=<free port>
curl -s -H "Authorization: Bearer $(cat "$MARASI_VERIFY_STATE_DIR/service-password")" -X POST "$(cat "$MARASI_VERIFY_STATE_DIR/control-url")/listener/update" -d "{\"address\":\"127.0.0.1\",\"port\":$NP}"
printf '%s\n' "$NP" > "$MARASI_VERIFY_STATE_DIR/proxy-port"
```

```json
{"name":"live-listener","steps":[
 {"waitText":"127.0.0.1:<NP>","within":"[data-testid=home-listener]"}]}
```

### Start versus attach

Launch in attach mode (default), then clean up: `service-after-quit.txt` reads `service_after_app_quit=running`. Launch with `MARASI_VERIFY_SERVICE=app`, drive Home, then clean up: it reads `running`, because When quitting is Ask and `TERM` answers no question; with When quitting set to Stop Marasi it reads `stopped`. In app mode, `ps -ww -o command= -p "$(cat "$MARASI_VERIFY_STATE_DIR/service.pid")"` shows `--port <proxy port>` and `--control-address 127.0.0.1:0` and never the password, which the app passes as `MARASI_PASSWORD`.

Drive the listener button (`[data-testid=home-listener]`, `Listener off` when the service has none) and its adjacent start/stop toggle (`[data-testid=home-listener-toggle]`, `Stop` / `Start`, also `⌘⇧P` and `Stop Listener` / `Start Listener` in `⌘K` under Project) only when listener control or reconfiguration is under test. The `Setup Listener` modal starts, moves or stops the service's listener (`POST /listener/start`, `/listener/update`, `/listener/stop`), showing `Stop Listener` + `Update` when active and `Start Listener` when off, seeded from the last active endpoint (or the app's default listener). Proven, with `<NP>` a free port (then write it to `proxy-port`):

```json
{"name":"listener-modal","steps":[
 {"click":"[data-testid=home-listener]"},{"waitText":"Setup Listener"},{"click":"input[placeholder=\"8080\"]"},{"key":"cmd+a"},{"insert":"<NP>"},
 {"text":"Update"},{"waitText":"Listening on"},{"waitText":":<NP>","within":"[data-testid=home-listener]"}]}
```

Stopping and starting the proxy listener without stopping the service works from all three places — the Home toggle (`[data-testid=home-listener-toggle]`), the `Setup Listener` modal (`[data-testid=listener-modal-stop]` / `[data-testid=listener-modal-submit]`), and `⌘⇧P` / `⌘K` (`Stop Listener` / `Start Listener`). Starting again reuses the last active address and port.

`lsof -nP -t -iTCP:<NP> -sTCP:LISTEN` must print the service PID (`service.pid`), not the app's. Prove Open Project with `scripts/drive.sh dashboard compare "Open Project" "cmd+o"`; that clicks the dashboard button and then sends `⌘+O` (the catalog's `global.open-project` action), and both must paint the same `Switch Projects` overlay. Compare waits for the overlay text to settle before capturing, because the modal's list stays empty until the service's project list arrives. `Browse…`, Download Certificate and Copy Certificate need a native dialog or the clipboard; see [native.md](native.md) for what the server build shows and how to check them.

Run `scripts/drive.sh dashboard theme` to leave Home for Settings, toggle light/dark mode with `Command+U`, and toggle it back. This proves the global shortcut reads the live theme after navigating away from the dashboard.

The chosen scheme lives in the page's `localStorage` (`modeUserPrefers`, `false` for dark), not in `marasi_appconfig.yaml`; with no choice yet the app follows the system. Prove it with `{"key":"cmd+u"},{"waitSelector":"html.dark"}`, then `scripts/restart.sh` (which keeps Chrome's profile) and `{"waitSelector":"html.dark"}` on the relaunched page.

Home's counts follow traffic without navigating. Proven, with a request sent through the proxy (`curl -x http://127.0.0.1:<proxy port> …`) a few seconds after the drive starts on a fresh project:

```json
{"name":"live-counts","steps":[{"waitText":"0","within":"[data-figure=pairs] [data-testid=home-figure-value]"},{"waitText":"1","within":"[data-figure=pairs] [data-testid=home-figure-value]","timeoutMs":15000}]}
```

Prove the Connections modal with `scripts/drive.sh dashboard compare "Local" "cmd+9"`: the rail tile and `⌘9` both paint `Connections` (the connection list, `Add connection`, and the picked connection's details). Add connection also lists unsaved running local instances under `[data-testid=add-local-running]` (rows `[data-testid=add-local-running-item]`: instance, project, proxy listener, version, and Add). Proven with a second isolated instance named `extra` that had no saved connection yet; one-click Add saves a connection for that instance's current proxy port.

The details (`[data-testid=connection-detail]`) read top to bottom: the name, `This machine · instance default · linux` (`connection-where`), `Marasi dev · API 1` (`connection-service-meta`) and the status (`connection-status`, `Connected`); the action bar (`connection-actions`); one contextual slot (`connection-context`: an inline confirm, an update's progress, an error); Project; Password and Share (`ConnectionAccess.svelte`); and a collapsed disclosure, `Channel, CLI path & quit behavior` (`connection-setup-toggle`, summary `dev · quit: ask`). For a `dev` service, which is what `MARASI_VERIFY_CLI` built from source runs, the action bar is only `Restart` and `Stop`, and the disclosure has no `Update channel` or `Reinstall`: `Check update`, `Update to <version>`, `Restart to apply`, the channel switch, Reinstall and the rail tile's update dot (`connection-tile-update-dot`) need a release or nightly service (`frontend/src/lib/connection/detail.js`). Opened, the disclosure lists `Local CLI path` (`connection-cli-location`: `<path> · PATH`, with `Change`, and `Use PATH` for a custom path), a `Carried CLI` row (`<version> · included in app, offline`, with `Reinstall & restart` when matching the located CLI or `Install & restart` when differing; a development `launch.sh` build carries none, so the row is absent), and `When quitting Marasi App` (`connection-quit-ask|keep|stop`: `Ask`/`Keep running`/`Stop`, saved to `when_quitting` in `marasi_appconfig.yaml`). The details pane scrolls inside the modal; the driver scrolls a control below its edge into view. Proven (`when_quitting: keep`; set it back with `connection-quit-ask`):

```json
{"name":"conn-quit","steps":[{"key":"cmd+9"},{"waitSelector":"[data-testid=connections-modal]"},{"waitText":"Connected","within":"[data-testid=connection-status]"},{"click":"[data-testid=connection-setup-toggle]"},{"waitSelector":"[data-testid=connection-setup-body]"},{"click":"[data-testid=connection-quit-keep]"},{"waitSelector":"[data-testid=connection-quit-keep][aria-checked=true]"},{"waitText":"quit: keep","within":"[data-testid=connection-setup-summary]"},{"key":"escape"},{"waitNoSelector":"[data-testid=connections-modal]"}]}
```

`Restart` (`connection-restart`) sends `POST /service/restart`. On a run the app did not start (attach mode) or a remote it first asks inline: `Restart Local?`, `Active connections will drop while the project reopens.`, `connection-restart-cancel` / `connection-restart-confirm`. The service hands its listeners to a new process (a new PID and `run_id`, the same proxy port, control address and password), the app reconnects and reloads the project, and Home's log gets another `Marasi Service Started` row. Doctor then records the new service PID. Proven:

```json
{"name":"restart","steps":[{"key":"cmd+9"},{"waitSelector":"[data-testid=connections-modal]"},{"click":"[data-testid=connection-restart]"},{"waitText":"Restart Local?"},{"click":"[data-testid=connection-restart-confirm]"},{"waitText":"Connected","within":"[data-testid=connection-status]","timeoutMs":30000},{"key":"escape"},{"waitNoSelector":"[data-testid=connections-modal]"},{"waitText":"\n2\tINFO\tMarasi Service Started","timeoutMs":20000}]}
```

Row `2` is the first restart after a launch; count up for later ones.

With a Checkpoint item held, the confirmed restart is refused and `Checkpoint has intercepted items` opens over the modal with `Forward or drop them to restart.` and `Open Checkpoint`. With unsaved work (a Launchpad draft, Logbook edits, an open CyberChef recipe or Excalidraw drawing, an Armory run) Restart first asks the native unsaved-work question, which the server build declines: nothing happens and no request is sent ([native.md](native.md)).

### Switching projects

`⌘O` or `Open Project` opens `Switch Projects`: a `Find or create a project` field (`input[type=search]`) over the service's named projects (`li.project-item`, `GET /project/list`, most recent first). Typed text that names no listed project (ignoring case and `.marasi`) gets a `Create “<name>”` row (`li.project-item.create`, `New project · Projects folder` or the typed path) above an `Existing projects` header and the matches. Enter, or the button beside `Browse…`, takes the project the text names, else the first match, else the Create row; a click on a row selects it, a double-click opens it, and the button names what it will do (`Open <name>` or `Create “<name>”`). A name opens or creates `<config dir>/projects/<name>.marasi` on the service, and an absolute path (`.marasi` added when missing) opens that file, as `Browse…` would. Both go through `POST /project/open`; check the result with `GET /service/status`'s `project`. A slow or failed open covers the app with the opening screen (the project's name and path, steps Lock, Open, Upgrade, Wait, Load, one sentence, and a collapsed `Details` listing the service's `project.*` events); a quick open shows none, so the screen is reached by failing. Proven, opening a new project and switching back:

```json
{"name":"open-second","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"waitText":"scratchpad"},{"click":"input[type=search]"},{"insert":"second"},
 {"waitText":"Create “second”"},{"key":"enter"},{"waitText":"second","within":"[data-testid=home-project]","timeoutMs":20000},{"waitText":"Opened second project"}]}
{"name":"back-to-scratchpad","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"click":"li.project-item","hasText":"scratchpad"},{"text":"Open scratchpad"},
 {"waitText":"scratchpad","within":"[data-testid=home-project]","timeoutMs":20000}]}
```

A project another instance holds is refused (`409 project_already_open`, read as `project_locked`): the screen reads `The project is opened by another instance.`, lists `Open another project` with `Browse…`, and offers `Stay in <open project>`, `Try again` and `Open <picked>`. Stand in for the other instance with a second isolated service holding a project file: `MARASI_PASSWORD=<any> "$MARASI_VERIFY_CLI" --config-dir /tmp/<dir>/cfg service start --port 0 --control-address 127.0.0.1:0 --project /tmp/<dir>/locked.marasi`, and stop it afterwards with `service stop` against the same `--config-dir`. Proven:

```json
{"name":"locked","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"click":"input[type=search]"},{"insert":"/private/tmp/<dir>/locked.marasi"},{"key":"enter"},
 {"waitText":"The project is opened by another instance.","timeoutMs":20000},{"waitText":"Open another project"},
 {"text":"Details"},{"waitText":"project.opening_failed"},{"text":"Stay in scratchpad"},
 {"waitNoText":"opened by another instance"},{"waitText":"scratchpad","within":"[data-testid=home-project]"}]}
```

The service keeps the scratchpad open (`GET /service/status`).

While Checkpoint holds an item, `⌘O` and `Open Project` open `Checkpoint has intercepted items` (`Forward or drop them to switch projects.`) instead of the picker, with `Open Checkpoint` (goes to `/checkpoint`) and `Cancel`; `⌘O` closes it again. An item held after the picker opened refuses the open the same way (the project store reads `GET /checkpoint` before `POST /project/open`, because the service would wait instead), and the same modal shows; doctor refuses a drive while the picker is open, so that case is covered by `projectStore.test.js`. Hold one with intercept on (`POST /checkpoint/intercept {"intercept":true}` with the service password) and a background request through the proxy, then, from Home:

```json
{"name":"held-switch-open-checkpoint","steps":[
 {"key":"cmd+o"},{"waitText":"Checkpoint has intercepted items"},{"waitText":"Forward or drop them to switch projects."},{"waitNoText":"Switch Projects"},
 {"text":"Open Checkpoint"},{"waitText":"item 1 of 1"},{"waitNoText":"Checkpoint has intercepted items"}]}
```

After `Forward`, `⌘O` opens `Switch Projects` again.

## Drop and reconnect

When `/events` drops, the pages stay: a warning toast, `Lost connection to Local. Reconnecting…`, stays until the stream is back, and a banner over the page reads `Reconnecting to Local (attempt n). Your work stays where it is.` with `Retry now`. Attempts wait 1, 2, 4, 8, 16, then 30 s. On reconnect the toast gives way to `Reconnected to Local` (3 s); the same project resyncs every store in place, and another project (or a restarted service) loads in full after the unsaved-work prompt, remounting the pages.

Drop the stream by stopping the control listener: `"$MARASI_VERIFY_STATE_DIR"/bin/marasi --config-dir "$MARASI_VERIFY_STATE_DIR"/marasi service control stop`. Each attempt reaches the local instance through the linked CLI again, which turns a control listener back on at once, so the banner shows only for about a second. To watch it and the backoff, hold the CLI back from the app first: move `$MARASI_VERIFY_STATE_DIR/bin/marasi` to `marasi.real` and put a script there that exits 2 when `HOME` is the app's isolated home and otherwise runs `marasi.real "$@"`, so doctor and your own commands still work. Attempts then fail with `finding the Marasi CLI: cli_missing (): the Marasi CLI isn't installed…` (in `app.log` and the console): the app probes the CLI with `service status --json` first, and one that exits 2 doesn't answer like Marasi. Restore the link before `Retry now`. Requests sent through the proxy while disconnected show in the Pairs figure after the resync. Proven:

```json
{"name":"drop","steps":[{"waitText":"Lost connection to Local. Reconnecting…","timeoutMs":15000},{"waitText":"Reconnecting to Local (attempt 5)","timeoutMs":30000}]}
{"name":"retrynow","steps":[{"text":"Retry now"},{"waitText":"Reconnected to Local","timeoutMs":5000},{"waitNoText":"Lost connection to Local"},{"waitNoText":"Reconnecting to Local"},{"waitText":"3","within":"[data-figure=pairs] [data-testid=home-figure-value]"}]}
```

Run `retrynow` straight after restoring the CLI, inside the wait, or the scheduled attempt reconnects first and `Retry now` is gone. For the project change, run `"$MARASI_VERIFY_STATE_DIR"/bin/marasi.real --config-dir "$MARASI_VERIFY_STATE_DIR"/marasi project open --name acme` while held back, then reconnect and wait for `acme` in `[data-testid=home-project]`. With no unsaved work the prompt passes without a dialog; a declined prompt (`Load it` in the banner) is covered by `connectionStore.test.js`, since the server build has no dialogs.

## Gotchas

- Each verification launch picks its own free proxy port (`<proxy port>`, in `$MARASI_VERIFY_STATE_DIR/proxy-port`); an instance the app starts uses the app config's `default_port`, which launch sets to that port (the app falls back to a free port only when it is taken). The proxy belongs to the service process, never the app.
- The proxy itself answers the host `marasi`: `curl -x 127.0.0.1:<proxy port> http://marasi/cert` returns the CA certificate (`application/x-x509-ca-cert`), the URL the first-run setup shows. Download Certificate needs a native save dialog ([native.md](native.md)). Start Chrome opens an external process. Record and clean up anything those actions create.
- The Marasi menu keeps a closed `<dialog>` of the same labels. The driver's hit-test skips those copies; never target a label by `textContent`.
- Home's root and project name paint before the figures and listener status finish loading. Counts and scope refresh when Home mounts; the counts also follow captured traffic live (`traffic.request`, reread at most every 500 ms), and the listener updates live from the stream. Wait for the specific value.
- Shortcuts are gated by `frontend/src/lib/keybindings/gate.js`: unmodified keys never fire from inputs or editors; modified ones are dropped from form fields except on `/ledger`, `/logbook`, `/launchpad` and `/settings` (and the menu's own search field). An open modal (other than the WebSocket overlay) blocks all menu shortcuts, including global ones; the binding that opened the modal can still close it via `isModalToggle`. The WebSocket modal keeps its own contexts plus global.
