import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReinstallRelease,
  channelChoices,
  channelLabel,
  channelSettingPath,
  isNightlyChannel,
  channelSwitchNotice,
  cancellable,
  checkResultNotice,
  downloadedAmount,
  installFailureMessage,
  nightlyNotes,
  progressPercent,
  settingsIconIndicator,
  settingsPath,
  showsUpdateIndicator,
  updateIndicatorLabel,
  updatePanelFailure,
  updatePanelSteps,
  updateStatusLine,
  withCheckResult,
  withFailure,
  withInstallResult,
  withInstallStarted,
  withInstalled,
  withProgress,
  withUpdateFound,
} from "./updates.js";

const running = { Channel: "release", Version: "16.10.2026" };

test("a check that finds nothing says the researcher is on the latest build of their channel", () => {
  assert.deepEqual(checkResultNotice({ Outcome: "none", Channel: "release", Running: running }), {
    message: "You're on the latest release build",
    background: "variant-filled-success",
  });
  assert.equal(
    checkResultNotice({ Outcome: "none", Channel: "nightly", Running: running }).message,
    "You're on the latest nightly build",
  );
});

test("a failed check states the reason", () => {
  assert.deepEqual(
    checkResultNotice({ Outcome: "failed", Channel: "release", Reason: "could not reach GitHub: no such host" }),
    {
      message: "Could not check for updates: could not reach GitHub: no such host",
      background: "variant-filled-error",
    },
  );
});

test("a development build says it does not check for updates", () => {
  assert.deepEqual(checkResultNotice({ Outcome: "unavailable", Channel: "" }), {
    message: "Development builds don't check for updates",
    background: "variant-filled-warning",
  });
});

test("a check that finds an update has no notice, because the details panel opens instead", () => {
  assert.equal(checkResultNotice({ Outcome: "available", Update: { Version: "17.10.2026" } }), null);
});

test("the indicator shows from an available update until the restart", () => {
  const update = { Version: "17.10.2026" };
  for (const Status of ["available", "downloading", "failed", "restart-pending"]) {
    assert.equal(showsUpdateIndicator({ Status, Update: update }), true, Status);
  }
  assert.equal(showsUpdateIndicator({ Status: "idle" }), false);
  assert.equal(showsUpdateIndicator({ Status: "unavailable" }), false);
  assert.equal(showsUpdateIndicator(null), false);
});

test("the indicator says when a restart is pending", () => {
  const update = { Version: "17.10.2026" };
  assert.equal(updateIndicatorLabel({ Status: "available", Update: update }), "Update available: 17.10.2026");
  assert.equal(updateIndicatorLabel({ Status: "downloading", Update: update }), "Downloading update 17.10.2026");
  assert.equal(updateIndicatorLabel({ Status: "failed", Update: update }), "Update 17.10.2026 failed to install");
  assert.equal(
    updateIndicatorLabel({ Status: "restart-pending", Update: update }),
    "Restart Marasi to run 17.10.2026",
  );
});

test("download progress is a whole percentage, or unknown without a size", () => {
  assert.equal(progressPercent({ Received: 0, Total: 200 }), 0);
  assert.equal(progressPercent({ Received: 101, Total: 200 }), 50);
  assert.equal(progressPercent({ Received: 200, Total: 200 }), 100);
  assert.equal(progressPercent({ Received: 5, Total: 0 }), null);
  assert.equal(progressPercent(null), null);
});

test("only the download can be cancelled", () => {
  assert.equal(cancellable({ Step: "download", Received: 5, Total: 200 }), true);
  assert.equal(cancellable(null), true);
  assert.equal(cancellable({ Step: "verify", Received: 200, Total: 200 }), false);
  assert.equal(cancellable({ Step: "install", Received: 200, Total: 200 }), false);
});

test("a failed install says which check failed and why", () => {
  const cases = [
    ["network", "Download failed"],
    ["signature", "Signature check failed"],
    ["checksum", "Checksum check failed"],
    ["team", "Developer team check failed"],
    ["permissions", "Marasi cannot replace itself"],
    ["install", "Install failed"],
  ];
  for (const [Kind, title] of cases) {
    assert.equal(installFailureMessage({ Kind, Reason: "the reason" }), `${title}: the reason`, Kind);
  }
});

