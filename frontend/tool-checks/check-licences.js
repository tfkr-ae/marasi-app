// The licence checks of scripts/check-tools.sh, for both tools' bundled
// dependency trees: Excalidraw's (with React) from the app's install, and
// CyberChef's from its pinned source as frontend/cyberchef/build.js
// installs it (ua-parser-js pinned to 1.x).
//
//   node frontend/tool-checks/check-licences.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSource } from "../cyberchef/build.js";
import { bundledPackages, declaredLicence, licenceProblems } from "./licences.js";
import { createReport } from "./report.js";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Packages that declare no licence in their package.json. Each may ship
// only for the reason given, read from its own files; an entry goes stale
// (and fails the check) once the package declares a licence.
const ALLOW = {
  excalidraw: {
    khroma: "MIT, per its license file (pulled in by mermaid)",
  },
  cyberchef: {
    "@alexaltea/capstone-js": "BSD-3-Clause, per its LICENSE",
    "ctph.js": "MIT, per its LICENSE",
    "exif-parser": "MIT, per its LICENSE.md",
    "keybase-ecurve": "MIT, per its LICENSE",
    ntlm: "ISC-style permission notice in each lib/*.js header",
    progress: "MIT, per its LICENSE",
    "ssdeep.js": "MIT, per its LICENSE",
    "urlsafe-base64": "MIT, per the License section of its readme.md",
  },
};

function tree(dir, roots) {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
  return bundledPackages(lock, roots).map((pkg) => {
    // The installed package.json is the truth; lockfiles often omit `license`.
    const installed = JSON.parse(fs.readFileSync(path.join(dir, pkg.path, "package.json"), "utf8"));
    return { ...pkg, license: declaredLicence(installed) };
  });
}

const report = createReport("licences");

async function checkTool(tool, dir, roots) {
  let packages;
  try {
    packages = tree(dir, roots);
  } catch (err) {
    report.fail(`${tool} dependency tree`, err.message);
    return;
  }
  const problems = licenceProblems(packages, ALLOW[tool]);
  const listed = (pick) => problems.filter(pick).map((p) => `${p.name}@${p.version} ${p.problem}`);
  const copyleft = listed((p) => p.problem.includes("copyleft"));
  const undeclared = listed((p) => !p.problem.includes("copyleft"));
  if (copyleft.length) report.fail(`${tool} has no GPL or AGPL package`, copyleft.join("; "));
  else report.pass(`${tool} has no GPL or AGPL package`, `${packages.length} packages`);
  if (undeclared.length) report.fail(`${tool} packages declare a licence`, undeclared.join("; "));
  else report.pass(`${tool} packages declare a licence`, `${Object.keys(ALLOW[tool]).length} allow-listed`);
}

await checkTool("excalidraw", frontend, ["@excalidraw/excalidraw", "react", "react-dom"]);
const chefSource = await prepareSource();
const chefPackage = JSON.parse(fs.readFileSync(path.join(chefSource, "package.json"), "utf8"));
await checkTool("cyberchef", chefSource, Object.keys(chefPackage.dependencies));

process.exitCode = report.finish();
