# Dashboard, listener, and appearance

## Sub-features

- Scratchpad project startup, traffic metrics, reporting, and scope summaries
- Application log table
- Listener status and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions
- Switching projects: the `Switch Projects` picker, the opening screen (steps, a locked project), and the refusal while Checkpoint holds items
- Global light/dark appearance toggle

## How to get to it (user POV)

Launch Marasi or select the rail item titled `Home`. The command shortcut is `Command+1`. While Marasi counts the project (`CountNotes`) and reads the scope rules, those cards show pulsing ghost bars (`.dashboard-ghost`) in place of their figures; Test Cases and Findings come from the app's stores and show at once. A ready scratchpad shows `scratchpad Project Dashboard`, listener address and port, `Open Project`, `Download Certificate`, `Start Chrome`, and an application log table with ID, Level, Message, Request Response ID, Extension, and Timestamp columns.

Shortcuts: every menu shortcut for this feature is a catalog action in context `global` (Home has no page menu; its buttons share the global actions) in `frontend/src/lib/keybindings/catalog.js`; the Marasi menu (`⌘K`) on the page lists them with their current keys.

## Driving it with Chrome CDP

Run `scripts/drive.sh dashboard`. It clicks the actionable `[title="Home"]` through Chrome DevTools and requires `Project Dashboard` in the resulting DOM. For listener startup, pair this with `scripts/doctor.sh`; the doctor proves that the configured listener port and scratchpad SQLite file exist.

Drive the listener button by its painted `127.0.0.1:<port>` text only when reconfiguration is under test. Prove Open Project with `scripts/drive.sh dashboard compare "Open Project" "cmd+o"`; that clicks the dashboard button and then sends `⌘+O` (the catalog's `global.open-project` action), and both must paint the same `Switch Projects` overlay. Compare waits for the overlay text to settle before capturing, because the modal shows `No recent projects` until the list loads. `Browse Files...` and certificate download use native dialogs that browser mode cannot display.

Run `scripts/drive.sh dashboard theme` to leave Home for Settings, toggle light/dark mode with `Command+U`, and toggle it back. This proves the global shortcut reads the live theme after navigating away from the dashboard.

### Switching projects

`⌘O` or `Open Project` opens `Switch Projects`: a `Search or enter new project name...` field (`input[type=search]`) over the recent projects. Enter opens the highlighted project, or with no match the typed name, which `OpenProject` (`app.go`) resolves to `<config dir>/<name>.marasi`. A slow or failed open covers the app with the opening screen (the project's name and path, steps Lock, Open, Upgrade, Load, one sentence, and a collapsed `Details` with the raw open log); a quick open shows none, so the screen is reached by failing. A project another Marasi holds is refused (`project_locked`): the screen reads `The project is opened by another instance.` (`The scratchpad …` at startup), lists `Open another project` (`Open a project instead` at startup) with `Browse…`, and offers `Stay in <open project>`, `Try again` and `Open <picked>`. Marasi locks a project with `flock` on `<project>.marasi.lock`, so hold that lock from a shell to stand in for the other instance. Proven, with `flock -n <config dir>/locked-probe.marasi.lock sleep 600 &` running:

```json
{"name":"open-locked","steps":[
 {"key":"cmd+o"},{"waitText":"Switch Projects"},{"click":"input[type=search]"},{"insert":"locked-probe"},{"key":"enter"},
 {"waitText":"The project is opened by another instance."},{"waitText":"Open another project"},{"waitText":"Stay in scratchpad"},
 {"text":"Details"},{"waitText":"project_locked"},{"text":"Try again"},{"waitText":"The project is opened by another instance."},
 {"text":"Stay in scratchpad"},{"waitNoText":"The project is opened by another instance."},{"waitText":"Project Dashboard"}]}
```

The scratchpad stays open (doctor still reports `scratchpad.marasi`). Afterwards kill both the `flock` process and its `sleep` child (the child inherits the lock, so killing `flock` alone keeps the project locked); the empty `locked-probe.marasi.lock` stays in the isolated config until cleanup.

While Checkpoint holds an item, `⌘O` and `Open Project` open `Checkpoint has intercepted items` (`Forward or drop them to switch projects.`) instead of the picker, with `Open Checkpoint` (goes to `/checkpoint`) and `Cancel`; `⌘O` closes it again. An item held after the picker opened makes `OpenProject` refuse with `checkpoint_held` (`app.go`), and the same modal shows. Hold one with the Checkpoint `narrow-rule` recipe and a background request (see `checkpoint.md`), then, from Home:

```json
{"name":"held-switch-open-checkpoint","steps":[
 {"key":"cmd+o"},{"waitText":"Checkpoint has intercepted items"},{"waitText":"Forward or drop them to switch projects."},{"waitNoText":"Switch Projects"},
 {"text":"Open Checkpoint"},{"waitText":"item 1 of 1"},{"waitNoText":"Checkpoint has intercepted items"}]}
```

After `Forward`, `⌘O` opens `Switch Projects` again.

## Gotchas

- The normal app uses port `8080`; the verification launch defaults to isolated port `18080`.
- A dashboard can render after a listener bind failure. UI readiness alone does not prove proxy readiness.
- The proxy itself answers the host `marasi`: `curl -x 127.0.0.1:<proxy port> http://marasi/cert` returns the CA certificate (`application/x-x509-ca-cert`), the URL the first-run setup shows. Download Certificate opens a native save dialog. Start Chrome opens an external process. Record and clean up anything those actions create.
- The Marasi menu (MarasiKeys) keeps a closed `<dialog>` of the same labels. The driver's hit-test skips those copies; never target a label by `textContent`.
- `Project Dashboard` paints before the cards, log table, and listener status finish loading. Notes, Launchpads, Intercepted, and scope counts refresh only when Home mounts or the active project changes. Wait for the specific value.
- Shortcuts are gated by `frontend/src/lib/keybindings/gate.js`: unmodified keys never fire from inputs or editors; modified ones are dropped from form fields except on `/ledger`, `/logbook`, `/launchpad` and `/settings` (and the menu's own search field). An open modal (other than the WebSocket overlay) blocks all menu shortcuts, including global ones; the binding that opened the modal can still close it via `isModalToggle`. The WebSocket modal keeps its own contexts plus global.