test("a release with no build for this platform says so plainly", () => {
  assert.equal(
    installFailureMessage({ Kind: "no-build", Reason: "this release has no build for your platform (marasi-app)" }),
    "This release has no build for your platform",
  );
});

test("update events move the panel through download, install and failure", () => {
  const update = { Version: "17.10.2026" };
  const available = { Status: "available", Update: update, Progress: null, Failure: null };

  const started = withInstallStarted(available);
  assert.equal(started.Status, "downloading");
  assert.equal(started.Progress, null);

  const downloading = withProgress(started, { Received: 10, Total: 100 });
  assert.equal(downloading.Status, "downloading");
  assert.deepEqual(downloading.Progress, { Received: 10, Total: 100 });

  const installed = withInstalled(downloading, update);
  assert.equal(installed.Status, "restart-pending");
  assert.equal(installed.Progress, null);

  const failure = { Kind: "checksum", Reason: "mismatch", ReleasePage: "https://example" };
  const failed = withFailure(downloading, failure);
  assert.equal(failed.Status, "failed");
  assert.equal(failed.Progress, null);
  assert.deepEqual(failed.Failure, failure);
});

test("progress that arrives after the install ended is ignored", () => {
  const update = { Version: "17.10.2026" };
  const installed = { Status: "restart-pending", Update: update, Progress: null, Failure: null };

  assert.deepEqual(withProgress(installed, { Received: 2, Total: 2 }), installed);
});

test("a cancelled install makes the update available again", () => {
  const update = { Version: "17.10.2026" };
  const downloading = { Status: "downloading", Update: update, Progress: { Received: 1, Total: 2 }, Failure: null };

  const cancelled = withInstallResult(downloading, { Outcome: "cancelled", Update: update });

  assert.equal(cancelled.Status, "available");
  assert.equal(cancelled.Progress, null);
});

test("switching to nightly shows what the immediate check found, or opens the panel for an update", () => {
  const none = channelSwitchNotice(
    { Settings: { Channel: "nightly" }, Check: { Outcome: "none", Channel: "nightly" } },
    running,
  );
  assert.equal(none.message, "You're on the latest nightly build");
  assert.equal(
    channelSwitchNotice(
      { Settings: { Channel: "nightly" }, Check: { Outcome: "available", Channel: "nightly" } },
      running,
    ),
    null,
  );
});

test("switching a nightly to release says the nightly stays until a newer release", () => {
  const nightly = { Channel: "nightly", Version: "17.10.2026 (nightly abc1234)" };

  assert.deepEqual(channelSwitchNotice({ Settings: { Channel: "release" }, Check: null }, nightly), {
    message: "Switched to release. You keep this nightly until a newer release is published; Reinstall latest release goes back now.",
    background: "variant-filled-success",
  });
  assert.equal(
    channelSwitchNotice({ Settings: { Channel: "release" }, Check: null }, running).message,
    "Switched to release",
  );
});

test("a found update makes it available and clears an earlier failure", () => {
  const update = { Version: "18.10.2026" };
  const failed = { Status: "failed", Update: { Version: "17.10.2026" }, Progress: null, Failure: { Kind: "network" } };

  assert.deepEqual(withUpdateFound(failed, update), { Status: "available", Update: update, Progress: null, Failure: null });
});

test("a found update never replaces one downloading or waiting for a restart", () => {
  const installing = { Version: "17.10.2026" };
  const downloading = { Status: "downloading", Update: installing, Progress: { Received: 1, Total: 2 }, Failure: null };
  const installed = { Status: "restart-pending", Update: installing, Progress: null, Failure: null };

  assert.deepEqual(withUpdateFound(downloading, { Version: "18.10.2026" }), downloading);
  assert.deepEqual(withUpdateFound(installed, { Version: "18.10.2026" }), installed);
});

