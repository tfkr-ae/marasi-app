// The Windows and macOS installers through a whole install, into a temp
// directory, as v1's app_update_exe_test.go and app_update_bundle_test.go.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeConfig, createFakeGitHub, createLog, repo, tempDir } from "../testing/fakeUpdates.js";
import { makeZip } from "../testing/zipWriter.js";
import {
  asideName,
  bundleInstaller,
  exeInstaller,
  locateInstall,
  parseTeamIdentifier,
  translocatedReason,
  updateAssets,
} from "./installers.js";
import { createUpdater } from "./updater.js";
import { parsePublicKey } from "./verify.js";

const build = { Channel: "v2-nightly", Version: "17.10.2026 (v2-nightly abc1234)" };

function publish(github, files) {
  github.publish({
    tag: "v2-nightly",
    name: "18.10.2026 (v2-nightly def5678)",
    notes: "Commit: def5678aa",
    prerelease: true,
    files,
  });
}

async function install({ installer, installLocation, files, github = createFakeGitHub() }) {
  publish(github, files);
  const updater = createUpdater({
    build,
    signingKey: parsePublicKey(github.publicKey),
    config: createFakeConfig(),
    fetch: github.fetch,
    fs,
    tmpdir: await tempDir(),
    releaseSource: repo,
    installer,
    installLocation,
    log: createLog(),
  });
  await updater.checkForUpdate();
  return { updater, result: await updater.installUpdate(), state: await updater.getUpdateState() };
}

// ---- Windows ----

const exe = updateAssets.win32;

async function windowsInstall({ rename } = {}) {
  const dir = await tempDir();
  const location = join(dir, "Marasi v2.exe");
  await fs.writeFile(location, "running build");
  const installer = exeInstaller({ asset: exe, fs: rename ? { ...fs, rename } : fs, spawnDetached: async () => {} });
  return { dir, location, installer };
}

test("installing on Windows moves the running exe aside and the new one into place", async () => {
  const { location, installer } = await windowsInstall();
  const { result } = await install({ installer, installLocation: location, files: { [exe]: "new build" } });
  assert.equal(result.Outcome, "installed");
  assert.equal(await fs.readFile(location, "utf8"), "new build");
  assert.equal(await fs.readFile(asideName(location), "utf8"), "running build");
});

test("a failed move into place puts the running exe back", async () => {
  let renames = 0;
  const { location, installer } = await windowsInstall({
    rename: async (from, to) => {
      renames++;
      if (renames === 2) throw Object.assign(new Error("in use"), { code: "EBUSY" });
      return fs.rename(from, to);
    },
  });
  const { result } = await install({ installer, installLocation: location, files: { [exe]: "new build" } });
  assert.equal(result.Failure.Kind, "install");
  assert.equal(result.Failure.Step, "install");
  assert.equal(await fs.readFile(location, "utf8"), "running build");
});

test("installing again replaces a leftover the last launch didn't remove", async () => {
  const { location, installer } = await windowsInstall();
  await fs.writeFile(asideName(location), "older leftover");
  const { result } = await install({ installer, installLocation: location, files: { [exe]: "new build" } });
  assert.equal(result.Outcome, "installed");
  assert.equal(await fs.readFile(asideName(location), "utf8"), "running build");
});

test("the next launch removes the leftover, retrying while the old build exits, and a launch with none changes nothing", async () => {
  const { dir, location } = await windowsInstall();
  await fs.writeFile(asideName(location), "previous build");
  let attempts = 0;
  const flaky = exeInstaller({
    asset: exe,
    spawnDetached: async () => {},
    fs: {
      ...fs,
      rm: async (path, options) => {
        if (++attempts < 3) throw Object.assign(new Error("in use"), { code: "EBUSY" });
        return fs.rm(path, options);
      },
    },
  });
  const sleeps = [];
  const timers = { setInterval, clearInterval, sleep: async (ms) => sleeps.push(ms) };
  const options = { build, signingKey: null, config: createFakeConfig(), fetch, fs, tmpdir: dir, timers, log: createLog() };
  await createUpdater({ ...options, installer: flaky, installLocation: location }).removeUpdateLeftovers();
  await assert.rejects(fs.stat(asideName(location)), { code: "ENOENT" });
  assert.deepEqual(sleeps, [1000, 1000]);
  await createUpdater({ ...options, installer: exeInstaller({ asset: exe, fs, spawnDetached: async () => {} }), installLocation: location }).removeUpdateLeftovers();
  assert.deepEqual((await fs.readdir(dir)).sort(), ["Marasi v2.exe"]);
});

// ---- macOS ----

const mac = updateAssets.darwin;

