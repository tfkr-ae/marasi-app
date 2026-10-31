// The updater through its public calls, against a fake GitHub, the
// app config's v2_* keys in memory and a real temp directory, as v1's Go
// update tests run it.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeConfig, createFakeGitHub, createFakeTimers, createLog, repo, sha256, tempDir } from "../testing/fakeUpdates.js";
import { createSigner } from "../testing/minisignSigner.js";
import { binaryInstaller, updateAssets } from "./installers.js";
import { createUpdater, updateCheckInterval } from "./updater.js";
import { parsePublicKey } from "./verify.js";

const asset = updateAssets.linux;
const v2Running = { Channel: "v2-nightly", Version: "17.10.2026 (v2-nightly abc1234)" };
const newBuild = "#!/bin/sh\necho new v2 nightly\n";

function v2Nightly(github, { date = "18.10.2026", commit = "def5678aa", files = { [asset]: newBuild }, ...rest } = {}) {
  return github.publish({
    tag: "v2-nightly",
    name: `${date} (v2-nightly ${commit.slice(0, 7)})`,
    notes: `- a change\n\nRef: v2\nCommit: ${commit}\nMarasi: ${"f".repeat(40)}\n`,
    prerelease: true,
    files,
    ...rest,
  });
}

// An updater for `build` with the running build at <dir>/marasi-v2.AppImage.
async function setup({ build = v2Running, github = createFakeGitHub(), config = createFakeConfig(), key, installer, location } = {}) {
  const dir = await tempDir();
  const installLocation = location ?? join(dir, "marasi-v2.AppImage");
  if (location === undefined) await fs.writeFile(installLocation, "old build", { mode: 0o644 });
  const events = [];
  const relaunched = [];
  const timers = createFakeTimers();
  const log = createLog();
  const quits = [];
  const asks = [];
  const options = {
    build,
    signingKey: key === undefined ? parsePublicKey(github.publicKey) : key,
    config,
    fetch: github.fetch,
    fs,
    tmpdir: dir,
    releaseSource: repo,
    installer: installer === undefined ? binaryInstaller({ asset, fs, spawnDetached: async (path) => relaunched.push(path) }) : installer,
    installLocation,
    emit: (name, payload) => events.push([name, payload]),
    confirm: async (title, message) => {
      asks.push({ title, message });
      return options.answer ?? true;
    },
    confirmLosingWork: async (action) => {
      asks.push({ action });
      return options.answer ?? true;
    },
    quit: () => quits.push(true),
    timers,
    log,
  };
  const updater = createUpdater(options);
  return { updater, github, config, dir, installLocation, events, relaunched, timers, log, quits, asks, options };
}

const eventNames = (events) => events.map(([name]) => name);

test("a v2 nightly is offered a newer v2 nightly from another commit, with the changes since its build", async () => {
  const { updater, github, events } = await setup();
  v2Nightly(github);
  const check = await updater.checkForUpdate();
  assert.equal(check.Outcome, "available");
  assert.equal(check.Channel, "v2-nightly");
  assert.equal(check.Update.Version, "18.10.2026 (v2-nightly def5678)");
  assert.equal(check.Update.Commit, "def5678aa");
  assert.equal(check.Update.CompareURL, "https://github.test/tfkr-ae/marasi-app/compare/abc1234...def5678aa");
  assert.deepEqual(eventNames(events), ["update-available"]);
  assert.equal((await updater.getUpdateState()).Status, "available");
});

test("a v2 nightly reads only the v2-nightly release, so a newer v1 nightly or release is never offered", async () => {
  const { updater, github } = await setup();
  github.publish({ tag: "31.12.2026", files: { "marasi-app": "v1 release" } });
  github.publish({
    tag: "nightly",
    name: "30.12.2026 (nightly 9999999)",
    notes: "Commit: 9999999999",
    prerelease: true,
    files: { "marasi-app": "v1 nightly" },
  });
  v2Nightly(github, { date: "17.10.2026", commit: "abc1234ff" });
  assert.equal((await updater.checkForUpdate()).Outcome, "none");
  assert.deepEqual(github.requests, [`${repo}/releases/tags/v2-nightly`]);
});