test("the details panel links to the Channel setting in Settings → Updates", () => {
  assert.equal(channelSettingPath, "/settings?section=updates");
});

test("Settings → Updates says the build is up to date when no update is known", () => {
  assert.equal(updateStatusLine({ Status: "idle", Update: null }), "Up to date");
});

test("Settings → Updates names an available update", () => {
  assert.equal(updateStatusLine({ Status: "available", Update: { Version: "18.10.2026" } }), "18.10.2026 available");
});

test("Settings → Updates shows how far an update has downloaded", () => {
  const state = { Status: "downloading", Update: { Version: "18.10.2026" }, Progress: { Received: 37, Total: 100 } };

  assert.equal(updateStatusLine(state), "Downloading 18.10.2026 · 37%");
});

test("Settings → Updates shows 0% before the first progress arrives", () => {
  const state = { Status: "downloading", Update: { Version: "18.10.2026" }, Progress: null };

  assert.equal(updateStatusLine(state), "Downloading 18.10.2026 · 0%");
});

test("Settings → Updates names an installed update waiting for a restart", () => {
  assert.equal(updateStatusLine({ Status: "restart-pending", Update: { Version: "18.10.2026" } }), "18.10.2026 ready to restart");
});

test("Settings → Updates shows a failed install by its title, without the reason", () => {
  const state = { Status: "failed", Update: { Version: "18.10.2026" }, Failure: { Kind: "checksum", Reason: "sha mismatch" } };

  assert.equal(updateStatusLine(state), "Checksum check failed");
});

test("Settings → Updates says a release with no build for this platform", () => {
  const state = { Status: "failed", Update: { Version: "18.10.2026" }, Failure: { Kind: "no-build", Reason: "" } };

  assert.equal(updateStatusLine(state), "This release has no build for your platform");
});

test("Settings → Updates says a development build does not check", () => {
  assert.equal(updateStatusLine({ Status: "unavailable", Update: null }), "Development builds don't check for updates");
});

// The panel's steps as "label:mark" pairs, for compact assertions.
const marks = (state) => updatePanelSteps(state).steps.map((step) => `${step.label}:${step.mark}`);
const update = { Version: "17.10.2026", ReleasePage: "https://example.test/17.10.2026" };

test("an available update opens the panel at Details, with the later steps still to come", () => {
  const state = { Status: "available", Update: update, CanInstall: true };
  assert.equal(updatePanelSteps(state).current, "details");
  assert.deepEqual(marks(state), ["Details:current", "Download:todo", "Verify:todo", "Install:todo", "Restart:todo"]);
});

test("a running install ticks the finished steps and outlines the running one with its -ing label", () => {
  const at = (Step) => ({ Status: "downloading", Update: update, Progress: { Step, Received: 5, Total: 10 } });
  assert.deepEqual(marks({ Status: "downloading", Update: update, Progress: null }), [
    "Details:done", "Downloading:current", "Verify:todo", "Install:todo", "Restart:todo",
  ]);
  assert.deepEqual(marks(at("verify")), ["Details:done", "Download:done", "Verifying:current", "Install:todo", "Restart:todo"]);
  assert.deepEqual(marks(at("install")), ["Details:done", "Download:done", "Verify:done", "Installing:current", "Restart:todo"]);
  assert.equal(updatePanelSteps(at("install")).current, "install");
});

test("the panel heads its right pane with the current step", () => {
  const at = (Step) => ({ Status: "downloading", Update: update, Progress: { Step, Received: 5, Total: 10 } });
  assert.equal(updatePanelSteps({ Status: "available", Update: update, CanInstall: true }).heading, "What's new");
  assert.equal(updatePanelSteps(at("download")).heading, "Downloading");
  assert.equal(updatePanelSteps(at("verify")).heading, "Verifying");
  assert.equal(updatePanelSteps(at("install")).heading, "Installing");
  assert.equal(updatePanelSteps({ Status: "restart-pending", Update: update }).heading, "Ready to restart");
});

