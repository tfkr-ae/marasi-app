// What the frontend shows for updates (GLOSSARY "Updates"). The Go side
// decides whether a build is an update; this module turns its UpdateCheck and
// UpdateState into what the researcher sees.

/**
 * The toast a "Check for updates…" result shows, or null when the details
 * panel opens instead (an update was found).
 */
export function checkResultNotice(check) {
  switch (check?.Outcome) {
    case "available":
      return null;
    case "none":
      return {
        message: `You're on the latest ${check.Channel} build`,
        background: "variant-filled-success",
      };
    case "unavailable":
      return {
        message: "Development builds don't check for updates",
        background: "variant-filled-warning",
      };
    default:
      return {
        message: `Could not check for updates: ${check?.Reason || "unknown error"}`,
        background: "variant-filled-error",
      };
  }
}

/** Where the details panel's link to the Channel setting goes. */
export const channelSettingPath = "/settings?section=updates";

/**
 * The toast after the Channel setting changes (a ChannelChange), or null when
 * the check a switch to nightly runs found an update and the panel opens
 * instead. A nightly switched to release keeps running (docs/adr/2026-10-17-switching-channel-never-downgrades.md), so the
 * toast says so and points to the reinstall.
 */
export function channelSwitchNotice(change, running) {
  if (change?.Check) {
    return checkResultNotice(change.Check);
  }
  const channel = change?.Settings?.Channel ?? "";
  if (channel === "release" && running?.Channel === "nightly") {
    return {
      message:
        "Switched to release. You keep this nightly until a newer release is published; Reinstall latest release goes back now.",
      background: "variant-filled-success",
    };
  }
  return { message: `Switched to ${channel}`, background: "variant-filled-success" };
}

/**
 * A nightly's notes as the details panel shows them: only the commit
 * subjects the nightly workflow lists, without its Ref line, the Commit
 * line Marasi reads the nightly's commit from, or the Marasi line naming the
 * marasi commit it was built against. A nightly published before the
 * workflow listed subjects has only those lines, so it has
 * nothing to show ("") and the panel shows the compare link alone.
 */
export function nightlyNotes(notes) {
  return (notes ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^(Ref|Commit|Marasi):/.test(line.trim()))
    .join("\n")
    .trim();
}

/** The modal settings that open the update details panel. */
export function updatePanelModal() {
  return {
    type: "component",
    component: "Update",
    title: "Update",
    toggleAction: "global.check-for-updates",
  };
}

// Statuses in which an update is known, from found until the restart.
const updateStatuses = new Set(["available", "downloading", "failed", "restart-pending"]);

/** Whether the update indicator shows in the app chrome for state. */
export function showsUpdateIndicator(state) {
  return updateStatuses.has(state?.Status) && Boolean(state.Update);
}

/** The indicator's tooltip and label for state. */
export function updateIndicatorLabel(state) {
  const version = state?.Update?.Version ?? "";
  switch (state?.Status) {
    case "downloading":
      return installingLine(state.Progress, `update ${version}`, null);
    case "failed":
      return `Update ${version} failed to install`;
    case "restart-pending":
      return `Restart Marasi to run ${version}`;
    default:
      return `Update available: ${version}`;
  }
}

/**
 * What the Settings icon carries for state, or null when no update is known:
 * - { kind: "ring", percent, spinning }: a ring around the icon filling with
 *   the download, full and spinning while verifying and installing;
 * - { kind: "dot", tone, pulse }: a dot, "success" for an available update,
 *   "error" after a failed install, "tertiary" and pulsing while a restart
 *   is waiting.
 */
export function settingsIconIndicator(state) {
  if (!showsUpdateIndicator(state)) {
    return null;
  }
  if (state.Status === "downloading") {
    if (installingStepLabel(state.Progress)) {
      return { kind: "ring", percent: 100, spinning: true };
    }
    return { kind: "ring", percent: progressPercent(state.Progress) ?? 0, spinning: false };
  }
  const tones = { failed: "error", "restart-pending": "tertiary" };
  return {
    kind: "dot",
    tone: tones[state.Status] ?? "success",
    pulse: state.Status === "restart-pending",
  };
}

/** Where the Settings icon goes: Settings → Updates while an update is waiting. */
export function settingsPath(state) {
  return showsUpdateIndicator(state) ? channelSettingPath : "/settings";
}

