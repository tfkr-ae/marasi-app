# Marasi v2 verification feature map

Marasi App v2's interface is its Svelte frontend, reached through the Electron app. Verification drives the same frontend in headless Chrome on the Vite dev server, which stands in for the main process against a real throwaway Marasi instance. Electron is driven only for what the page alone can't show. Start with the file matching the change, then cover every entry point it names. Embedded CyberChef, Excalidraw and Interactsh are secondary, network-dependent tools and are outside this map.

| Feature | File | Primary proof |
| --- | --- | --- |
| Home: dashboard, listener and appearance | [home.md](home.md) | Home shows the instance's project and counts, in light and dark |
| Connection screen | [connection.md](connection.md) | Disconnect reaches the screen with the running instances, and Connect returns to Home |
| Electron: windows, menus, updater | [electron.md](electron.md) | The app window connects to the recorded instance and its page is drivable |
| Traffic ledger | [ledger.md](ledger.md) | Ledger route opens, captured traffic is visible after a real proxied request, and each WebSocket upgrade state shows its icon |
| Scope management | [compass.md](compass.md) | Compass route opens and saved Lua scope changes affect traffic capture |
| Request interception | [checkpoint.md](checkpoint.md) | Checkpoint route opens and a real proxied request reaches an observable forward/drop state |
| Request replay | [launchpad.md](launchpad.md) | Launchpad route opens and replay produces a response plus persisted request data |
| Request fuzzing | [armory.md](armory.md) | Armory route opens and a controlled run produces persisted traffic |
| Findings and test cases | [logbook.md](logbook.md) | Logbook route opens, a record saved from the modal or an inline fix persists, and a discarded one leaves nothing in the project |
| Lua workshop | [workshop.md](workshop.md) | Workshop route opens and saved code executes with visible log output |
| Application settings | [settings.md](settings.md) | Settings route opens and a reversible setting persists to the app config |

Home, the connection screen and Electron are proven on v2. The other files carry v1's map: their selectors and recipes are the same frontend's, but their bindings reach Marasi only as each area's ticket ports them (`docs/v2-parity.md`). Prove a file's recipes again on v2 when its area is ported, and fix the file where v2 differs. Where a file names v1's Go (`app.go`), read it with `git show main:app.go`; the isolated config is `<config_dir>` in `launch.txt`, which v1's files call `$APP_CONFIG_DIR`. Side effects read through the instance CLI: `resources/bin/marasi --config-dir <config_dir> --json <command>`.

Use `scripts/drive.sh <feature>` for route-level driving, `drive.sh <feature> shots` for light and dark, and `drive.sh <feature> compare "<visible label>" "<shortcut>"` when an in-page control also has a MarasiKeys binding. The feature files describe the other actions a full proof needs.