test("an installed update waiting for a restart is at Restart, with every earlier step ticked", () => {
  const state = { Status: "restart-pending", Update: update };
  assert.equal(updatePanelSteps(state).current, "restart");
  assert.deepEqual(marks(state), ["Details:done", "Download:done", "Verify:done", "Install:done", "Restart:current"]);
});

test("a failed install stops the steps, in red with its plain label, at the step it failed at", () => {
  const failedAt = (Kind, Step) => ({ Status: "failed", Update: update, Failure: { Kind, Step, Reason: "r" } });
  assert.deepEqual(marks(failedAt("network", "download")), [
    "Details:done", "Download:failed", "Verify:todo", "Install:todo", "Restart:todo",
  ]);
  assert.deepEqual(marks(failedAt("signature", "verify")), [
    "Details:done", "Download:done", "Verify:failed", "Install:todo", "Restart:todo",
  ]);
  assert.deepEqual(marks(failedAt("install", "install")), [
    "Details:done", "Download:done", "Verify:done", "Install:failed", "Restart:todo",
  ]);
  const signature = updatePanelSteps(failedAt("signature", "verify"));
  assert.equal(signature.current, "verify");
  assert.equal(signature.failed, true);
});

test("a Marasi that can't replace itself stops at Install, with Download and Verify skipped", () => {
  const skipped = ["Details:done", "Download:skipped", "Verify:skipped", "Install:failed", "Restart:todo"];
  // Found before Install is offered.
  assert.deepEqual(
    marks({ Status: "available", Update: update, CanInstall: false, CannotInstallReason: "Marasi cannot write to /Applications" }),
    skipped,
  );
  // Found when the install started, before anything downloaded.
  assert.deepEqual(
    marks({ Status: "failed", Update: update, Failure: { Kind: "permissions", Step: "install", Reason: "r", BeforeDownload: true } }),
    skipped,
  );
});

test("a build without a signing key stops at Verify, with Download skipped", () => {
  assert.deepEqual(
    marks({ Status: "failed", Update: update, Failure: { Kind: "signature", Step: "verify", Reason: "r", BeforeDownload: true } }),
    ["Details:done", "Download:skipped", "Verify:failed", "Install:todo", "Restart:todo"],
  );
});

test("a permission error after the download stops at Install, with Download and Verify ticked", () => {
  const state = {
    Status: "failed",
    Update: update,
    Failure: { Kind: "permissions", Step: "install", Reason: "could not replace Marasi: permission denied" },
  };
  assert.deepEqual(marks(state), ["Details:done", "Download:done", "Verify:done", "Install:failed", "Restart:todo"]);
  assert.deepEqual(updatePanelFailure(state), {
    message: "Marasi cannot replace itself: could not replace Marasi: permission denied",
    retry: true,
  });
});

test("the panel shows no failure while an update is available, installing or installed", () => {
  for (const Status of ["available", "downloading", "restart-pending"]) {
    assert.equal(updatePanelFailure({ Status, Update: update, CanInstall: true }), null, Status);
  }
});

test("a failed install says what failed and offers Try again", () => {
  const failure = { Kind: "network", Step: "download", Reason: "connection reset" };
  assert.deepEqual(updatePanelFailure({ Status: "failed", Update: update, Failure: failure }), {
    message: "Download failed: connection reset",
    retry: true,
  });
});

test("a Marasi that can't replace itself says why, without Try again", () => {
  assert.deepEqual(
    updatePanelFailure({ Status: "available", Update: update, CanInstall: false, CannotInstallReason: "Move Marasi to Applications to enable updates" }),
    { message: "Move Marasi to Applications to enable updates", retry: false },
  );
  assert.deepEqual(
    updatePanelFailure({
      Status: "failed",
      Update: update,
      Failure: { Kind: "permissions", Step: "install", Reason: "Marasi cannot write to /opt, where it is installed", BeforeDownload: true },
    }),
    { message: "Marasi cannot write to /opt, where it is installed", retry: false },
  );
  assert.deepEqual(
    updatePanelFailure({
      Status: "failed",
      Update: update,
      Failure: { Kind: "signature", Step: "verify", Reason: "this build has no Marasi signing key", BeforeDownload: true },
    }),
    { message: "this build has no Marasi signing key", retry: false },
  );
});

