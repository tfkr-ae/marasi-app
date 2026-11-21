// The release-build checks of scripts/check-tools.sh, on frontend/build,
// which the app binary embeds (main.go, `//go:embed all:frontend/build`):
// the files that compress well are stored only as <name>.gz (gzipBuild.js),
// the tool harness is absent, and the tools' notices ship (frontend/licences,
// toolNotices in notices.js).
//
//   node frontend/tool-checks/check-release.js   (after `npm run build`)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createReport } from "./report.js";
import { COMPRESSIBLE } from "../gzipBuild.js";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(frontend, "build");

// Strings only the harness (tool-harness/) contains.
const HARNESS_MARKERS = ["marasi-tool-harness", "harnessReady", "window.harness"];
const APACHE = /Apache License\s+Version 2\.0/;
const MIT = /Permission is hereby granted, free of charge/;
// The OFL's own text, not only its name.
const OFL = /SIL OPEN FONT LICENSE Version 1\.1[\s\S]*PERMISSION & CONDITIONS/;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

const TEXT = /\.(html|js|mjs|css|json|txt|svg)$/;
const report = createReport("release");

// A file as the app serves it: <file> itself, or <file>.gz decompressed.
const stored = (file) => (fs.existsSync(file) ? file : `${file}.gz`);
const exists = (file) => fs.existsSync(file) || fs.existsSync(`${file}.gz`);
function read(file) {
  const at = stored(file);
  const data = fs.readFileSync(at);
  return (at.endsWith(".gz") ? zlib.gunzipSync(data) : data).toString("utf8");
}

if (!exists(path.join(build, "index.html"))) {
  report.fail("release build exists", "no frontend/build/index.html(.gz); run npm run build");
  process.exit(report.finish());
}

const all = [...files(build)];
const served = all.map((file) => file.replace(/\.gz$/, ""));
const texts = served.filter((file) => TEXT.test(file) || path.basename(file) === "LICENSE");

await report.check("the embedded set is the gzipped one", () => {
  const problems = [];
  for (const file of all) {
    const name = path.relative(build, file);
    if (file.endsWith(".gz")) {
      if (fs.existsSync(file.slice(0, -3))) problems.push(`${name} beside its original`);
      continue;
    }
    if (!COMPRESSIBLE.test(file)) continue;
    const data = fs.readFileSync(file);
    // gzipBuild.js keeps a file only when gzip saves less than 10%.
    if (zlib.gzipSync(data, { level: 9 }).length <= data.length * 0.9) problems.push(`${name} not gzipped`);
  }
  for (const name of ["index.html", "tools/cyberchef/index.html"]) {
    if (!fs.existsSync(path.join(build, `${name}.gz`))) problems.push(`no ${name}.gz`);
  }
  if (problems.length) throw new Error(problems.slice(0, 10).join(", ") + (problems.length > 10 ? `, … ${problems.length} in all` : ""));
  const size = (list) => list.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const gz = all.filter((file) => file.endsWith(".gz"));
  const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${gz.length} of ${all.length} files gzipped, ${mib(size(all))} embedded`;
});

await report.check("the tool harness is absent from the release build", () => {
  const found = [];
  for (const file of texts) {
    const text = read(file);
    for (const marker of HARNESS_MARKERS) if (text.includes(marker)) found.push(`${path.relative(build, file)} (${marker})`);
  }
  const paths = all.filter((file) => /tool-harness/.test(path.relative(build, file)));
  if (found.length || paths.length) throw new Error([...found, ...paths].join(", "));
  return `${texts.length} text files searched`;
});

await report.check("CyberChef's LICENSE and notice ship beside it", () => {
  const licence = path.join(build, "tools/cyberchef/LICENSE");
  if (!exists(licence) || !APACHE.test(read(licence))) throw new Error("no Apache-2.0 LICENSE at tools/cyberchef/LICENSE");
  const notice = path.join(build, "tools/cyberchef/MARASI-NOTICE.txt");
  if (!exists(notice) || !/Crown Copyright/.test(read(notice))) throw new Error("no tools/cyberchef/MARASI-NOTICE.txt");
});

await report.check("the OFL text ships beside Excalidraw's fonts", () => {
  const licence = path.join(build, "excalidraw-assets/fonts/LICENSE.txt");
  if (!exists(licence) || !OFL.test(read(licence))) throw new Error("no OFL-1.1 text at excalidraw-assets/fonts/LICENSE.txt");
});

// The Licences modal (Settings → About) reads licences.json's tools.
await report.check("the Licences modal credits both tools with their texts", () => {
  const tools = JSON.parse(read(path.join(build, "licences.json"))).tools ?? [];
  const tool = (name) => tools.find((t) => t.name === name);
  const chef = tool("CyberChef");
  if (!chef || !APACHE.test(chef.text) || !/Crown Copyright/.test(chef.text)) throw new Error("no CyberChef entry with its Apache-2.0 LICENSE and notice");
  const excalidraw = tool("Excalidraw");
  if (!excalidraw || !MIT.test(excalidraw.text) || !OFL.test(excalidraw.text)) throw new Error("no Excalidraw entry with its MIT licence and the fonts' OFL text");
  return `CyberChef ${chef.version}, Excalidraw ${excalidraw.version}`;
});

process.exitCode = report.finish();