test("a v2-nightly release titled as a v1 nightly is refused", async () => {
  const { updater, github } = await setup();
  github.publish({ tag: "v2-nightly", name: "18.10.2026 (nightly def5678)", notes: "Commit: def5678", prerelease: true });
  const check = await updater.checkForUpdate();
  assert.equal(check.Outcome, "failed");
  assert.match(check.Reason, /not a v2-nightly version/);
});

test("a v1 nightly reads only the nightly release, never the v2-nightly one", async () => {
  const build = { Channel: "nightly", Version: "17.10.2026 (nightly abc1234)" };
  const { updater, github } = await setup({ build });
  v2Nightly(github, { date: "20.10.2026" });
  github.publish({ tag: "nightly", name: "17.10.2026 (nightly abc1234)", notes: "Commit: abc1234ff", prerelease: true });
  assert.equal((await updater.checkForUpdate()).Outcome, "none");
  assert.deepEqual(github.requests, [`${repo}/releases/tags/nightly`]);
});

test("a v2 build follows only v2-nightly and keeps its settings in v2_* keys, never v1's", async () => {
  const config = createFakeConfig({ update_channel: "nightly", update_checks: false, v2_update_channel: "release" });
  const { updater } = await setup({ config });
  assert.deepEqual(await updater.getUpdateSettings(), {
    AutomaticChecks: true,
    Channel: "v2-nightly",
    Channels: ["v2-nightly"],
  });
  await assert.rejects(updater.setUpdateChannel("release"), /choose v2-nightly/);
  await assert.rejects(updater.setUpdateChannel("nightly"), /choose v2-nightly/);
  await updater.setAutomaticUpdateChecks(false);
  assert.deepEqual(config.values, {
    update_channel: "nightly",
    update_checks: false,
    v2_update_channel: "release",
    v2_update_checks: false,
  });
  assert.ok(config.reads.every((key) => key.startsWith("v2_")), config.reads.join(", "));
  await assert.rejects(updater.reinstallLatestRelease(), /no release to reinstall/);
});

test("switching to v2-nightly saves it and checks at once", async () => {
  const { updater, github, config } = await setup();
  v2Nightly(github);
  const change = await updater.setUpdateChannel("v2-nightly");
  assert.equal(config.values.v2_update_channel, "v2-nightly");
  assert.equal(change.Settings.Channel, "v2-nightly");
  assert.equal(change.Check.Outcome, "available");
});

test("installing replaces the build on disk, keeps it executable and reports each step", async () => {
  const { updater, github, events, installLocation } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  const result = await updater.installUpdate();
  assert.equal(result.Outcome, "installed");
  assert.equal(await fs.readFile(installLocation, "utf8"), newBuild);
  // Executable by everyone who could read the build it replaced.
  assert.equal((await fs.stat(installLocation)).mode & 0o777, 0o755);
  const steps = events.filter(([name]) => name === "update-progress").map(([, progress]) => progress.Step);
  assert.deepEqual([...new Set(steps)], ["download", "verify", "install"]);
  const last = events.filter(([name]) => name === "update-progress" && events).at(-1)[1];
  assert.equal(last.Total, Buffer.byteLength(newBuild));
  assert.equal(events.at(-1)[0], "update-installed");
  assert.equal((await updater.getUpdateState()).Status, "restart-pending");
});

test("nothing downloads until Install is chosen", async () => {
  const { updater, github } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  assert.ok(github.requests.every((url) => url.startsWith(repo)));
});

test("a manifest with a bad signature is refused before the build downloads and leaves the install as it was", async () => {
  const { updater, github, events, installLocation } = await setup();
  v2Nightly(github, { signWith: createSigner() });
  await updater.checkForUpdate();
  const result = await updater.installUpdate();
  assert.equal(result.Outcome, "failed");
  assert.equal(result.Failure.Kind, "signature");
  assert.equal(result.Failure.Step, "verify");
  assert.equal(result.Failure.ReleasePage, "https://github.test/tfkr-ae/marasi-app/releases/tag/v2-nightly");
  assert.equal(await fs.readFile(installLocation, "utf8"), "old build");
  assert.ok(!github.requests.includes(github.assetURL("v2-nightly", asset)));
  assert.equal(events.at(-1)[0], "update-failed");
  assert.equal((await updater.getUpdateState()).Status, "failed");
});

