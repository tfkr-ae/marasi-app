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
