# Dashboard and listener

## Sub-features

- Scratchpad project startup, traffic metrics, reporting, and scope summaries
- Listener status and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions

## How to get to it (user POV)

Launch Marasi or select the rail item titled `Home`. The command shortcut is `Command+1`. A ready scratchpad shows `scratchpad Project Dashboard`, listener address and port, `Open Project`, `Download Certificate`, and `Start Chrome`.

## Driving it with Chrome CDP

Run `scripts/drive.sh dashboard`. It clicks painted `[title="Home"]` through Chrome DevTools and requires `Project Dashboard` in the resulting DOM. For listener startup, pair this with `scripts/doctor.sh`; the doctor proves that the configured listener port and scratchpad SQLite file exist.

Drive the listener button by its painted `127.0.0.1:<port>` text only when reconfiguration is under test. Prove Open Project with `scripts/drive.sh dashboard compare "Open Project" "cmd+o"`; that clicks the dashboard button and then sends the MarasiKeys `⌘+O` binding, and both must paint the same `Switch Projects` overlay. `Browse Files...` and certificate download use native dialogs that browser mode cannot display.

## Gotchas

- The normal app uses port `8080`; the verification launch defaults to isolated port `18080`.
- A dashboard can render after a listener bind failure. UI readiness alone does not prove proxy readiness.
- Download Certificate opens a native save dialog. Start Chrome opens an external process. Record and clean up anything those actions create.
- MarasiKeys keeps a closed `<dialog>` of the same labels. Click the painted dashboard control, not the first `innerText` match.
