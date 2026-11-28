# Marasi verification feature map

Marasi's primary user interface is the Wails desktop app. Verification drives its `-tags server` build from headless Chrome against a real `marasi service` with an isolated config dir, because that runs the same Svelte UI against the real Go shell and service and exposes DOM, console, network, and screenshot evidence. Flows that need a native dialog, the clipboard, the window or the menu bar are listed in [native.md](native.md) with how each is checked. Start with the route matching the change, then cover every entry point named in that feature file. `ledger.md` and `launchpad.md` are indexes of smaller parts in `ledger/` and `launchpad/`: read the index, its `getting-there.md`, and only the parts the change touches. Add a new fact to the part it belongs to, and split a part that grows past about 12 KB. The embedded Interactsh page is a secondary network-dependent tool and is outside this map. So are the iOS and Android apps: the server build always reports a desktop OS, so the phone layout (`html.mobile`, `frontend/src/lib/platform.js`), the bottom bar, pairing by QR code and the share sheet never show in it; check them on an iOS simulator (macOS with Xcode, `build/ios/Taskfile.yml`) or an Android emulator (`build/android/Taskfile.yml`).

| Feature | File | Primary proof |
| --- | --- | --- |
| Dashboard, listener, and appearance | [dashboard.md](dashboard.md) | Home shows the isolated service's figures, each opening the page it counts, the proxy port is owned by the service, a dropped stream reconnects and resyncs, and the global theme shortcut remains live after navigation |
| Traffic ledger | [ledger.md](ledger.md) | Ledger route opens, captured traffic is visible after a real proxied request, each WebSocket upgrade state shows its icon, and a real gRPC call opens in the Messages modal |
| Scope management | [compass.md](compass.md) | Compass route opens and saved Lua scope changes affect traffic capture |
| Request interception | [checkpoint.md](checkpoint.md) | Checkpoint route opens and a real proxied request reaches an observable forward/drop state |
| Request replay | [launchpad.md](launchpad.md) | Launchpad route opens and replay produces a response plus persisted request data |
| Request fuzzing | [armory.md](armory.md) | Armory route opens and a controlled run produces persisted traffic |
| Findings and test cases | [logbook.md](logbook.md) | Logbook route opens, a record saved from the modal or an inline fix persists, and a discarded one leaves nothing in the project |
| Lua workshop | [workshop.md](workshop.md) | Workshop route opens and saved code executes with visible log output |
| CyberChef | [cyberchef.md](cyberchef.md) | CyberChef route opens from the rail, Go to and ⌘K, ⌘K works inside its frame, and Send to CyberChef and Insert fill its input |
| Excalidraw | [excalidraw.md](excalidraw.md) | Excalidraw route opens from the rail, Go to and ⌘K, ⌘/ opens its help, and Add to Drawing and Insert put a card on the drawing |
| Application settings | [settings.md](settings.md) | Settings route opens and a reversible setting persists to isolated config |
| Native flows | [native.md](native.md) | Each flow's stub, Go test, or check by hand on a native build |

Use `.agents/skills/verify-marasi/scripts/drive.sh <feature>` for route-level driving. Use `drive.sh <feature> compare "<visible label>" "<shortcut>"` when an in-page control also has a Marasi menu keybinding. The feature files describe the additional actions needed for complete behavioral proof.
