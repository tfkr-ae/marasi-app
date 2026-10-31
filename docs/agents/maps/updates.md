# Updates

How the app checks for, downloads, verifies, installs and relaunches into an update, and which strings must match between Go, the frontend and the release workflows. Names are functions, types and files, so search for them. The `update.go` file comment lists what each `update_*.go` file holds.

## Order

1. **Check.** `CheckForUpdate` (the menu action and Settings), `SetUpdateChannel` and the `startUpdateChecks` schedule all run `checkForUpdate`. `findUpdate` picks `findReleaseUpdate` or `findNightlyUpdate` by `updateChannel`, reading GitHub through `releases`. A new update is sent as `update-available`.
2. **Download and verify.** `InstallUpdate` and `ReinstallLatestRelease` call `startInstall`, which runs `install`. `install` checks the signature on `checksums.txt` (`verifyChecksums`) before the build downloads, then compares the build's hash. Progress is sent as `update-progress`.
3. **Install.** The `platformInstaller` from `defaultInstaller` stages the build beside the running one and swaps it in. Each OS has its own `update_platform_<goos>.go`. On macOS, a Marasi.app that Gatekeeper translocated (opened straight from Downloads) installs into the bundle it was translocated from (`bundleInstaller.locate`, `translocationOriginal`). `finishInstall` sends `update-installed` or `update-failed`.
4. **Relaunch.** `RestartToUpdate` sets `App.restarting` and quits. `close` calls `relaunchIfRestarting` last. The next start removes the leftovers (`removeUpdateLeftovers`).

The updater uses its own HTTP client (`updateHTTPClient`), which honours the system proxy but never sends through Marasi's own listener. `App.UpdateProxy` is unrelated: it changes the proxy listener.

## Frontend

`frontend/src/stores/updateStore.js` calls the bindings and holds `updateState`. `frontend/src/lib/updates.js` holds the logic and the text, and `UpdateModal.svelte` draws the panel. `+layout.svelte` subscribes to the four events by name. Remove each one in the same cleanup. The menu action is `global.check-for-updates` in the keybinding catalog (see `keybindings-and-menus.md`). The Settings page has an `updates` section.

## Strings that must match

Changing one of these means changing the others:

- **Event names:** the constants in `update.go` and `update_install.go`, and the `EventsOn` names in `+layout.svelte`.
- **Asset names:** each `defaultInstaller`, the `asset` matrix in `.github/workflows/build.yml`, and the checksum and upload lists in `release.yml` and `nightly.yml`.
- **Version formats:** `parseReleaseVersion` and the `release.yml` tag pattern, and `parseNightlyVersion` and `nightlyCommit` and the nightly release title and notes in `nightly.yml`.
- **Build identity:** the `build_info.go` variables that `build.yml` sets with `-ldflags`, including the public signing key. A development build has no channel, so it cannot check or install.
- **Failure kinds and steps:** `UpdateFailureKind` and `InstallStep` in Go, and `failureTitles` and the step ids in `updates.js`.

## Decisions

- [Updates are verified against a signing key built into the app](../../adr/2026-10-17-updates-are-signed-with-an-embedded-key.md)
- [Switching channel never installs an older build on its own](../../adr/2026-10-17-switching-channel-never-downgrades.md)

## Instance updates (v2)

A service instance updates itself through Marasi's `/update` routes, separately from the app's own updater above. `frontend/src/stores/createInstanceUpdateStore.js` holds the logic; `instanceUpdateStore.js` wires it to the Marasi client and reads the instance again whenever the window's connection changes. `InstanceVersion.svelte` draws the version, Check for updates, Install, the install's progress and Restart in the Dashboard's connection status.

- **Reads.** `reload` reads `GET /service/status` (version, `restart_required`) and `GET /update`. An instance without `/update` still shows its version, with no update actions. The store is in `marasiEvents.js`'s `stores`, so it reloads when the stream reopens.
- **Bundled Marasi.** The update actions are hidden when a local instance's `install_path` is the bundled Marasi (`runsBundled` in `electron/marasiBin.js`, links resolved), since it updates with the app. A remote instance is never treated as bundled. Restart shows for any instance whose build was replaced.
- **Events.** `update.available`, `update.progress`, `update.installed` (which sets restart needed), `update.failed`, `service.restarting` and `service.restart_failed` go to the store's `on*` methods.
- **Restart.** `POST /service/restart` answers once the successor runs on the same address and token, so the store reads it again and the event stream reopens on its own. `409 checkpoint_items_held` asks before a forced restart drops the held items.
- A development build answers `409 development_build` to check and install, and reports `development: true`, which disables Check for updates.