// A Marasi v2.app whose team is read from Contents/team, and a zip of a new
// one signed by `team`.
async function macInstall({ team = "TEAM123", runningTeam = "TEAM123", parent } = {}) {
  const dir = parent ?? (await tempDir());
  await fs.mkdir(dir, { recursive: true });
  const location = join(dir, "Marasi v2.app");
  await fs.mkdir(join(location, "Contents", "MacOS"), { recursive: true });
  await fs.writeFile(join(location, "Contents", "MacOS", "Marasi v2"), "old");
  await fs.writeFile(join(location, "Contents", "team"), runningTeam);
  const opened = [];
  const installer = bundleInstaller({
    asset: mac,
    fs,
    teamOf: async (bundle) => (await fs.readFile(join(bundle, "Contents", "team"), "utf8").catch(() => "")).trim(),
    openBundle: async (path) => opened.push(path),
  });
  const zip = makeZip([
    { name: "Marasi v2.app/" },
    { name: "Marasi v2.app/Contents/" },
    { name: "Marasi v2.app/Contents/MacOS/Marasi v2", data: "new", mode: 0o755 },
    { name: "Marasi v2.app/Contents/Frameworks/Current", symlink: "A" },
    { name: "Marasi v2.app/Contents/team", data: team },
    { name: "__MACOSX/._Marasi v2.app", data: "apple double" },
  ]);
  return { dir, location, installer, zip, opened };
}

test("installing on macOS replaces the app bundle, keeping its symlinks and modes", async () => {
  const { dir, location, installer, zip } = await macInstall();
  const { result } = await install({ installer, installLocation: location, files: { [mac]: zip } });
  assert.equal(result.Outcome, "installed");
  const binary = join(location, "Contents", "MacOS", "Marasi v2");
  assert.equal(await fs.readFile(binary, "utf8"), "new");
  assert.equal((await fs.stat(binary)).mode & 0o755, 0o755);
  assert.equal(await fs.readlink(join(location, "Contents", "Frameworks", "Current")), "A");
  assert.deepEqual(await fs.readdir(dir), ["Marasi v2.app"]);
});

test("an app signed by another developer team is refused", async () => {
  const { location, installer, zip } = await macInstall({ team: "OTHERTEAM" });
  const { result } = await install({ installer, installLocation: location, files: { [mac]: zip } });
  assert.equal(result.Failure.Kind, "team");
  assert.equal(result.Failure.Step, "verify");
  assert.match(result.Failure.Reason, /not signed by the Marasi developer team \(TEAM123\)/);
  assert.equal(await fs.readFile(join(location, "Contents", "MacOS", "Marasi v2"), "utf8"), "old");
});

test("a running app without a developer team refuses the update", async () => {
  const { location, installer, zip } = await macInstall({ runningTeam: "" });
  const { result } = await install({ installer, installLocation: location, files: { [mac]: zip } });
  assert.equal(result.Failure.Kind, "team");
  assert.match(result.Failure.Reason, /not signed by an Apple developer team/);
});

test("a translocated app asks to be moved to Applications", async () => {
  const parent = join(await tempDir(), "AppTranslocation", "UUID", "d");
  const { location, installer, zip } = await macInstall({ parent });
  const { state } = await install({ installer, installLocation: location, files: { [mac]: zip } });
  assert.equal(state.CanInstall, false);
  assert.equal(state.CannotInstallReason, translocatedReason);
});

test("zip entries outside the app are refused", async () => {
  for (const name of ["../evil", "/abs/evil", "Marasi v2.app/../../evil", "readme.txt"]) {
    const { dir, location, installer } = await macInstall();
    const zip = makeZip([{ name: "Marasi v2.app/" }, { name, data: "x" }]);
    const { result } = await install({ installer, installLocation: location, files: { [mac]: zip } });
    assert.equal(result.Failure.Kind, "install", name);
    assert.deepEqual(await fs.readdir(dir), ["Marasi v2.app"], name);
  }
});

test("a zip with two apps is refused", async () => {
  const { location, installer } = await macInstall();
  const zip = makeZip([{ name: "A.app/" }, { name: "B.app/" }], { deflate: false });
  const { result } = await install({ installer, installLocation: location, files: { [mac]: zip } });
  assert.match(result.Failure.Reason, /holds 2 apps, wanted one/);
});

test("the install location is the enclosing app bundle, the portable exe or the AppImage", async () => {
  const dir = await fs.realpath(await tempDir());
  const executable = join(dir, "Marasi v2.app", "Contents", "MacOS", "Marasi v2");
  await fs.mkdir(join(executable, ".."), { recursive: true });
  await fs.writeFile(executable, "");
  const realpath = fs.realpath;
  assert.equal(await locateInstall({ platform: "darwin", execPath: executable, env: {}, realpath }), join(dir, "Marasi v2.app"));
  assert.equal(await locateInstall({ platform: "darwin", execPath: join(dir, "nope"), env: {}, realpath }), "");
  const env = { PORTABLE_EXECUTABLE_FILE: "C:\\Users\\r\\Marasi v2.exe", APPIMAGE: "/home/r/Marasi.AppImage" };
  assert.equal(await locateInstall({ platform: "win32", execPath: "x", env, realpath }), env.PORTABLE_EXECUTABLE_FILE);
  assert.equal(await locateInstall({ platform: "linux", execPath: "x", env, realpath }), env.APPIMAGE);
  assert.equal(await locateInstall({ platform: "linux", execPath: "/usr/lib/marasi", env: {}, realpath }), "");
});

test("the developer team is read from codesign's display; ad-hoc signing has none", () => {
  assert.equal(parseTeamIdentifier("Executable=/x\nTeamIdentifier=ABCDE12345\nSealed Resources"), "ABCDE12345");
  assert.equal(parseTeamIdentifier("Signature=adhoc\nTeamIdentifier=not set\n"), "");
});
