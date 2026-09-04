# Dashboard and listener

## Sub-features

- Scratchpad project startup, traffic metrics, reporting, and scope summaries
- Listener status and listener reconfiguration
- Open Project, Download Certificate, and Start Chrome actions

## How to get to it (user POV)

Launch Marasi or select the rail item titled `Home`. The command shortcut is `Command+1`. A ready scratchpad shows `scratchpad Project Dashboard`, listener address and port, `Open Project`, `Download Certificate`, and `Start Chrome`.

## Driving it with Chrome CDP

Run `scripts/drive.sh dashboard`. It clicks `[title="Home"]` through Chrome DevTools and requires `Project Dashboard` in the resulting DOM. For listener startup, pair this with `scripts/doctor.sh`; the doctor proves that the configured listener port and scratchpad SQLite file exist.

Drive the listener button by its visible `127.0.0.1:<port>` text only when reconfiguration is under test. `Open Project` first opens the in-app `Switch Projects` modal; its `Browse Files...` action and certificate download use native dialogs that browser mode cannot display. Verify those desktop-only boundaries separately.

## Gotchas

- The normal app uses port `8080`; the verification launch defaults to isolated port `18080`.
- A dashboard can render after a listener bind failure. UI readiness alone does not prove proxy readiness.
- Download Certificate opens a native save dialog. Start Chrome opens an external process. Record and clean up anything those actions create.
