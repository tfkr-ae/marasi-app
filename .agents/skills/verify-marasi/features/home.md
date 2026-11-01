# Home: dashboard, listener, and appearance

## Sub-features

- Scratchpad project startup, traffic metrics, reporting, and scope summaries
- Application log table
- Listener status and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions
- Switching projects: the `Switch Projects` picker, the opening screen (steps, a failure, a locked project and its owner), a switch made by the CLI, and a switch that waits for held Checkpoint items
- Global light/dark appearance toggle
- The instance the window is on: `On <instance> at <control listener>` under the title

## How to get to it (user POV)

Connect a window (launch does, through the connection screen) or select the rail item titled `Home`. The command shortcut is `Command+1`. While Marasi counts the project (`CountNotes`) and reads the scope rules, those cards show pulsing ghost bars (`.dashboard-ghost`) in place of their figures; Test Cases and Findings come from the app's stores and show at once. A ready scratchpad shows `scratchpad Project Dashboard`, `On default at 127.0.0.1:<control port>`, listener address and port, `Open Project`, `Download Certificate`, `Start Chrome`, and an application log table with ID, Level, Message, Request Response ID, Extension, and Timestamp columns.

Shortcuts: every menu shortcut for this feature is a catalog action in context `global` (Home has no page menu; its buttons share the global actions) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh home`. It clicks the actionable `[title="Home"]` through Chrome DevTools and requires `Project Dashboard` in the resulting DOM. Run `scripts/drive.sh home shots` for the light and dark screenshots. The instance's own answer is `resources/bin/marasi --config-dir <config_dir> --json dashboard`; compare its counts with the cards.

Drive the listener button by its painted `127.0.0.1:<port>` text only when reconfiguration is under test. Prove Open Project with `scripts/drive.sh home compare "Open Project" "cmd+o"`; that clicks the Home button and then sends `⌘+O` (the catalog's `global.open-project` action), and both must paint the same `Switch Projects` overlay. Compare waits for the overlay text to settle before capturing, because the modal shows `No recent projects` until the list loads. `Browse Files...` and certificate download use native dialogs, which only Electron has (SKILL.md, Electron).

Run `scripts/drive.sh home theme` to leave Home for Settings, toggle light/dark mode with `Command+U`, and toggle it back. This proves the global shortcut reads the live theme after navigating away from Home.

### Switching projects

Proven on v2 (ticket 10). A switch is the instance's: `POST /project/open` from the page, or `marasi project open` from the CLI, and the page follows both through the `project.*` events. Check the result at the instance: `resources/bin/marasi --config-dir <config_dir> --json service status` (`project`).

`⌘O` or `Open Project` opens `Switch Projects`: a `Search or enter new project name...` field (`input[type=search]`) over the instance's projects, newest first, each with when it was last opened (`1 minute ago`). Enter opens the highlighted project, or with no match the typed text: a bare name opens `<config_dir>/projects/<name>.marasi`, and a path opens that file on the instance machine (its directory must exist). A quick switch shows no opening screen and ends on `<name> Project Dashboard` with an `Opened <name> project` toast:

```json
{"name":"open-by-name","steps":[{"key":"cmd+o"},{"waitText":"Switch Projects"},{"waitText":"ago"},{"click":"input[type=search]"},{"insert":"bravo"},{"key":"enter"},{"waitText":"bravo Project Dashboard","timeoutMs":20000},{"waitText":"Opened bravo project"}]}
```

Insert `/tmp/mv2.XXXX/engagements/charlie.marasi` (after `mkdir` of its directory) for the path.

**A switch made by the CLI.** Run `(sleep 3; resources/bin/marasi --config-dir <config_dir> --json project open --name delta) &` and drive `{"waitText":"delta Project Dashboard","timeoutMs":20000}`. The page re-reads the dashboard, jobs and log. A CLI switch to a file that isn't a database (`head -c 4096 /dev/urandom > <config_dir>/engagements/broken.marasi`, then `project open --path …`) shows the opening screen at once: `Couldn't open the project.`, Open marked failed, `Stay in <open project>`, and `Details` ending in Marasi's error (`file is not a database (26)`).