test("a check that finds no update leaves none, so the panel closes", () => {
  const available = { Status: "available", Update: update, Failure: null };
  const after = withCheckResult(available, { Outcome: "none", Channel: "release" });
  assert.equal(after.Status, "idle");
  assert.equal(after.Update, null);
  assert.equal(showsUpdateIndicator(after), false);
});

test("a check never forgets an update downloading or waiting for a restart", () => {
  for (const Status of ["downloading", "restart-pending"]) {
    const state = { Status, Update: update };
    assert.equal(withCheckResult(state, { Outcome: "none" }), state, Status);
  }
});

test("a check that fails keeps the known update", () => {
  const available = { Status: "available", Update: update };
  assert.equal(withCheckResult(available, { Outcome: "failed", Reason: "offline" }), available);
});

test("a check that finds an update records it", () => {
  const next = { Version: "18.10.2026" };
  const after = withCheckResult({ Status: "idle", Update: null }, { Outcome: "available", Update: next });
  assert.equal(after.Status, "available");
  assert.equal(after.Update, next);
});

test("the Download step shows the amount downloaded in megabytes, of the size when it is known", () => {
  assert.equal(downloadedAmount({ Step: "download", Received: 12_582_912, Total: 30_932_992 }), "12.0 of 29.5 MB");
  assert.equal(downloadedAmount({ Step: "download", Received: 1_572_864, Total: 0 }), "1.5 MB");
  assert.equal(downloadedAmount(null), "0.0 MB");
});

test("a release with no build for this platform is not offered again", () => {
  const failure = { Kind: "no-build", Step: "download", Reason: "this release has no build for your platform (marasi-app)" };
  assert.deepEqual(updatePanelFailure({ Status: "failed", Update: update, Failure: failure }), {
    message: "This release has no build for your platform",
    retry: false,
  });
});

const update18 = { Version: "18.10.2026" };

test("the Settings icon carries no indicator without an update", () => {
  assert.equal(settingsIconIndicator({ Status: "idle", Update: null }), null);
  assert.equal(settingsIconIndicator({ Status: "unavailable", Update: null }), null);
  assert.equal(settingsIconIndicator(null), null);
});

test("an available update puts a green dot on the Settings icon", () => {
  assert.deepEqual(settingsIconIndicator({ Status: "available", Update: update18 }), {
    kind: "dot",
    tone: "success",
    pulse: false,
  });
});

test("a failed install turns the dot red", () => {
  const state = { Status: "failed", Update: update18, Failure: { Kind: "network", Reason: "reset" } };

  assert.deepEqual(settingsIconIndicator(state), { kind: "dot", tone: "error", pulse: false });
});

test("an update waiting for a restart pulses a tertiary dot", () => {
  assert.deepEqual(settingsIconIndicator({ Status: "restart-pending", Update: update18 }), {
    kind: "dot",
    tone: "tertiary",
    pulse: true,
  });
});

test("a download fills a ring around the Settings icon with its progress", () => {
  const state = { Status: "downloading", Update: update18, Progress: { Step: "download", Received: 37, Total: 100 } };

  assert.deepEqual(settingsIconIndicator(state), { kind: "ring", percent: 37, spinning: false });
});

test("the ring starts empty before the first progress arrives, or when the size is unknown", () => {
  assert.deepEqual(settingsIconIndicator({ Status: "downloading", Update: update18, Progress: null }), {
    kind: "ring",
    percent: 0,
    spinning: false,
  });
  assert.deepEqual(
    settingsIconIndicator({ Status: "downloading", Update: update18, Progress: { Step: "download", Received: 5, Total: 0 } }),
    { kind: "ring", percent: 0, spinning: false },
  );
});

test("while verifying and installing the ring is full and spins", () => {
  for (const Step of ["verify", "install"]) {
    const state = { Status: "downloading", Update: update18, Progress: { Step, Received: 100, Total: 100 } };

    assert.deepEqual(settingsIconIndicator(state), { kind: "ring", percent: 100, spinning: true }, Step);
  }
});