test("an unsigned release is refused", async () => {
  const { updater, github } = await setup();
  v2Nightly(github, { sign: false });
  await updater.checkForUpdate();
  const result = await updater.installUpdate();
  assert.equal(result.Failure.Kind, "signature");
});

test("a build that doesn't match its signed checksum is refused", async () => {
  const { updater, github, installLocation } = await setup();
  v2Nightly(github, { sums: { [asset]: sha256("something else") } });
  await updater.checkForUpdate();
  const result = await updater.installUpdate();
  assert.equal(result.Failure.Kind, "checksum");
  assert.equal(result.Failure.Step, "verify");
  assert.equal(await fs.readFile(installLocation, "utf8"), "old build");
});

test("a release carrying only v1 builds has no build for a v2 install", async () => {
  const { updater, github } = await setup();
  v2Nightly(github, { files: { "marasi-app": "v1", "marasi-app.exe": "v1", "marasi-app.app.zip": "v1" } });
  await updater.checkForUpdate();
  const result = await updater.installUpdate();
  assert.equal(result.Failure.Kind, "no-build");
  assert.equal(result.Failure.Step, "download");
});

test("a build without a signing key can't install, and says so before anything downloads", async () => {
  const { updater, github } = await setup({ key: null });
  v2Nightly(github);
  await updater.checkForUpdate();
  const state = await updater.getUpdateState();
  assert.equal(state.CanInstall, false);
  assert.match(state.CannotInstallReason, /no Marasi signing key/);
  const result = await updater.installUpdate();
  assert.equal(result.Failure.BeforeDownload, true);
  assert.equal(result.Failure.Step, "verify");
});

test("an install location Marasi can't write offers only the release page", async () => {
  const github = createFakeGitHub();
  const { updater } = await setup({ github, location: "/nonexistent-mv2/marasi-v2.AppImage" });
  v2Nightly(github);
  await updater.checkForUpdate();
  const state = await updater.getUpdateState();
  assert.equal(state.CanInstall, false);
  assert.match(state.CannotInstallReason, /cannot write to \/nonexistent-mv2/);
  const result = await updater.installUpdate();
  assert.equal(result.Failure.Kind, "permissions");
  assert.equal(result.Failure.Step, "install");
});

test("a build Marasi can't locate can't install", async () => {
  const { updater } = await setup({ location: "" });
  const state = await updater.getUpdateState();
  assert.equal(state.CanInstall, false);
  assert.match(state.CannotInstallReason, /could not find where it is installed/);
});

test("a download that fails is a network failure, and a failed install can be retried", async () => {
  const { updater, github, installLocation } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  github.answers.set(github.assetURL("v2-nightly", asset), { status: 502 });
  const result = await updater.installUpdate();
  assert.equal(result.Failure.Kind, "network");
  assert.equal(result.Failure.Step, "download");
  github.answers.clear();
  assert.equal((await updater.installUpdate()).Outcome, "installed");
  assert.equal(await fs.readFile(installLocation, "utf8"), newBuild);
});

test("cancelling the download keeps the update available", async () => {
  const { updater, github, installLocation } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  github.hold(github.assetURL("v2-nightly", asset));
  const installing = updater.installUpdate();
  while ((await updater.getUpdateState()).Progress?.Received !== Math.floor(Buffer.byteLength(newBuild) / 2)) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  updater.cancelUpdateDownload();
  const result = await installing;
  assert.equal(result.Outcome, "cancelled");
  assert.equal((await updater.getUpdateState()).Status, "available");
  assert.equal(await fs.readFile(installLocation, "utf8"), "old build");
});

test("install with no update, or while one is installing, is refused", async () => {
  const { updater, github } = await setup();
  await assert.rejects(updater.installUpdate(), /no update to install/);
  v2Nightly(github);
  await updater.checkForUpdate();
  await updater.installUpdate();
  await assert.rejects(updater.installUpdate(), /restart Marasi to run it/);
});