**A switch held by Checkpoint.** Marasi waits for held items instead of refusing. `resources/bin/marasi … checkpoint intercept on`, then `curl -s -m 120 -x <proxy_listener> http://held-probe.test/login &` holds one (`checkpoint list`). A switch from the page then shows the steps Open, Upgrade, Waiting, Load, `Waiting for 1 held Checkpoint item.`, `Held request: GET http://held-probe.test/login HTTP/1.1` and `Go to Checkpoint`, which goes to `/checkpoint` and hides the screen. `checkpoint drop <id>` or `forward <id>` lets it finish, with the `Opened …` toast. `Details` lists each `Upgrade N of 27: <migration>` of a new project; the upgrade itself is too quick to catch on screen. Turn interception off afterwards.

**A locked project.** Start a second instance on it: `resources/bin/marasi --config-dir <config_dir> --instance acme-cli --json service start --control-address 127.0.0.1:0 --port 0 --project <config_dir>/projects/foxtrot.marasi`. Opening `foxtrot` from the page shows `Locked`, `The project is open on acme-cli.`, `Stay in <open project>`, `Try again`, `Connect to acme-cli` and `Open <project>`, with `project already open: <path>` in `Details`. `Connect to acme-cli` needs Electron: it opens a second window titled `foxtrot — acme-cli` (`/json/list` on the DevTools port), and the first stays on its project. Stop `acme-cli` before cleanup, which stops only `default`.

**Remotely.** In Electron, disconnect the window (`⌘⇧⌫`) and connect by `#remote-address` (`http://<acme-cli control listener>`), `#remote-token` (`marasi … --instance acme-cli service control token`) and `#remote-name`; drive that with the `connection` feature, since the page reloads onto the connection screen. The picker then has no `Browse Files...` and reads `Enter a name, or a path on <name>'s machine.`; opening by name and by path work as above.

## Gotchas

- The listener button shows the instance's proxy listener, `proxy_listener` in `launch.txt` (a free port, not `8080`), with a green dot while it runs.
- Home can render after a listener bind failure. UI readiness alone does not prove proxy readiness.
- The proxy itself answers the host `marasi`: `curl -x 127.0.0.1:<proxy port> http://marasi/cert` returns the CA certificate (`application/x-x509-ca-cert`), the URL the first-run setup shows. Download Certificate opens a native save dialog. Start Chrome opens an external process. Record and clean up anything those actions create.
- The Marasi menu (MarasiKeys) keeps a closed `<dialog>` of the same labels. The driver's hit-test skips those copies; never target a label by `textContent`.
- A fresh window shows a `Not ported yet` toast for bindings no ticket has ported yet (`docs/v2-parity.md`).
- Start Chrome (proven on v2, ticket 26) opens a real Chrome on this machine through the instance. Add a path and a profile in Settings → Browser first, then `{"click":"button[aria-label=\"Start Chrome with custom profile\"]"},{"waitSelector":"[data-popup=chromeProfilesPopup] button"},{"click":"[data-popup=chromeProfilesPopup] button","hasText":"<profile>"}`. Prove it with `ps -ww -axo pid,command | grep '<config_dir>/chrome_profiles'`: its `--proxy-server` is the `proxy_listener`. The researcher's own Chromes use their real config directory, so stop only the ones under `<config_dir>` (`pkill -f 'user-data-dir=<config_dir>/chrome_profiles'`). On a remote connection (ticket 27) it opens this machine's Chrome instead, under `<config_dir>/v2_chrome_profiles/<profile>`, with `--proxy-server` the connection's host and the listener's port (or the address saved in Settings → Browser) and `--ignore-certificate-errors-spki-list` the instance's `GET /certificate` `spki_hash`. It has no CDP endpoint: open a page in it by running Chrome again with the same `--user-data-dir` and a URL, prove the pair with `marasi traffic list`, and shoot its window with `screencapture -l <CGWindowID>` (the window is named `Marasi - <profile>`). Stop it with `pkill -f 'user-data-dir=<config_dir>/v2_chrome_profiles'`.
- `Project Dashboard` paints before the cards, log table, and listener status finish loading. Notes, Launchpads, Intercepted, and scope counts refresh only when Home mounts or the active project changes. Wait for the specific value.
- Shortcuts are gated by `frontend/src/lib/keybindings/gate.js`: unmodified keys never fire from inputs or editors; modified ones are dropped from form fields except on `/ledger`, `/logbook`, `/launchpad` and `/settings` (and the menu's own search field). An open modal (other than the WebSocket overlay) blocks all menu shortcuts, including global ones; the binding that opened the modal can still close it via `isModalToggle`. The WebSocket modal keeps its own contexts plus global.