/**
 * The update panel's steps. Download, Verify and Install are the install's
 * steps, as Go reports them (UpdateProgress.Step, UpdateFailure.Step).
 */
export const UpdateStep = Object.freeze({
  details: "details",
  download: "download",
  verify: "verify",
  install: "install",
  restart: "restart",
});

// The panel's steps in order: each step's label, its label while it runs,
// and the panel's heading while it is the current step.
const updateSteps = Object.freeze(
  [
    { id: UpdateStep.details, label: "Details", running: "Details", heading: "What's new" },
    { id: UpdateStep.download, label: "Download", running: "Downloading", heading: "Downloading" },
    { id: UpdateStep.verify, label: "Verify", running: "Verifying", heading: "Verifying" },
    { id: UpdateStep.install, label: "Install", running: "Installing", heading: "Installing" },
    { id: UpdateStep.restart, label: "Restart", running: "Restart", heading: "Ready to restart" },
  ].map((step) => Object.freeze(step)),
);

/** The table entry for step id. */
function updateStep(id) {
  return updateSteps.find((step) => step.id === id);
}

/** "Verifying" or "Installing" for an install past its download, else null. */
function installingStepLabel(progress) {
  const step = progress?.Step;
  return step === UpdateStep.verify || step === UpdateStep.install ? updateStep(step).running : null;
}

/**
 * What a running install is doing, about subject: "Verifying subject…" or
 * "Installing subject…" past the download, else "Downloading subject · n%",
 * with unknownPercent standing in for a download of unknown size (null
 * leaves the percentage out).
 */
function installingLine(progress, subject, unknownPercent) {
  const step = installingStepLabel(progress);
  if (step) {
    return `${step} ${subject}…`;
  }
  const percent = progressPercent(progress) ?? unknownPercent;
  return percent === null ? `Downloading ${subject}` : `Downloading ${subject} · ${percent}%`;
}

/** How much of the build has downloaded, in whole percent, or null when its size is unknown. */
export function progressPercent(progress) {
  if (!progress?.Total) {
    return null;
  }
  return Math.floor((progress.Received * 100) / progress.Total);
}

const megabyte = 1024 * 1024;

/** How much of the build has downloaded, in megabytes, of its size when known. */
export function downloadedAmount(progress) {
  const received = ((progress?.Received ?? 0) / megabyte).toFixed(1);
  if (!progress?.Total) {
    return `${received} MB`;
  }
  return `${received} of ${(progress.Total / megabyte).toFixed(1)} MB`;
}

/** Whether Cancel can stop the running install: only while it downloads. */
export function cancellable(progress) {
  return !progress?.Step || progress.Step === UpdateStep.download;
}

const failureTitles = {
  network: "Download failed",
  signature: "Signature check failed",
  checksum: "Checksum check failed",
  team: "Developer team check failed",
  permissions: "Marasi cannot replace itself",
  install: "Install failed",
};

const noBuildMessage = "This release has no build for your platform";

/** A failed install's title (an UpdateFailure), without its reason. */
function installFailureTitle(failure) {
  if (failure?.Kind === "no-build") {
    return noBuildMessage;
  }
  return failureTitles[failure?.Kind] ?? "Install failed";
}

/** What the panel says about a failed install (an UpdateFailure). */
export function installFailureMessage(failure) {
  if (failure?.Kind === "no-build") {
    return noBuildMessage;
  }
  return `${installFailureTitle(failure)}: ${failure?.Reason || "unknown error"}`;
}

/**
 * The update panel's steps for state: the step it is on (current) and the
 * heading it gives the right pane, whether the install failed there, and
 * each step's mark: done (ticked), current (outlined, with its -ing label),
 * failed (red, with its plain label), todo (dimmed) or skipped (passed over
 * without running).
 */
