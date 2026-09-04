# Marasi verification feature map

Marasi's primary user interface is the Wails desktop app. Verification drives the browser-connected Wails dev server because it runs the same Svelte UI against the real Go backend and exposes DOM, console, network, and screenshot evidence. Start with the route matching the change, then cover every entry point named in that feature file. Embedded CyberChef, Excalidraw, and Interactsh pages are secondary network-dependent tools and are outside this map.

| Feature | File | Primary proof |
| --- | --- | --- |
| Dashboard and listener | [dashboard.md](dashboard.md) | Scratchpad dashboard appears and the isolated proxy port is owned by the app |
| Traffic ledger | [ledger.md](ledger.md) | Ledger route opens and captured traffic is visible after a real proxied request |
| Scope management | [compass.md](compass.md) | Compass route opens and saved Lua scope changes affect traffic capture |
| Request interception | [checkpoint.md](checkpoint.md) | Checkpoint route opens and a real proxied request reaches an observable forward/drop state |
| Request replay | [launchpad.md](launchpad.md) | Launchpad route opens and replay produces a response plus persisted request data |
| Request fuzzing | [armory.md](armory.md) | Armory route opens and a controlled run produces persisted traffic |
| Findings and test cases | [logbook.md](logbook.md) | Logbook route opens and an edited item persists in the project |
| Lua workshop | [workshop.md](workshop.md) | Workshop route opens and saved code executes with visible log output |
| Application settings | [settings.md](settings.md) | Settings route opens and a reversible setting persists to isolated config |

Use `.opencode/skills/verify-marasi/scripts/drive.sh <feature>` for route-level driving. The feature files describe the additional actions needed for complete behavioral proof.