test("Restart now asks before work is lost, then quits and relaunches the installed build", async () => {
  const { updater, github, quits, relaunched, asks, installLocation, options } = await setup();
  await assert.rejects(updater.restartToUpdate(), /no installed update/);
  v2Nightly(github);
  await updater.checkForUpdate();
  await updater.installUpdate();
  options.answer = false;
  assert.equal(await updater.restartToUpdate(), false);
  assert.deepEqual(quits, []);
  await updater.relaunchIfRestarting();
  assert.deepEqual(relaunched, [], "closing with a restart pending doesn't relaunch");
  assert.equal((await updater.getUpdateState()).Status, "restart-pending");
  options.answer = true;
  assert.equal(await updater.restartToUpdate(), true);
  assert.deepEqual(asks.at(-1), { action: "Restart Marasi" });
  assert.deepEqual(quits, [true]);
  await updater.relaunchIfRestarting();
  assert.deepEqual(relaunched, [installLocation]);
});

test("a check that finds a newer build while a restart is pending keeps the installed update", async () => {
  const { updater, github, events } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  await updater.installUpdate();
  v2Nightly(github, { date: "19.10.2026", commit: "0123456789" });
  events.length = 0;
  assert.equal((await updater.checkForUpdate()).Outcome, "available");
  const state = await updater.getUpdateState();
  assert.equal(state.Status, "restart-pending");
  assert.equal(state.Update.Commit, "def5678aa");
  assert.deepEqual(events, []);
});

