# Updates

How the app checks for, downloads, verifies, installs and relaunches into an update, and which strings must match between the main process, the frontend, the packaging config and the release workflows. v2's updater is v1's Go updater (`update*.go` on `main`) ported into the main process as plain modules in `electron/updater/`, with the filesystem, processes, network and timers passed in. Names are functions and files, so search for them.

## Order

1. **Check.** The `update:checkForUpdate` IPC call (the menu action and Settings), `setUpdateChannel` and the `startUpdateChecks` schedule run `check` in `updater.js`. `findUpdate` picks `findReleaseUpdate` or `findNightlyUpdate` by the channel, reading GitHub through `releases.js`. A new update is sent as `update-available`.
2. **Download and verify.** `installUpdate` and `reinstallLatestRelease` call `runInstall`, which runs `install`. `install` checks the signature on `checksums.txt` (`verifyChecksums` in `verify.js`, minisign over node:crypto's Ed25519) before the build downloads, then compares the build's hash. Progress is sent as `update-progress`.
3. **Install.** The installer from `defaultInstaller` in `installers.js` stages the build beside the running one and swaps it in: the `.app` from a zip on macOS (`bundleInstaller`, with the developer team check), the portable `.exe` moved aside on Windows (`exeInstaller`), the AppImage on Linux (`binaryInstaller`). `locateInstall` finds what to replace. `finishInstall` sends `update-installed` or `update-failed`.
4. **Relaunch.** `restartToUpdate` sets `restarting` and quits. `main.js`'s `before-quit` stops the instances the app started, then calls `relaunchIfRestarting`. The next start removes the leftovers (`removeUpdateLeftovers`).

Update requests use their own Electron sessions (`updateNetwork` in `main.js`, `updater/updateNet.js`): the system proxy, or the proxy environment variables when set, unless that proxy is a local instance's proxy listener, in which case they go direct.

## Separation from v1

- **Settings.** v2 keeps its update settings in the app config's `v2_update_channel`, `v2_update_checks` and `v2_dismissed_update` (`updateKeys`), through `appConfig.v2Value` and `setV2Value`, which refuse any other key. v1's `update_channel`, `update_checks` and `dismissed_update` are never read or written.
- **Channels.** `followableChannels`: a `v2-nightly` build follows only `v2-nightly`, so it never reads v1's `nightly` release or the latest release, and has no release to reinstall. Settings shows `UpdateSettings.Channels`.
- **Feed.** The `v2-nightly` release is a prerelease that is never the latest, titled `DD.MM.YYYY (v2-nightly <commit>)`. `parseNightlyVersion` takes the line it reads, so neither nightly reads the other's title. Its assets are `marasi-v2-*`, which a v1 build never installs.
- **App.** v2 has its own app ID and name (`ae.tfkr.marasi-app.v2`, "Marasi v2"), so it installs beside v1.

## Frontend

`frontend/src/lib/bindings/updates.js` makes the v1 bindings (`CheckForUpdate`, …) call `marasiApp.updates` in the preload. `runtime.js`'s `EventsOn` delivers the four update events from `marasiApp.onUpdateEvent`. `frontend/src/stores/updateStore.js` holds `updateState`. `frontend/src/lib/updates.js` holds the logic and the text, and `UpdateModal.svelte` draws the panel. `+layout.svelte` subscribes to the four events by name, and removes each one in the same cleanup. The menu action is `global.check-for-updates` in the keybinding catalog (see `keybindings-and-menus.md`). The Settings page has an `updates` section.

## Strings that must match

Changing one of these means changing the others. `electron/updater/releaseStrings.test.js` checks the asset names and the version format against `package.json` and the workflows.

- **Event names:** `updateEvents` in `updater.js`, `mainEvents` in `runtime.js`, and the `EventsOn` names in `+layout.svelte`.
- **Asset names:** `updateAssets` in `installers.js`, the `artifactName`s in `package.json`'s `build`, the `assets` matrix in `.github/workflows/build.yml`, and the checksum and upload lists in `v2-nightly.yml`.
- **Version format:** `parseNightlyVersion` and `nightlyCommit` in `version.js`, and the version, release title and notes in `v2-nightly.yml`.
- **Build identity:** `package.json`'s `marasiBuild` (`channel`, `version`, `signingPublicKey`), which `build.yml` sets with `npm pkg set` and `buildInfo.js` reads. A build without it is a development build: no channel, so it can't check or install.
- **Failure kinds and steps:** `failure.js` and the steps in `updater.js`, and `failureTitles` and the step ids in `updates.js`.

## Workflows

`build.yml` builds the Electron app with the bundled Marasi for each platform, and signs and notarizes the macOS app with v1's Developer ID secrets. `v2-nightly.yml` runs on each push to `v2` and by hand (GitHub runs scheduled workflows only from the default branch), then signs `checksums.txt` with the Marasi signing key and publishes the `v2-nightly` release. v1's `nightly.yml` and `release.yml` live on `main` only, so a run on `v2` can't publish to v1's feeds. The release workflow comes back when v2 replaces v1.

## Decisions

- [Updates are verified against a signing key built into the app](../../adr/2026-10-17-updates-are-signed-with-an-embedded-key.md)
- [Switching channel never installs an older build on its own](../../adr/2026-10-17-switching-channel-never-downgrades.md)

## Differences from v1

- A macOS app that Gatekeeper translocated (opened straight from Downloads) asks to be moved to Applications. v1 found the original bundle through a private Security.framework call, which plain Electron can't make.
- The Windows build is electron-builder's portable `.exe`, which keeps v1's one-file install. An NSIS install has no single file to replace.
- "Restart now" asks first when any window holds dirty Launchpad drafts (`confirmLosingWork` in `main.js`, `confirmLosingDrafts`), and the quit it makes doesn't ask again. It doesn't yet warn about active Armory runs; their ticket adds that.

## Instance updates (v2)

A service instance updates itself through Marasi's `/update` routes, separately from the app's own updater above. `frontend/src/stores/createInstanceUpdateStore.js` holds the logic; `instanceUpdateStore.js` wires it to the Marasi client and reads the instance again whenever the window's connection changes. `InstanceVersion.svelte` draws the version, Check for updates, Install, the install's progress and Restart in the Dashboard's connection status.

- **Reads.** `reload` reads `GET /service/status` (version, `restart_required`) and `GET /update`. An instance without `/update` still shows its version, with no update actions. The store is in `marasiEvents.js`'s `stores`, so it reloads when the stream reopens.
- **Bundled Marasi.** The update actions are hidden when a local instance's `install_path` is the bundled Marasi (`runsBundled` in `electron/marasiBin.js`, links resolved), since it updates with the app. A remote instance is never treated as bundled. Restart shows for any instance whose build was replaced.
- **Events.** `update.available`, `update.progress`, `update.installed` (which sets restart needed), `update.failed`, `service.restarting` and `service.restart_failed` go to the store's `on*` methods.
- **Restart.** `POST /service/restart` answers once the successor runs on the same address and token, so the store reads it again and the event stream reopens on its own. `409 checkpoint_items_held` asks before a forced restart drops the held items.
- A development build answers `409 development_build` to check and install, and reports `development: true`, which disables Check for updates.