export function updatePanelSteps(state) {
  let current = UpdateStep.details;
  let failed = false;
  if (state?.Status === "available" && state.CanInstall === false) {
    current = UpdateStep.install;
    failed = true;
  } else if (state?.Status === "downloading") {
    current = state.Progress?.Step || UpdateStep.download;
  } else if (state?.Status === "restart-pending") {
    current = UpdateStep.restart;
  } else if (state?.Status === "failed") {
    current = state.Failure?.Step || UpdateStep.install;
    failed = true;
  }
  // A build that can't install updates is found out before anything
  // downloads: the steps before the one it stopped at never ran.
  const skipped = cannotInstall(state);
  const index = updateSteps.findIndex(({ id }) => id === current);
  return {
    current,
    heading: updateSteps[index]?.heading ?? "",
    failed,
    steps: updateSteps.map(({ id, label, running }, i) => {
      let mark = "todo";
      if (i === index) {
        mark = failed ? "failed" : "current";
      } else if (i < index) {
        mark = skipped && i > 0 ? "skipped" : "done";
      }
      return { id, label: mark === "current" ? running : label, mark };
    }),
  };
}

/**
 * The update panel's error box for state, or null when nothing failed:
 * what failed (message), and whether Try again could help (retry). It
 * cannot where this build can't install updates at all or the release has
 * no build for this platform.
 */
export function updatePanelFailure(state) {
  if (state?.Status === "available" && state.CanInstall === false) {
    return { message: state.CannotInstallReason || "Marasi cannot replace itself", retry: false };
  }
  if (state?.Status !== "failed") {
    return null;
  }
  const failure = state.Failure;
  if (failure?.BeforeDownload) {
    return { message: failure.Reason || installFailureTitle(failure), retry: false };
  }
  return { message: installFailureMessage(failure), retry: failure?.Kind !== "no-build" };
}

/**
 * Whether this build can't install updates at all (no signing key, no
 * installer for the platform, an install location it cannot write to):
 * found before Install is offered (CanInstall), or by the same check when
 * the install started, before anything downloaded (BeforeDownload).
 */
function cannotInstall(state) {
  if (state?.Status === "available") {
    return state.CanInstall === false;
  }
  return state?.Status === "failed" && Boolean(state.Failure?.BeforeDownload);
}

/** The status row of Settings → Updates: where the researcher stands for state. */
export function updateStatusLine(state) {
  if (state?.Status === "unavailable") {
    return "Development builds don't check for updates";
  }
  if (!showsUpdateIndicator(state)) {
    return "Up to date";
  }
  const version = state.Update.Version;
  switch (state.Status) {
    case "downloading":
      return installingLine(state.Progress, version, 0);
    case "restart-pending":
      return `${version} ready to restart`;
    case "failed":
      return installFailureTitle(state.Failure);
    default:
      return `${version} available`;
  }
}

/**
 * The state after a check found update (the update-available event, or a
 * "Check for updates…" result). An update downloading or waiting for a
 * restart stays: it is what the researcher chose to install.
 */
export function withUpdateFound(state, update) {
  if (state?.Status === "downloading" || state?.Status === "restart-pending") {
    return state;
  }
  return { ...state, Status: "available", Update: update, Progress: null, Failure: null };
}

/**
 * The state after "Check for updates…" returns its UpdateCheck. Like Go, a
 * check that finds nothing forgets the known update (so the panel closes),
 * unless it is downloading or waiting for a restart; a failed check changes
 * nothing.
 */
export function withCheckResult(state, check) {
  switch (check?.Outcome) {
    case "available":
      return withUpdateFound(state, check.Update);
    case "none":
      if (state?.Status === "downloading" || state?.Status === "restart-pending") {
        return state;
      }
      return { ...state, Status: "idle", Update: null, Progress: null, Failure: null };
    default:
      return state;
  }
}

/** The state once the researcher chose Install, before any progress. */
export function withInstallStarted(state) {
  return { ...state, Status: "downloading", Progress: null, Failure: null };
}

/** The state after an update-progress event; ignored unless downloading. */
export function withProgress(state, progress) {
  if (state?.Status !== "downloading") {
    return state;
  }
  return { ...state, Progress: progress };
}

/** The state after an update-installed event: installed, waiting for a restart. */
export function withInstalled(state, update) {
  return { ...state, Status: "restart-pending", Update: update, Progress: null, Failure: null };
}

/** The state after an update-failed event. */
export function withFailure(state, failure) {
  return { ...state, Status: "failed", Progress: null, Failure: failure };
}

/** The state once InstallUpdate returns its UpdateInstall result. */
export function withInstallResult(state, result) {
  switch (result?.Outcome) {
    case "installed":
      return withInstalled(state, result.Update ?? state.Update);
    case "failed":
      return withFailure(state, result.Failure);
    default:
      return { ...state, Status: "available", Progress: null };
  }
}
