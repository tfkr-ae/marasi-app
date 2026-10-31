// The part of an install that differs per platform (v1's platformInstaller):
// the shared pipeline in updater.js downloads and verifies, and an installer
// turns the verified download into the installed build. None is tied to its
// platform, so tests install into a temp directory with any of them; fs is
// node:fs/promises and the process calls come in as functions.
//
// An installer is {asset, checkReplaceable(location), stage(download,
// location, verified), swap(staged, location), relaunch(location)}, and
// removeLeftovers(location) when an install leaves the previous build
// behind. A v2 build's assets are named apart from v1's (marasi-app,
// marasi-app.exe, marasi-app.app.zip), so v2 never installs a v1 build.
import { randomBytes } from "node:crypto";
import { dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { failed } from "./failure.js";
import { zipEntries } from "./zip.js";

/** The release asset each platform installs. */
export const updateAssets = {
  darwin: "marasi-v2-mac.zip",
  win32: "marasi-v2-windows.exe",
  linux: "marasi-v2-linux.AppImage",
};

const hidden = (dir, prefix, suffix = "") => join(dir, `${prefix}${randomBytes(6).toString("hex")}${suffix}`);

// Tries to create a file beside location, which staging and the swap need.
async function checkWritable(fs, location) {
  const dir = dirname(location);
  const probe = hidden(dir, ".marasi-app-write-check-");
  try {
    await (await fs.open(probe, "wx", 0o600)).close();
  } catch {
    throw failed("permissions", `Marasi cannot write to ${dir}, where it is installed`);
  }
  await fs.rm(probe, { force: true });
}

// The running build's permissions, executable by everyone who could read it.
async function executableMode(fs, location) {
  let mode = 0o755;
  try {
    mode = (await fs.stat(location)).mode & 0o777;
  } catch {}
  return mode | ((mode & 0o444) >> 2) | 0o100;
}

/**
 * A build that is one executable file: the Linux AppImage. stage copies it
 * beside location and flushes it, so the rename in swap is the only step
 * that changes the install. spawnDetached(path) starts a build that
 * outlives the app.
 */
export function binaryInstaller({ asset, fs, spawnDetached }) {
  return {
    asset,
    checkReplaceable: (location) => checkWritable(fs, location),
    async stage(download, location, verified) {
      verified();
      const staged = hidden(dirname(location), ".marasi-app-update-");
      try {
        await fs.copyFile(download, staged);
        await fs.chmod(staged, await executableMode(fs, location));
        const handle = await fs.open(staged, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        await fs.rm(staged, { force: true });
        throw error;
      }
      return staged;
    },
    async swap(staged, location) {
      try {
        await fs.rename(staged, location);
      } catch (error) {
        throw new Error(`moving the new build into place: ${error.message}`, { cause: error });
      }
    },
    relaunch: (location) => spawnDetached(location),
  };
}

/** Where the Windows install moves the running build. */
export const asideName = (location) => `${location}.old`;

/**
 * The Windows portable .exe. Windows won't replace or delete a running
 * executable but will rename one, so swap moves it aside to <name>.old and
 * the new one into its place, and the next launch removes the .old copy.
 */
export function exeInstaller({ asset, fs, spawnDetached }) {
  const binary = binaryInstaller({ asset, fs, spawnDetached });
  return {
    ...binary,
    async swap(staged, location) {
      const aside = asideName(location);
      // A leftover the last launch could not remove is an older build than
      // the running one, so it can go.
      try {
        await fs.rm(aside, { force: true });
      } catch (error) {
        throw new Error(`removing the leftover previous version: ${error.message}`, { cause: error });
      }
      try {
        await fs.rename(location, aside);
      } catch (error) {
        throw new Error(`moving the running build aside: ${error.message}`, { cause: error });
      }
      try {
        await fs.rename(staged, location);
      } catch (error) {
        try {
          await fs.rename(aside, location);
        } catch (restoreError) {
          throw new Error(
            `moving the new build into place: ${error.message} (and putting the running build back: ${restoreError.message})`,
            { cause: error },
          );
        }
        throw new Error(`moving the new build into place: ${error.message}`, { cause: error });
      }
    },
    async removeLeftovers(location) {
      await fs.rm(asideName(location), { force: true });
    },
  };
}

/** What the panel says when Gatekeeper runs Marasi from a translocated copy. */
export const translocatedReason = "Move Marasi to Applications to enable updates";

/**
 * Whether location is a copy Gatekeeper's App Translocation runs a
 * quarantined app from (opened straight from Downloads). It is on a
 * read-only mount, and replacing it would not update the app the
 * researcher opens.
 */
export const translocated = (location) => location.split(/[\\/]/).includes("AppTranslocation");

// Unpacks the zip at archive into dir and returns the one .app it holds.
// Entries outside dir are refused, symlinks are kept, and the AppleDouble
// metadata ditto adds (__MACOSX, ._ files) is skipped.
async function unzipApp(fs, archive, dir) {
  let entries;
  try {
    entries = zipEntries(await fs.readFile(archive));
  } catch (error) {
    throw failed("install", `could not open the downloaded app: ${error.message}`);
  }
  const root = await fs.realpath(dir);
  const apps = new Set();
  for (const entry of entries) {
    const name = normalize(entry.name.replace(/\/+$/, ""));
    if (!name || isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`) || entry.name.includes("\\")) {
      throw failed("install", `the downloaded app holds a file outside it: ${entry.name}`);
    }
    const parts = name.split(sep);
    if (parts[0] === "__MACOSX" || parts.at(-1).startsWith("._")) continue;
    if (extname(parts[0]).toLowerCase() !== ".app" || (parts.length === 1 && !entry.isDir)) {
      throw failed("install", `the downloaded zip holds ${entry.name}, which is not part of an app`);
    }
    apps.add(parts[0]);
    try {
      await unzipEntry(fs, root, entry, name);
    } catch (error) {
      throw failed("install", `could not unpack the downloaded app: ${error.message}`);
    }
  }
  if (apps.size !== 1) throw failed("install", `the downloaded zip holds ${apps.size} apps, wanted one`);
  return join(dir, [...apps][0]);
}

// Writes one entry to name inside root. Its parent must resolve inside
// root, so no write goes through an unpacked symlink to outside it.
async function unzipEntry(fs, root, entry, name) {
  const path = join(root, name);
  const parent = entry.isDir ? path : dirname(path);
  await fs.mkdir(parent, { recursive: true, mode: 0o755 });
  const real = relative(root, await fs.realpath(parent));
  if (real === ".." || real.startsWith(`..${sep}`) || isAbsolute(real)) {
    throw new Error(`${entry.name} is outside the app`);
  }
  if (entry.isDir) return;
  if (entry.isSymlink) return fs.symlink(entry.read().toString(), path);
  await fs.writeFile(path, entry.read(), { mode: entry.mode | 0o600, flag: "wx" });
}

/**
 * A macOS app bundle, shipped as a zip. Its install location is the .app
 * enclosing the running executable.
 *
 * - teamOf(bundle): the Apple developer team the bundle is signed by, or ""
 *   (codesignTeam in production; tests read a file).
 * - openBundle(location): launches the bundle as a new instance.
 */
export function bundleInstaller({ asset, fs, teamOf, openBundle }) {
  async function checkTeam(app, location) {
    let running;
    try {
      running = await teamOf(location);
    } catch (error) {
      throw failed("team", `could not read the developer team of the running Marasi: ${error.message}`);
    }
    if (!running) {
      throw failed(
        "team",
        "the running Marasi is not signed by an Apple developer team, so the new app's developer team cannot be confirmed",
      );
    }
    let candidate;
    try {
      candidate = await teamOf(app);
    } catch (error) {
      throw failed("team", `could not read the developer team of the new app: ${error.message}`);
    }
    if (candidate !== running) {
      throw failed("team", `the new app is not signed by the Marasi developer team (${running}), so it was not installed`);
    }
  }

  return {
    asset,
    async checkReplaceable(location) {
      if (translocated(location)) throw failed("permissions", translocatedReason);
      await checkWritable(fs, location);
    },
    // Unpacking and the team check are the verify step; moving the app into
    // its staged place, directly beside location, starts the install step.
    async stage(download, location, verified) {
      const dir = dirname(location);
      const unpacked = await fs.mkdtemp(join(dir, ".marasi-app-unpack-"));
      try {
        const app = await unzipApp(fs, download, unpacked);
        await checkTeam(app, location);
        verified();
        const staged = hidden(dir, ".marasi-app-update-", ".app");
        await fs.rename(app, staged);
        return staged;
      } finally {
        await fs.rm(unpacked, { recursive: true, force: true });
      }
    },
    // Moves the running bundle aside and the staged one into its place,
    // putting the running one back if that fails, then removes the old one.
    async swap(staged, location) {
      const aside = `${staged}.old`;
      try {
        await fs.rename(location, aside);
      } catch (error) {
        throw new Error(`moving the running app aside: ${error.message}`, { cause: error });
      }
      try {
        await fs.rename(staged, location);
      } catch (error) {
        await fs.rename(aside, location).catch(() => {});
        throw new Error(`moving the new app into place: ${error.message}`, { cause: error });
      }
      await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
    },
    relaunch: (location) => openBundle(location),
  };
}

/**
 * Where the running build is installed, or "" when this build can't be
 * found: the .app enclosing the executable on macOS, the portable .exe
 * electron-builder names in PORTABLE_EXECUTABLE_FILE on Windows, and the
 * AppImage in APPIMAGE on Linux. An installed .deb or an unpacked build has
 * no single file to replace.
 */
export async function locateInstall({ platform, execPath, env, realpath }) {
  if (platform === "darwin") {
    let path;
    try {
      path = await realpath(execPath);
    } catch {
      return "";
    }
    for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
      if (extname(dir).toLowerCase() === ".app") return dir;
    }
    return "";
  }
  if (platform === "win32") return env.PORTABLE_EXECUTABLE_FILE || "";
  if (platform === "linux") return env.APPIMAGE || "";
  return "";
}

/** The developer team in `codesign -dv` output; "not set" (ad-hoc) is none. */
export function parseTeamIdentifier(display) {
  for (const line of display.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("TeamIdentifier=")) {
      const team = trimmed.slice("TeamIdentifier=".length);
      return team === "not set" ? "" : team;
    }
  }
  return "";
}

/**
 * The installer for `platform`, or null when Marasi ships no build for it.
 * run(file, args) runs a command and resolves {stdout, stderr} or rejects
 * with them; spawnDetached(path) starts a build that outlives the app.
 */
export function defaultInstaller({ platform, fs, run, spawnDetached }) {
  if (platform === "linux") return binaryInstaller({ asset: updateAssets.linux, fs, spawnDetached });
  if (platform === "win32") return exeInstaller({ asset: updateAssets.win32, fs, spawnDetached });
  if (platform !== "darwin") return null;
  // The team once codesign has checked the signature is intact; "" for an
  // unsigned or ad-hoc signed bundle, which is refused either way.
  async function codesignTeam(bundle) {
    let display;
    try {
      const out = await run("/usr/bin/codesign", ["-dv", "--verbose=4", bundle]);
      display = `${out.stdout}${out.stderr}`;
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      if (output.includes("not signed at all")) return "";
      throw new Error(`reading the code signature: ${output.trim() || error.message}`);
    }
    const team = parseTeamIdentifier(display);
    if (!team) return "";
    try {
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
    } catch (error) {
      throw new Error(`the code signature is not valid: ${`${error.stderr ?? ""}`.trim() || error.message}`);
    }
    return team;
  }
  return bundleInstaller({
    asset: updateAssets.darwin,
    fs,
    teamOf: codesignTeam,
    // open -n: a new instance, since the app it replaces is still quitting.
    openBundle: (location) => run("/usr/bin/open", ["-n", location]),
  });
}
