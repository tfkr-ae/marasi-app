# Updates

How the app checks for, downloads, verifies, installs and relaunches into an update, and which strings must match between Go, the frontend and the release workflows. Names are functions, types and files, so search for them. The `update.go` file comment lists what each `update_*.go` file holds.

## Order

1. **Check.** `CheckForUpdate` (the menu action and Settings), `SetUpdateChannel` and the `startUpdateChecks` schedule all run `checkForUpdate`. `findUpdate` picks `findReleaseUpdate` or `findNightlyUpdate` by `updateChannel`, reading GitHub through `releases`. A new update is sent as `update-available`.
2. **Download and verify.** `InstallUpdate` and `ReinstallLatestRelease` call `startInstall`, which runs `install`. `install` checks the signature on `checksums.txt` (`verifyChecksums`) before the build downloads, then compares the build's hash. Progress is sent as `update-progress`.
3. **Install.** The `platformInstaller` from `defaultInstaller` stages the build beside the running one and swaps it in. Each OS has its own `update_platform_<goos>.go`. On macOS, a Marasi.app that Gatekeeper translocated (opened straight from Downloads) installs into the bundle it was translocated from (`bundleInstaller.locate`, `translocationOriginal`). `finishInstall` sends `update-installed` or `update-failed`.
4. **Relaunch.** `RestartToUpdate` sets `App.restarting` and quits, which `shouldQuit` lets through without asking. `ServiceShutdown` calls `relaunchIfRestarting` last. The next start removes the leftovers (`removeUpdateLeftovers`).

**Not this updater.** The connected Marasi service updating its own binary (`marasi update`) arrives as the service's `update.available`, `.progress`, `.installed` and `.failed` events, not as these Wails events. `stores/serviceUpdateStore.js` keeps them apart, and Settings → Marasi CLI shows them (see `marasi-service.md`, Events).

The updater uses its own HTTP client (`updateHTTPClient`), which honours the system proxy but never sends through the local instance's proxy listener (`isMarasiListener` reads it from `service status` through `localProxyListener`).

## Frontend

`frontend/src/stores/updateStore.js` calls the bindings and holds `updateState`. `frontend/src/lib/updates.js` holds the logic and the text, and `UpdateModal.svelte` draws the panel. `+layout.svelte` subscribes to the four events by name. Remove each one in the same cleanup. The menu action is `global.check-for-updates` in the keybinding catalog (see `keybindings-and-menus.md`). The Settings page has an `updates` section.

## Strings that must match

Changing one of these means changing the others:

- **Event names:** the constants in `update.go` and `update_install.go`, and the `on` names in `+layout.svelte`.
- **Asset names:** each `defaultInstaller`, the `asset` matrix in `.github/workflows/build.yml`, and the checksum and upload lists in `release.yml` and `nightly.yml`. The builds take their file names from `APP_NAME` in `Taskfile.yml` (`bin/marasi-app`, `bin/marasi-app.exe`, `bin/marasi-app.app`), and `build.yml` signs and zips `bin/marasi-app.app` into `marasi-app.app.zip`.
- **Version formats:** `parseReleaseVersion` and the `release.yml` tag pattern, and `parseNightlyVersion` and `nightlyCommit` and the nightly release title and notes in `nightly.yml`.
- **Build identity:** the `build_info.go` variables, including the public signing key. `build.yml` sets `CHANNEL`, `VERSION` and `SIGNING_PUBLIC_KEY` in the environment, and `LDFLAGS_X` in `build/darwin`, `build/windows` and `build/linux/Taskfile.yml` turns them into `-X` flags. A development build has no channel, so it cannot check or install.
- **Failure kinds and steps:** `UpdateFailureKind` and `InstallStep` in Go, and `failureTitles` and the step ids in `updates.js`.

## Test builds

To build a branch or commit without publishing, run the build workflow by hand:

```sh
gh workflow run build.yml --ref <branch> -f channel=nightly
```

`--ref` picks the branch whose `build.yml` runs and, without `-f ref=<commit>`, the commit it builds. `-f version=…` and `-f marasi_ref=…` are optional. The run builds every platform, then signs, notarizes and staples the macOS bundle, as a nightly does. It has only read access, so it creates no release, tag or nightly. The assets are the run's workflow artifacts, which no updater reads: `gh run download <run-id>`. The checksums are not signed, because that happens in the publishing jobs.

## Decisions

- [Updates are verified against a signing key built into the app](../../adr/2026-10-17-updates-are-signed-with-an-embedded-key.md)
- [Switching channel never installs an older build on its own](../../adr/2026-10-17-switching-channel-never-downgrades.md)
