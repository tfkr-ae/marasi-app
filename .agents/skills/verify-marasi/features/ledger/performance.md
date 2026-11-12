# Ledger: performance budget

## Performance budget

The app loads the Ledger's code once the project is open (`preloadCode("/ledger")` in `+layout.svelte`), so the first visit doesn't wait for it, and the project's first Ledger read is sent before extensions load. Hold every Ledger change to this budget, measured on an 85,000-request (about 1 GB) project:

| Figure | Budget (ms) | Measured 2026-10-17 | What it times |
| --- | --- | --- | --- |
| `firstVisit` | 150 | 64–67 (532–551 before the preload) | Home → Ledger click to the toolbar painting, the first visit after launch |
| `startupRows` | 500 | 58 by the bench's poll; 226–259 when clicked the instant Home paints (1.4–5.5 s before Marasi's `DashboardCounts`) | Reload, then Ledger clicked as soon as Home shows, to the first row |
| `warmShell`, `warmRows` | 100 | 35–36, 35–36 | Home → Ledger click to the toolbar and the first row, later visits |
| `longestTask` | 100 | 0 (no task over 50 ms) | Longest main-thread task during a visit |
| `sortRows` | 300 | 23–26 | A sort header click to the newly sorted first row (a full first-page read) |
| `firstPage` | 50 | 6–7 | Marasi's QueryTraffic for the live view's first page, alone |
| `count` | none | 122–124 | Marasi's CountTraffic for the live view; it grows with the project and is reported, not budgeted |

Run it:

1. `scripts/launch.sh`, then `scripts/bench-seed.sh` (85,000 requests by default; about 15 minutes; it runs `bench-server.py` on 127.0.0.1:18999 for the upstream).
2. `scripts/bench-ledger.sh`. It restarts the instance (the project is kept) so `firstVisit` loads the code as a user's first visit does, prints each figure against its budget, writes `<evidence>/bench-ledger.json`, and exits 1 when one is over.

Figures come from headless Chrome against the server build, so they compare runs on one machine, not the WebKit app. Marasi answers one call at a time: anything the Ledger asks for waits behind whatever else is in flight (on a fresh launch, the dashboard's `CountNotes`, about 1.6 s on this project), so measure with the app idle. Since Marasi v0.0.0-20261016190652-f338aa018cfb the dashboard's `CountNotes` is one `DashboardCounts` read (11 ms at 85,000 requests, from 1.6 s), so a fresh launch's first Ledger page arrives about 940 ms after start rather than 2.5 s. On a project's first open after an upgrade, Marasi's background jobs can still hold calls up for about 250 ms each for some 27 s; don't benchmark then.
