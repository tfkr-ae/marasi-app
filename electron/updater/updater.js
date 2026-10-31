// Updates (GLOSSARY "Updates"): the app checks its Channel for a build newer
// than the running one, and installs it after checking it against the
// signing key built into the app. A port of v1's update*.go into the main
// process. Everything outside it comes in through createUpdater, so tests
// run it against a fake GitHub, a temp directory and fake timers, as v1's Go
// update tests do. The frontend reaches it through the "update:*" IPC calls
// in main.js and the four events it emits; the result shapes are v1's
// (UpdateState, UpdateCheck, UpdateInstall, ChannelChange, UpdateSettings).
//
// v2 keeps its update settings in its own v2_* keys of the shared app
// config, so v1 and v2 never steer each other's updates, and a v2 build
// follows only the v2-nightly channel until v2 replaces v1.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { asInstallError, Cancelled, failed, failureStep, foundBeforeDownload } from "./failure.js";
import { createReleaseSource, ReleaseNotFound, releaseAsset } from "./releases.js";
import { verifyChecksums } from "./verify.js";
import {
  isUpdateForNightly,
  nightlyCommit,
  parseNightlyVersion,
  parseReleaseVersion,
  releaseNewerThan,
  releaseUpdatesNightly,
} from "./version.js";

// The app config keys v2's update settings live in. Absent means the
// default: the build's channel, automatic checks on, nothing dismissed.
export const updateKeys = {
  channel: "v2_update_channel",
  checks: "v2_update_checks",
  dismissed: "v2_dismissed_update",
};

// Events sent to every window.
export const updateEvents = {
  available: "update-available",
  progress: "update-progress",
  installed: "update-installed",
  failed: "update-failed",
};

// The nightly channels: each is the GitHub release tagged with its name,
// which its workflow deletes and publishes again, titled with a version
// that names the same line ("DD.MM.YYYY (v2-nightly <commit>)").
const nightlyChannels = new Set(["nightly", "v2-nightly"]);

/**
 * The channels a build on `buildChannel` may follow: a v2 build only
 * v2-nightly, so it never installs a v1 build; a v1-style build release and
 * nightly; a development build none.
 */
export function followableChannels(buildChannel) {
  if (buildChannel === "v2-nightly") return ["v2-nightly"];
  if (buildChannel === "release" || buildChannel === "nightly") return ["release", "nightly"];
  return [];
}

// Release assets every release and nightly publishes beside the builds.
const checksumsAsset = "checksums.txt";
const signatureAsset = "checksums.txt.minisig";
const maxChecksumsSize = 64 << 10;
const maxBuildSize = 1 << 30;

/** How often a running app checks again. */
export const updateCheckInterval = 6 * 60 * 60 * 1000;
const updateCheckTimeout = 30 * 1000;
// Removing a leftover is retried: right after "Restart now" the previous
// build may still be exiting and hold its file open.
const leftoverAttempts = 10;
const leftoverRetryDelay = 1000;

const unavailable = "development builds don't check for or install updates";

// "on" as v1's strconv.ParseBool reads it, or null.
function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (/^(1|t|true)$/i.test(String(value))) return true;
  if (/^(0|f|false)$/i.test(String(value))) return false;
  return null;
}

/**
 * The updater.
 *
 * - build: {Channel, Version} of the running build; signingKey: from
 *   verify.js parsePublicKey, or null.
 * - config: {get(key), set(key, value)}, the app config's v2_* keys.
 * - fetch: every update request, through the update network (updateNet.js).
 * - fs (node:fs/promises) and tmpdir: where a download is kept.
 * - installer and installLocation: from installers.js; null when this build
 *   can't replace itself.
 * - emit(name, payload): an event to every window.
 * - confirm(title, message): the researcher's yes or no.
 * - confirmLosingWork(action): asks before work is lost, or true.
 * - quit(): the app's normal shutdown, which calls relaunchIfRestarting.
 * - timers: {setInterval, clearInterval, sleep}; log: console-like.
 */
