import { get, writable } from "svelte/store";
import {
  CancelUpdateDownload,
  CheckForUpdate,
  DismissUpdate,
  GetUpdateState,
  InstallUpdate,
  ReinstallLatestRelease,
  RestartToUpdate,
  SetUpdateChannel,
} from "../lib/wailsjs/go/main/App";
import { toastError } from "../lib/toasts.js";
import {
  checkResultNotice,
  withCheckResult,
  withFailure,
  withInstallResult,
  withInstallStarted,
  withInstalled,
  withProgress,
  withUpdateFound,
} from "../lib/updates.js";

// The app's update state (the Go UpdateState): what the update indicator and
// details panel show. Refreshed from Go on load, so a reloaded frontend shows
// an update found, downloading or installed before it reloaded, and updated
// by update events.
export const updateState = writable({
  Status: "unavailable",
  Channel: "",
  Running: null,
  Update: null,
  CanInstall: false,
  CannotInstallReason: "",
  Progress: null,
  Failure: null,
});

/** Reads the current update state from Go. */
export function refreshUpdateState() {
  return GetUpdateState()
    .then((state) => updateState.set(state))
    .catch((err) => console.error("Reading the update state failed:", err));
}

/**
 * Hides the available update until a newer build is published. Resolves with
 * the new state; rejects when the dismissal could not be saved.
 */
export function dismissUpdate() {
  return DismissUpdate().then((state) => {
    updateState.set(state);
    return state;
  });
}

/**
 * "Check for updates…" from the menu or Settings → Updates: checks, records
 * what it found (an update, or none, which closes an open panel), then calls
 * openPanel for an update, or toasts that the build is the latest on its
 * channel, or why the check failed. Resolves once that is shown.
 */
export function checkForUpdatesAndShowResult(toastStore, openPanel) {
  return CheckForUpdate()
    .then((check) => {
      updateState.update((state) => withCheckResult(state, check));
      const notice = checkResultNotice(check);
      if (notice) {
        toastStore.trigger(notice);
      } else {
        openPanel();
      }
    })
    .catch((err) => toastError(toastStore, "Could not check for updates", err));
}

/** Records an update found by a check (the update-available event). */
export function onUpdateAvailable(update) {
  updateState.update((state) => withUpdateFound(state, update));
}

/**
 * Records download progress (the update-progress event). Progress for an
 * install this frontend did not start (a reinstall, which Go begins only after
 * its warning) reads the state from Go, so the panel shows what is installing.
 */
export function onUpdateProgress(progress) {
  if (get(updateState).Status !== "downloading") {
    refreshUpdateState();
    return;
  }
  updateState.update((state) => withProgress(state, progress));
}

/** Records an installed update waiting for a restart (the update-installed event). */
export function onUpdateInstalled(update) {
  updateState.update((state) => withInstalled(state, update));
}

/** Records a failed install (the update-failed event). */
export function onUpdateFailed(failure) {
  updateState.update((state) => withFailure(state, failure));
}

/** Installs the known update; progress and the outcome also arrive as events. */
export function installUpdate() {
  updateState.update(withInstallStarted);
  return InstallUpdate()
    .then((result) => updateState.update((state) => withInstallResult(state, result)))
    .catch((err) => {
      console.error("Installing the update failed:", err);
      return refreshUpdateState();
    });
}

/** Aborts the running download. */
export function cancelUpdateDownload() {
  return CancelUpdateDownload();
}

/**
 * Saves the Channel ("release" or "nightly"). Resolves with the ChannelChange
 * (its Check is set when switching to nightly checked right away) once the
 * update state is read again, since the switch forgets an update found on the
 * other channel.
 */
export function setUpdateChannel(channel) {
  return SetUpdateChannel(channel).then((change) => refreshUpdateState().then(() => change));
}

/**
 * "Reinstall latest release": Go warns about newer projects first, then
 * installs like an update. Progress arrives as events; resolves with the
 * UpdateInstall result once the state is read again.
 */
export function reinstallLatestRelease() {
  return ReinstallLatestRelease().then((result) => refreshUpdateState().then(() => result));
}

/** "Restart now": resolves to whether Marasi is restarting. */
export function restartToUpdate() {
  return RestartToUpdate();
}
