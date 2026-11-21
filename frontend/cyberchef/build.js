// Builds CyberChef from its pinned release tag into frontend/static/tools/cyberchef,
// which the app serves from its own origin (docs/adr/2026-11-21-cyberchef-
// runs-as-its-own-ui-served-same-origin.md). The built files are never
// committed. The build:
// - pins ua-parser-js to 1.x (MIT): CyberChef's "Parse User Agent" asks for
//   2.x, which is AGPL-3.0, and the build stops if any 2.x is installed;
// - drops the precompressed .gz and .br copies and the bundle report;
// - ships GCHQ's LICENSE beside the files, whose headers it keeps.
// It does nothing when the output already matches this pin.
//
//   node frontend/cyberchef/build.js
//
// CYBERCHEF_WORK_DIR moves the download and its node_modules (default
// .cache/cyberchef-<tag> in the repo, gitignored), so a rebuild reuses them.
// prepareSource() is the download and install alone: the licence check
// (frontend/tool-checks/licences.js) reads the installed tree from it.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CYBERCHEF_TAG = "v11.6.0";
const SOURCE_URL = `https://github.com/gchq/CyberChef/archive/refs/tags/${CYBERCHEF_TAG}.tar.gz`;
const SOURCE_SHA256 = "2cba92752364e7d82fcdc1ad00f7c0b1501953ed9a689180de11748f279132c1";
export const UA_PARSER_VERSION = "1.0.41";
// Bump when the build's steps change, so existing output is rebuilt.
const BUILD_REVISION = 1;

const DROPPED = [/\.gz$/, /\.br$/, /\.zip$/, /^BundleAnalyzerReport\.html$/];

/** Whether a file of CyberChef's build output (path relative to it) ships with the app. */
export function shipsFile(relative) {
  const name = relative.split(/[\\/]/).join("/");
  return !DROPPED.some((pattern) => pattern.test(name));
}

/** Whether an installed ua-parser-js package.json may be built in: 1.x under MIT only. */
export function allowedUaParser(pkg) {
  return /^1\./.test(pkg?.version ?? "") && pkg?.license === "MIT";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.join(repoRoot, "frontend/static/tools/cyberchef");
const stampFile = path.join(outDir, ".marasi-build.json");
const stamp = { tag: CYBERCHEF_TAG, sha256: SOURCE_SHA256, uaParser: UA_PARSER_VERSION, revision: BUILD_REVISION };

function log(message) {
  console.log(`cyberchef: ${message}`);
}

function upToDate() {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(stampFile, "utf8"))) === JSON.stringify(stamp);
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal})`);
}

async function fetchSource(workDir) {
  const srcDir = path.join(workDir, "src");
  if (fs.existsSync(path.join(srcDir, "package.json"))) return srcDir;
  log(`downloading ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== SOURCE_SHA256) throw new Error(`source checksum ${digest}, expected ${SOURCE_SHA256}`);
  const archive = path.join(workDir, "source.tar.gz");
  fs.writeFileSync(archive, body);
  const extractDir = path.join(workDir, "extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir);
  run("tar", ["-xzf", archive, "-C", extractDir], workDir);
  const [top] = fs.readdirSync(extractDir);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.renameSync(path.join(extractDir, top), srcDir);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(archive);
  return srcDir;
}

// Every ua-parser-js the install holds, nested copies included.
function installedUaParsers(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith("@")) installedUaParsers(full, found);
    else {
      if (entry.name === "ua-parser-js") found.push(JSON.parse(fs.readFileSync(path.join(full, "package.json"), "utf8")));
      installedUaParsers(path.join(full, "node_modules"), found);
    }
  }
  return found;
}

function install(srcDir) {
  const pkgFile = path.join(srcDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  if (pkg.dependencies["ua-parser-js"] !== UA_PARSER_VERSION || !fs.existsSync(path.join(srcDir, "node_modules"))) {
    pkg.dependencies["ua-parser-js"] = UA_PARSER_VERSION;
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    log(`installing dependencies (ua-parser-js ${UA_PARSER_VERSION})`);
    run("npm", ["install", "--no-audit", "--no-fund"], srcDir);
  }
  const parsers = installedUaParsers(path.join(srcDir, "node_modules"));
  const refused = parsers.filter((parser) => !allowedUaParser(parser));
  if (!parsers.length || refused.length) {
    throw new Error(`ua-parser-js must be 1.x (MIT); found ${parsers.map((p) => `${p.version} (${p.license})`).join(", ") || "none"}`);
  }
}

function build(srcDir) {
  log("building (webpack, a few minutes)");
  // The prod task without its lint, download zip and hash steps.
  run("npx", ["grunt", "clean:prod", "clean:config", "exec:generateConfig", "findModules", "webpack:web"], srcDir);
}

function publish(srcDir) {
  const prod = path.join(srcDir, "build/prod");
  const staging = `${outDir}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.cpSync(prod, staging, {
    recursive: true,
    filter: (from) => from === prod || shipsFile(path.relative(prod, from)),
  });
  fs.copyFileSync(path.join(srcDir, "LICENSE"), path.join(staging, "LICENSE"));
  fs.writeFileSync(
    path.join(staging, "MARASI-NOTICE.txt"),
    `CyberChef ${CYBERCHEF_TAG}, Crown Copyright, Apache-2.0 (see LICENSE).\n` +
      `Built by the Marasi app from GCHQ's release tag, unmodified except that ua-parser-js is\n` +
      `pinned to ${UA_PARSER_VERSION} (MIT) for the "Parse User Agent" operation. GCHQ does not endorse Marasi.\n`,
  );
  fs.writeFileSync(path.join(staging, ".marasi-build.json"), `${JSON.stringify(stamp)}\n`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(staging, outDir);
}

/** Downloads and installs CyberChef's pinned source (no build); resolves to its directory. */
export async function prepareSource() {
  const workDir = path.resolve(process.env.CYBERCHEF_WORK_DIR || path.join(repoRoot, ".cache", `cyberchef-${CYBERCHEF_TAG}`));
  fs.mkdirSync(workDir, { recursive: true });
  const srcDir = await fetchSource(workDir);
  install(srcDir);
  return srcDir;
}

async function main() {
  if (upToDate()) {
    log(`${CYBERCHEF_TAG} is up to date`);
    return;
  }
  const srcDir = await prepareSource();
  build(srcDir);
  publish(srcDir);
  log(`built ${CYBERCHEF_TAG} into ${path.relative(repoRoot, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`cyberchef: ${err.message}`);
    process.exit(1);
  });
}
