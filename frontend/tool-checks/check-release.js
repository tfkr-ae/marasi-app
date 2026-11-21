// The release-build checks of scripts/check-tools.sh, on frontend/build,
// which the app binary embeds (main.go, `//go:embed all:frontend/build`):
// the tool harness is absent, and the tools' notices ship.
//
//   node frontend/tool-checks/check-release.js   (after `npm run build`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./report.js";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(frontend, "build");

// Whether Excalidraw's fonts' OFL text ships yet. Issue 06 adds it with the
// Licences modal's Excalidraw entry; set this then, and the check enforces it.
const OFL_SHIPS = false;

// Strings only the harness (tool-harness/) contains.
const HARNESS_MARKERS = ["marasi-tool-harness", "harnessReady", "window.harness"];
const OFL = /SIL OPEN FONT LICEN[CS]E\s+Version 1\.1/i;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

const TEXT = /\.(html|js|mjs|css|json|txt|svg)$/;
const report = createReport("release");

if (!fs.existsSync(path.join(build, "index.html"))) {
  report.fail("release build exists", "no frontend/build/index.html; run npm run build");
  process.exit(report.finish());
}

const texts = [...files(build)].filter((file) => TEXT.test(file) || path.basename(file) === "LICENSE");
const read = (file) => fs.readFileSync(file, "utf8");

await report.check("the tool harness is absent from the release build", () => {
  const found = [];
  for (const file of texts) {
    const text = read(file);
    for (const marker of HARNESS_MARKERS) if (text.includes(marker)) found.push(`${path.relative(build, file)} (${marker})`);
  }
  const paths = [...files(build)].filter((file) => /tool-harness/.test(path.relative(build, file)));
  if (found.length || paths.length) throw new Error([...found, ...paths].join(", "));
  return `${texts.length} text files searched`;
});

await report.check("CyberChef's LICENSE and notice ship", () => {
  const licence = path.join(build, "tools/cyberchef/LICENSE");
  if (!fs.existsSync(licence) || !/Apache License\s+Version 2\.0/.test(read(licence))) {
    throw new Error("no Apache-2.0 LICENSE at tools/cyberchef/LICENSE");
  }
  const notice = path.join(build, "tools/cyberchef/MARASI-NOTICE.txt");
  if (!fs.existsSync(notice) || !/Crown Copyright/.test(read(notice))) throw new Error("no tools/cyberchef/MARASI-NOTICE.txt");
});

const oflIn = texts.filter((file) => OFL.test(read(file))).map((file) => path.relative(build, file));
if (OFL_SHIPS) {
  await report.check("the OFL text of Excalidraw's fonts ships", () => {
    if (!oflIn.length) throw new Error("no file in the build holds the SIL Open Font License 1.1 text");
    return oflIn.join(", ");
  });
} else if (oflIn.length) {
  report.fail("the OFL text of Excalidraw's fonts ships", `it ships now (${oflIn.join(", ")}); set OFL_SHIPS in check-release.js`);
} else {
  report.pending("the OFL text of Excalidraw's fonts ships", "waits for issue 06 (Licences modal); no OFL text ships yet");
}

process.exitCode = report.finish();