export function createUpdater({
  build,
  signingKey,
  config,
  fetch,
  fs,
  tmpdir,
  installer = null,
  installLocation = "",
  emit = () => {},
  confirm = async () => false,
  confirmLosingWork = async () => true,
  quit = () => {},
  releaseSource,
  timers = { setInterval, clearInterval, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  checkTimeout = updateCheckTimeout,
  log = console,
}) {
  const releases = createReleaseSource({ base: releaseSource, fetch });
  const followable = followableChannels(build.Channel);
  // The GitHub release each Update came from, for its assets. Never sent.
  const releaseOf = new WeakMap();
  const state = { status: "idle", update: null, abort: null, progress: null, failure: null };
  let restarting = false;
  let schedule = null;

  // ---- Settings and channel ----

  // The channel the app follows: the saved one when this build may follow
  // it, else the build's; "" for a development build.
  async function updateChannel() {
    if (!followable.length) return "";
    const saved = await config.get(updateKeys.channel);
    if (saved != null && saved !== "") {
      if (followable.includes(saved)) return saved;
      log.warn(`[!] ${updateKeys.channel} "${saved}" is not a channel this build follows, following ${build.Channel}`);
    }
    return build.Channel;
  }

  async function automaticChecks() {
    const saved = await config.get(updateKeys.checks);
    if (saved == null) return true;
    const on = parseBool(saved);
    if (on === null) log.warn(`[!] ${updateKeys.checks} is not true or false, keeping automatic checks on`);
    return on ?? true;
  }

  async function getUpdateSettings() {
    return { AutomaticChecks: await automaticChecks(), Channel: await updateChannel(), Channels: [...followable] };
  }

  // ---- State ----

  const busy = () =>
    state.status === "downloading"
      ? new Error("an update is already being installed")
      : state.status === "restart-pending"
        ? new Error("an update is already installed; restart Marasi to run it")
        : null;

  // Records the update the latest check found, or none. While an install
  // runs or waits for a restart, it stays, and this reports false.
  function setKnown(update) {
    if (busy()) return false;
    state.failure = null;
    state.update = update;
    state.status = update ? "available" : "idle";
    return true;
  }

  // Why this build can't replace itself, as the error an install would
  // fail with, or the installer and location when it can.
  async function replaceable() {
    if (!signingKey) {
      throw foundBeforeDownload(failed("signature", "this build has no Marasi signing key to verify updates with"));
    }
    if (!installer) throw foundBeforeDownload(failed("permissions", "Marasi cannot replace itself on this platform"));
    if (!installLocation) throw foundBeforeDownload(failed("permissions", "Marasi could not find where it is installed"));
    try {
      await installer.checkReplaceable(installLocation);
    } catch (error) {
      throw foundBeforeDownload(asInstallError(error, "Marasi cannot replace itself"));
    }
    return installer;
  }

  async function getUpdateState() {
    const channel = await updateChannel();
    const shown = { Status: "unavailable", Channel: channel, Running: build, Update: null, CanInstall: false };
    Object.assign(shown, { CannotInstallReason: "", Progress: null, Failure: null });
    if (!channel) return shown;
    try {
      await replaceable();
      shown.CanInstall = true;
    } catch (error) {
      shown.CannotInstallReason = error.message;
    }
    return { ...shown, Status: state.status, Update: state.update, Progress: state.progress, Failure: state.failure };
  }

  // ---- Checking ----

  function releaseUpdate(release) {
    const update = { Channel: "release", Version: release.tag, Notes: release.notes, ReleasePage: release.page };
    Object.assign(update, { Commit: "", CompareURL: "" });
    releaseOf.set(update, release);
    return update;
  }

  async function latestRelease(signal) {
    let release;
    try {
      release = await releases.latestRelease(signal);
    } catch (error) {
      if (error instanceof ReleaseNotFound) throw new Error("no release is published on GitHub");
      throw error;
    }
    const latest = parseReleaseVersion(release.tag);
    if (!latest) throw new Error(`the latest release "${release.tag}" is not a release version`);
    return [release, latest];
  }

  // A running release by its tag, a running nightly (switched to release)
  // by its date alone, so the switch never downgrades.
  async function findReleaseUpdate(signal) {
    let isUpdate;
    const runningRelease = parseReleaseVersion(build.Version);
    const runningNightly = parseNightlyVersion(build.Version, build.Channel);
    if (runningRelease) isUpdate = (latest) => releaseNewerThan(latest, runningRelease);
    else if (runningNightly) isUpdate = (latest) => releaseUpdatesNightly(latest, runningNightly);
    else throw new Error(`the running version "${build.Version}" is neither a release nor a nightly version`);
    const [release, latest] = await latestRelease(signal);
    return isUpdate(latest) ? releaseUpdate(release) : null;
  }

  // The running build as the nightly ordering of `channel` sees it, with
  // the ref a compare link starts from: a nightly of that line is itself; a
  // release is its date with no commit, compared from its tag.
  function runningAsNightly(channel) {
    const nightly = parseNightlyVersion(build.Version, channel);
    if (nightly) return [nightly, nightly.commit];
    const release = parseReleaseVersion(build.Version);
    if (release) return [{ date: release.date, commit: "" }, build.Version];
    return [null, ""];
  }

  async function findNightlyUpdate(channel, signal) {
    const [running, from] = runningAsNightly(channel);
    if (!running) throw new Error(`the running version "${build.Version}" is neither a ${channel} nor a release version`);
    let release;
    try {
      release = await releases.releaseByTag(channel, signal);
    } catch (error) {
      if (error instanceof ReleaseNotFound) throw noNightlyPublished(channel);
      throw error;
    }
    const published = parseNightlyVersion(release.name, channel);
    if (!published) throw new Error(`the published ${channel}'s title "${release.name}" is not a ${channel} version`);
    const commit = nightlyCommit(release.notes);
    if (!commit) throw new Error(`the published ${channel}'s notes do not say which commit it was built from`);
    if (!isUpdateForNightly({ ...published, commit }, running)) return null;
    const update = { Channel: channel, Version: release.name, Notes: release.notes, ReleasePage: release.page };
    Object.assign(update, { Commit: commit, CompareURL: compareURL(release.page, from, commit) });
    releaseOf.set(update, release);
    return update;
  }

  function findUpdate(channel, signal) {
    if (channel === "release") return findReleaseUpdate(signal);
    if (nightlyChannels.has(channel)) return findNightlyUpdate(channel, signal);
    throw new Error(`checking the ${channel} channel is not supported`);
  }

  // Tells builds apart for Dismiss: a release by its tag, a nightly by its
  // commit, since every nightly has the same tag.
  const identity = (update) => (nightlyChannels.has(update.Channel) && update.Commit ? update.Commit : update.Version);

  async function setDismissed(value) {
    if (((await config.get(updateKeys.dismissed)) ?? "") === value) return;
    await config.set(updateKeys.dismissed, value);
  }

  // kind is "manual" (the researcher asked: it clears any dismissal) or
  // "automatic" (it skips a dismissed build and never hides a known one).
  async function check(kind, parentSignal) {
    const channel = await updateChannel();
    const result = { Outcome: "unavailable", Channel: channel, Running: build, Update: null, Reason: "" };
    if (!channel) return result;
    if (kind === "manual") {
      await setDismissed("").catch((error) => log.warn(`[!] clearing the dismissed update: ${error.message}`));
    }
    const signal = AbortSignal.any([AbortSignal.timeout(checkTimeout), ...(parentSignal ? [parentSignal] : [])]);
    let update;
    try {
      update = await findUpdate(channel, signal);
    } catch (error) {
      // Most likely mid-publish: nothing to report until the next check.
      if (kind === "automatic" && error.noNightly) return { ...result, Outcome: "none" };
      return { ...result, Outcome: "failed", Reason: error.message };
    }
    if (!update) {
      if (kind === "manual") setKnown(null);
      return { ...result, Outcome: "none" };
    }
    if (kind === "automatic" && (await config.get(updateKeys.dismissed)) === identity(update)) {
      return { ...result, Outcome: "available", Update: update };
    }
    if (setKnown(update)) emit(updateEvents.available, update);
    return { ...result, Outcome: "available", Update: update };
  }

  // ---- Installing ----

  function enterStep(step) {
    if (state.status !== "downloading" || !state.progress || state.progress.Step === step) return;
    state.progress = { ...state.progress, Step: step };
    emit(updateEvents.progress, state.progress);
  }

  function reportProgress(progress) {
    const shown = { Step: "download", ...progress };
    if (state.status === "downloading") state.progress = shown;
    emit(updateEvents.progress, shown);
  }

  function downloadError(signal, asset, error) {
    if (signal.aborted) return new Cancelled();
    return failed("network", `could not download ${asset.name}: ${error?.cause?.message ?? error?.message ?? error}`);
  }

  async function getAsset(signal, asset) {
    let res;
    try {
      res = await fetch(asset.url, { signal, headers: { "User-Agent": "marasi-app" } });
    } catch (error) {
      throw downloadError(signal, asset, error);
    }
    if (res.status !== 200) {
      await res.body?.cancel?.().catch(() => {});
      throw failed("network", `downloading ${asset.name}: GitHub answered ${res.status} ${res.statusText ?? ""}`.trim());
    }
    return res;
  }

  async function downloadSmall(signal, asset) {
    const res = await getAsset(signal, asset);
    let data;
    try {
      data = Buffer.from(await res.arrayBuffer());
    } catch (error) {
      throw downloadError(signal, asset, error);
    }
    if (data.length > maxChecksumsSize) throw failed("network", `${asset.name} is larger than expected`);
    return data;
  }

  // Fetches the build into path, reporting progress when the whole
  // percentage changes (every MiB when the size is unknown), and returns its
  // SHA-256 in hex.
  async function downloadBuild(signal, asset, path) {
    const res = await getAsset(signal, asset);
    const length = Number(res.headers.get("content-length"));
    const total = Number.isFinite(length) && res.headers.get("content-length") !== null ? length : asset.size;
    if (total > maxBuildSize) throw failed("network", `${asset.name} is larger than expected`);
    let file;
    try {
      file = await fs.open(path, "w", 0o600);
    } catch (error) {
      throw failed("install", `could not save the download: ${error.message}`);
    }
    const hash = createHash("sha256");
    const step = (n) => (n < 0 ? -1 : total > 0 ? Math.floor((n * 100) / total) : Math.floor(n / (1 << 20)));
    let received = 0;
    let reported = -1;
    const send = () => {
      reported = received;
      reportProgress({ Received: received, Total: total });
    };
    send();
    try {
      for await (const chunk of res.body) {
        received += chunk.length;
        if (received > maxBuildSize) throw new Error(`${asset.name} is larger than expected`);
        hash.update(chunk);
        await file.write(chunk);
        if (step(received) !== step(reported)) send();
      }
    } catch (error) {
      throw downloadError(signal, asset, error);
    } finally {
      await file.close();
    }
    if (reported !== received) send();
    return hash.digest("hex");
  }

  // The pipeline: check this build can update itself, verify the signed
  // checksums before the build downloads, download and compare the build,
  // then let the platform stage and swap it in. A failure discards what was
  // downloaded or staged, leaving the install as it was.
  async function install(signal, update) {
    const platform = await replaceable();
    const release = releaseOf.get(update);
    const checksumsURL = releaseAsset(release, checksumsAsset);
    if (!checksumsURL) throw failed("signature", `the release has no ${checksumsAsset} to verify the build with`);
    const signatureURL = releaseAsset(release, signatureAsset);
    if (!signatureURL) throw failed("signature", `the release has no signature (${signatureAsset})`);
    const name = platform.asset;
    const build = releaseAsset(release, name);
    if (!build) throw failed("no-build", `this release has no build for your platform (${name})`);

    const checksums = await downloadSmall(signal, checksumsURL);
    const signature = await downloadSmall(signal, signatureURL);
    // Checked before the build downloads, so a bad signature wastes no
    // download; a failure here still stops at verify (failureStep).
    const sums = verifyChecksums(signingKey, checksums, signature);
    const want = sums[name];
    if (!want) throw failed("checksum", `the signed checksums do not list ${name}`);

    let dir;
    try {
      dir = await fs.mkdtemp(join(tmpdir, "marasi-update-"));
    } catch (error) {
      throw failed("install", `could not make room for the download: ${error.message}`);
    }
    try {
      const download = join(dir, name);
      const got = await downloadBuild(signal, build, download);
      enterStep("verify");
      if (got !== want) throw failed("checksum", `the downloaded ${name} does not match its signed checksum`);
      if (signal.aborted) throw new Cancelled();
      let staged;
      try {
        staged = await platform.stage(download, installLocation, () => enterStep("install"));
      } catch (error) {
        throw asInstallError(error, "could not prepare the new build");
      }
      try {
        await platform.swap(staged, installLocation);
      } catch (error) {
        await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
        throw asInstallError(error, "could not replace Marasi");
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Moves the update to install (target for a reinstall, else the known
  // one) to downloading, and returns it with the AbortSignal it runs under.
  async function startInstall(target) {
    if (!(await updateChannel())) throw new Error(unavailable);
    const reason = busy();
    if (reason) throw reason;
    if (!target && state.status !== "available" && state.status !== "failed") {
      throw new Error("there is no update to install");
    }
    if (target) state.update = target;
    if (!state.update) throw new Error("there is no update to install");
    state.abort = new AbortController();
    state.status = "downloading";
    state.progress = { Step: "download", Received: 0, Total: 0 };
    state.failure = null;
    return [state.update, state.abort.signal];
  }

  // Records how the install of update ended and emits it.
  function finishInstall(update, error) {
    state.abort = null;
    const running = state.progress?.Step ?? "download";
    state.progress = null;
    const result = { Outcome: "installed", Update: update, Failure: null };
    if (!error) {
      state.status = "restart-pending";
      emit(updateEvents.installed, update);
      return result;
    }
    if (error instanceof Cancelled) {
      state.status = "available";
      return { ...result, Outcome: "cancelled" };
    }
    const kind = error.kind ?? "install";
    const beforeDownload = Boolean(error.beforeDownload);
    const failure = { Kind: kind, Step: failureStep(kind, beforeDownload, running), Reason: error.message };
    Object.assign(failure, { ReleasePage: update.ReleasePage, BeforeDownload: beforeDownload });
    state.status = "failed";
    state.failure = failure;
    log.warn(`installing update ${update.Version}: ${failure.Reason}`);
    emit(updateEvents.failed, failure);
    return { ...result, Outcome: "failed", Failure: failure };
  }

  async function runInstall(target) {
    const [update, signal] = await startInstall(target);
    let error = null;
    try {
      await install(signal, update);
    } catch (caught) {
      error = caught;
    }
    return finishInstall(update, error);
  }

  // ---- Automatic checks ----

  async function automaticCheck(signal) {
    if (!(await automaticChecks())) return;
    const result = await check("automatic", signal);
    if (result.Outcome === "failed" && !signal.aborted) {
      log.warn(`[!] automatic check for an update on the ${result.Channel} channel failed: ${result.Reason}`);
    }
  }

  function runAutomaticCheck() {
    if (!schedule) return Promise.resolve();
    const { abort } = schedule;
    const run = automaticCheck(abort.signal).catch((error) => log.warn(`[!] automatic update check: ${error.message}`));
    schedule.running = schedule.running.then(() => run);
    return run;
  }

  const updater = {
    getUpdateState,
    getUpdateSettings,

    /** "Check for updates…": checks the channel and emits any update found. */
    checkForUpdate: () => check("manual"),

    /** Downloads, verifies and installs the known update. */
    installUpdate: () => runInstall(null),

    /** Aborts a running download; the known update stays available. */
    cancelUpdateDownload() {
      state.abort?.abort();
    },

    /**
     * "Restart now" after an install: asks before work is lost, then quits
     * through the normal shutdown, which relaunches the installed build.
     * Resolves false when the researcher cancelled, leaving it pending.
     */
    async restartToUpdate() {
      if (state.status !== "restart-pending") throw new Error("no installed update is waiting for a restart");
      if (!(await confirmLosingWork("Restart Marasi"))) return false;
      restarting = true;
      quit();
      return true;
    },

    /** Starts the installed build, when the app is quitting for "Restart now". */
    async relaunchIfRestarting() {
      if (!restarting) return;
      try {
        await installer.relaunch(installLocation);
      } catch (error) {
        log.warn(`relaunching the installed update: ${error.message}`);
      }
    },

    /**
     * Installs the latest release after warning that projects opened in a
     * newer build may not open in it, the one way back on purpose. A build
     * that doesn't follow the release channel (a v2 build) has no release
     * to go back to.
     */
    async reinstallLatestRelease() {
      if (!(await updateChannel())) throw new Error(unavailable);
      if (!followable.includes("release")) throw new Error("this build has no release to reinstall");
      const reason = busy();
      if (reason) throw reason;
      const [release] = await latestRelease(AbortSignal.timeout(checkTimeout));
      const update = releaseUpdate(release);
      const message =
        `Marasi will install release ${update.Version} in place of ${build.Version}. ` +
        "Projects opened in a newer build of Marasi may not open in it, because Marasi only migrates project files forward. Continue?";
      if (!(await confirm("Reinstall latest release", message))) {
        return { Outcome: "cancelled", Update: update, Failure: null };
      }
      const result = await runInstall(update);
      if (result.Outcome === "installed") {
        // The release now installed follows the release channel, so a
        // nightly is not offered again after the restart.
        await config
          .set(updateKeys.channel, "release")
          .catch((error) => log.warn(`[!] saving the release channel after reinstalling: ${error.message}`));
      }
      return result;
    },

    /** Hides the available update until a newer build is published. */
    async dismissUpdate() {
      if (!(await updateChannel())) throw new Error(unavailable);
      if (state.status === "downloading") throw new Error("the update is downloading; cancel the download first");
      if (state.status === "restart-pending") throw new Error("the update is installed and runs at the next launch");
      if (!state.update) return getUpdateState();
      try {
        await setDismissed(identity(state.update));
      } catch (error) {
        throw new Error(`dismissing the update: ${error.message}`);
      }
      setKnown(null);
      return getUpdateState();
    },

    /**
     * Saves the channel the app follows. Switching to a nightly checks right
     * away. An update found on the other channel is forgotten, unless it is
     * being installed or waits for a restart.
     */
    async setUpdateChannel(name) {
      const current = await updateChannel();
      if (!current) throw new Error(unavailable);
      if (!followable.includes(name)) {
        throw new Error(`"${name}" is not a channel; choose ${followable.join(" or ")}`);
      }
      try {
        await config.set(updateKeys.channel, name);
      } catch (error) {
        throw new Error(`saving the channel: ${error.message}`);
      }
      const change = { Settings: await getUpdateSettings(), Check: null };
      if (name !== current) setKnown(null);
      if (nightlyChannels.has(name)) change.Check = await check("manual");
      return change;
    },

    /**
     * Turns automatic checks on or off. Turning them back on checks right
     * away; a development build saves nothing.
     */
    async setAutomaticUpdateChecks(on) {
      if (!(await updateChannel())) throw new Error(unavailable);
      const before = await automaticChecks();
      try {
        await config.set(updateKeys.checks, Boolean(on));
      } catch (error) {
        throw new Error(`saving automatic checks: ${error.message}`);
      }
      if (on && !before) runAutomaticCheck();
      return getUpdateSettings();
    },

    /**
     * Starts the automatic checks: one now, then every 6 hours. Resolves
     * once the first has run.
     */
    startUpdateChecks() {
      if (schedule) return Promise.resolve();
      schedule = { abort: new AbortController(), running: Promise.resolve(), timer: null };
      const first = runAutomaticCheck();
      schedule.timer = timers.setInterval(runAutomaticCheck, updateCheckInterval);
      return first;
    },

    /** Stops the automatic checks and waits for a running one to end. */
    async stopUpdateChecks() {
      if (!schedule) return;
      const { abort, timer, running } = schedule;
      schedule = null;
      timers.clearInterval(timer);
      abort.abort();
      await running;
    },

    /** Deletes what the last install left beside the install location. */
    async removeUpdateLeftovers() {
      if (!installer?.removeLeftovers || !installLocation) return;
      let lastError;
      for (let attempt = 1; attempt <= leftoverAttempts; attempt++) {
        try {
          await installer.removeLeftovers(installLocation);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < leftoverAttempts) await timers.sleep(leftoverRetryDelay);
        }
      }
      log.warn(`removing the previous version left by an update: ${lastError.message}`);
    },
  };
  return updater;
}

// GitHub has no nightly right now, most likely because its workflow is
// publishing a new one: a manual check reports it, an automatic one doesn't.
function noNightlyPublished(channel) {
  return Object.assign(
    new Error(`no ${channel} is published right now; a new one may be on its way, so try again in a few minutes`),
    { noNightly: true },
  );
}

// The GitHub comparison from one commit to another in the repository whose
// release page is releasePage; "" when it isn't a release page.
function compareURL(releasePage, from, to) {
  const cut = releasePage.indexOf("/releases/");
  if (cut <= 0) return "";
  return `${releasePage.slice(0, cut)}/compare/${from}...${to}`;
}