test("a failed check says why and keeps the known update", async () => {
  const { updater, github } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  github.answers.set(`${repo}/releases/tags/v2-nightly`, { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  const check = await updater.checkForUpdate();
  assert.equal(check.Outcome, "failed");
  assert.match(check.Reason, /rate limit/);
  assert.equal((await updater.getUpdateState()).Status, "available");
});

test("a manual check with no v2 nightly published fails and can be retried; an automatic one is quiet", async () => {
  const { updater, timers, log } = await setup();
  const check = await updater.checkForUpdate();
  assert.equal(check.Outcome, "failed");
  assert.match(check.Reason, /no v2-nightly is published right now/);
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  assert.deepEqual(log.lines, []);
  assert.equal(timers.active, 0);
});

test("dismiss hides a nightly by its commit, automatic checks skip it, and a manual check shows it again", async () => {
  const { updater, github, config, events, timers } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  const state = await updater.dismissUpdate();
  assert.equal(state.Status, "idle");
  assert.equal(config.values.v2_dismissed_update, "def5678aa");
  events.length = 0;
  await updater.startUpdateChecks();
  await timers.tick();
  await updater.stopUpdateChecks();
  assert.deepEqual(events, []);
  assert.equal((await updater.getUpdateState()).Status, "idle");
  await updater.checkForUpdate();
  assert.equal(config.values.v2_dismissed_update, "");
  assert.equal((await updater.getUpdateState()).Status, "available");
});

test("a newer build than the dismissed one shows again on an automatic check", async () => {
  const { updater, github, events } = await setup({ config: createFakeConfig({ v2_dismissed_update: "def5678aa" }) });
  v2Nightly(github, { commit: "1111111111" });
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  assert.deepEqual(eventNames(events), ["update-available"]);
});

test("an installed update can't be dismissed", async () => {
  const { updater, github } = await setup();
  v2Nightly(github);
  await updater.checkForUpdate();
  await updater.installUpdate();
  await assert.rejects(updater.dismissUpdate(), /runs at the next launch/);
});

test("automatic checks run at startup and at each interval, and stop when turned off", async () => {
  const { updater, github, timers } = await setup();
  v2Nightly(github, { date: "17.10.2026", commit: "abc1234ff" });
  await updater.startUpdateChecks();
  assert.equal(github.requests.length, 1);
  await timers.tick();
  assert.equal(github.requests.length, 2);
  await updater.setAutomaticUpdateChecks(false);
  await timers.tick();
  await updater.stopUpdateChecks();
  assert.equal(github.requests.length, 2);
  assert.equal(timers.active, 0);
});

test("the automatic check interval is six hours", async () => {
  const { updater, timers } = await setup();
  const intervals = [];
  timers.setInterval = (fn, ms) => intervals.push(ms);
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  assert.deepEqual(intervals, [updateCheckInterval]);
  assert.equal(updateCheckInterval, 6 * 60 * 60 * 1000);
});

test("turning automatic checks back on checks right away, and on when already on doesn't", async () => {
  const { updater, github, config } = await setup({ config: createFakeConfig({ v2_update_checks: false }) });
  v2Nightly(github);
  await updater.startUpdateChecks();
  assert.equal(github.requests.length, 0);
  const settings = await updater.setAutomaticUpdateChecks(true);
  assert.equal(settings.AutomaticChecks, true);
  assert.equal(config.values.v2_update_checks, true);
  await updater.stopUpdateChecks();
  assert.equal(github.requests.length, 1);
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  github.requests.length = 0;
  await updater.startUpdateChecks();
  await updater.setAutomaticUpdateChecks(true);
  await updater.stopUpdateChecks();
  assert.equal(github.requests.length, 1);
});

test("a failed automatic check is logged, never shown", async () => {
  const { updater, github, events, log } = await setup();
  v2Nightly(github);
  github.answers.set(`${repo}/releases/tags/v2-nightly`, { status: 500 });
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  assert.deepEqual(events, []);
  assert.match(log.lines.join("\n"), /automatic check .* v2-nightly channel failed/);
});

test("a development build never checks and saves no update settings", async () => {
  const { updater, github, config } = await setup({ build: { Channel: "dev", Version: "2.0.0-dev" } });
  assert.equal((await updater.checkForUpdate()).Outcome, "unavailable");
  assert.equal((await updater.getUpdateState()).Status, "unavailable");
  assert.deepEqual((await updater.getUpdateSettings()).Channels, []);
  await assert.rejects(updater.setUpdateChannel("v2-nightly"), /development builds/);
  await assert.rejects(updater.setAutomaticUpdateChecks(false), /development builds/);
  await updater.startUpdateChecks();
  await updater.stopUpdateChecks();
  assert.deepEqual(github.requests, []);
  assert.deepEqual(config.values, {});
});

// The release and nightly channels a post-merge build follows.

test("a release build is offered only a newer release, ignoring prereleases", async () => {
  const build = { Channel: "release", Version: "17.10.2026" };
  const { updater, github } = await setup({ build });
  github.publish({ tag: "17.10.2026", files: { [asset]: "same" } });
  github.publish({ tag: "18.10.2026", prerelease: true });
  assert.equal((await updater.checkForUpdate()).Outcome, "none");
  github.publish({ tag: "17.10.2026-1", notes: "fixes", files: { [asset]: newBuild } });
  const check = await updater.checkForUpdate();
  assert.equal(check.Update.Version, "17.10.2026-1");
  assert.equal(check.Update.Notes, "fixes");
});

test("a nightly switched to release keeps the nightly until a later release", async () => {
  const build = { Channel: "nightly", Version: "17.10.2026 (nightly abc1234)" };
  const { updater, github } = await setup({ build });
  github.publish({ tag: "17.10.2026-3" });
  const change = await updater.setUpdateChannel("release");
  assert.equal(change.Check, null);
  assert.equal((await updater.checkForUpdate()).Outcome, "none");
  github.publish({ tag: "18.10.2026" });
  assert.equal((await updater.checkForUpdate()).Outcome, "available");
});

test("reinstalling the latest release warns, installs it and then follows the release channel", async () => {
  const build = { Channel: "nightly", Version: "17.10.2026 (nightly abc1234)" };
  const { updater, github, asks, config, installLocation, options } = await setup({ build });
  github.publish({ tag: "16.10.2026", files: { [asset]: newBuild } });
  options.answer = false;
  assert.equal((await updater.reinstallLatestRelease()).Outcome, "cancelled");
  assert.equal(config.values.v2_update_channel, undefined);
  assert.equal(await fs.readFile(installLocation, "utf8"), "old build");
  options.answer = true;
  const result = await updater.reinstallLatestRelease();
  assert.equal(result.Outcome, "installed");
  assert.equal(asks.at(-1).title, "Reinstall latest release");
  assert.match(asks.at(-1).message, /install release 16\.10\.2026 in place of 17\.10\.2026 \(nightly abc1234\)/);
  assert.equal(config.values.v2_update_channel, "release");
  assert.equal(await fs.readFile(installLocation, "utf8"), newBuild);
});