test("a dismissed update leaves the Settings icon bare", () => {
  // DismissUpdate answers the state with no update known.
  assert.equal(settingsIconIndicator({ Status: "idle", Update: null }), null);
});

test("the Settings icon opens Settings → Updates while an update is waiting", () => {
  for (const Status of ["available", "downloading", "failed", "restart-pending"]) {
    assert.equal(settingsPath({ Status, Update: update18 }), "/settings?section=updates", Status);
  }
});

test("without an update the Settings icon opens Settings as usual", () => {
  assert.equal(settingsPath({ Status: "idle", Update: null }), "/settings");
  assert.equal(settingsPath(null), "/settings");
});

test("the indicator and Settings → Updates say when an update is verifying or installing", () => {
  const verifying = { Status: "downloading", Update: update18, Progress: { Step: "verify", Received: 100, Total: 100 } };
  const installing = { Status: "downloading", Update: update18, Progress: { Step: "install", Received: 100, Total: 100 } };

  assert.equal(updateIndicatorLabel(verifying), "Verifying update 18.10.2026…");
  assert.equal(updateIndicatorLabel(installing), "Installing update 18.10.2026…");
  assert.equal(updateStatusLine(verifying), "Verifying 18.10.2026…");
  assert.equal(updateStatusLine(installing), "Installing 18.10.2026…");
});

test("the indicator shows how far a download is", () => {
  const state = { Status: "downloading", Update: update18, Progress: { Step: "download", Received: 37, Total: 100 } };

  assert.equal(updateIndicatorLabel(state), "Downloading update 18.10.2026 · 37%");
});

test("a nightly's notes show only its commit subjects, without the Ref, Commit and Marasi lines", () => {
  const notes =
    "- fix(ledger): a right-click opens only the row menu\n- feat(update): nightly notes\n\nRef: main\nCommit: def5678aaaabbbbccccddddeeeeffff0000111122\nMarasi: 11b10040310ebdb6adc451287d21a1a0ede947b9\n";

  assert.equal(
    nightlyNotes(notes),
    "- fix(ledger): a right-click opens only the row menu\n- feat(update): nightly notes",
  );
});

test("a nightly published before its notes listed commits has no notes to show", () => {
  assert.equal(nightlyNotes("Ref: main\nCommit: def5678aaaabbbbccccddddeeeeffff0000111122\n"), "");
  assert.equal(nightlyNotes("Ref: main\r\nCommit: def5678\r\n"), "");
  assert.equal(nightlyNotes("Ref: main\nCommit: def5678\nMarasi: 11b1004\n"), "");
  assert.equal(nightlyNotes(""), "");
  assert.equal(nightlyNotes(undefined), "");
});

test("Settings offers the channels the build may follow, and a v2 build has no release to reinstall", () => {
  const v2 = { Channel: "v2-nightly", Channels: ["v2-nightly"], AutomaticChecks: true };
  assert.deepEqual(channelChoices(v2), [["v2-nightly", "v2 Nightly"]]);
  assert.equal(canReinstallRelease(v2), false);
  const v1 = { Channel: "nightly", Channels: ["release", "nightly"], AutomaticChecks: true };
  assert.deepEqual(channelChoices(v1), [
    ["release", "Release"],
    ["nightly", "Nightly"],
  ]);
  assert.equal(canReinstallRelease(v1), true);
  assert.deepEqual(channelChoices({ Channel: "", Channels: [] }), []);
  assert.equal(canReinstallRelease({ Channel: "", Channels: [] }), false);
});

test("channels are shown by name", () => {
  assert.equal(channelLabel("v2-nightly"), "v2 Nightly");
  assert.equal(channelLabel("release"), "Release");
});

test("both nightly channels list their commits", () => {
  assert.equal(isNightlyChannel("v2-nightly"), true);
  assert.equal(isNightlyChannel("nightly"), true);
  assert.equal(isNightlyChannel("release"), false);
});
