import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedUaParser, shipsFile, tarExtractArgs } from "./build.js";

test("the app ships CyberChef's files and licences, but not its precompressed copies or the bundle report", () => {
  for (const file of ["index.html", "assets/main.js", "modules/UserAgent.js", "ChefWorker.js.LICENSE.txt", "LICENSE", "assets/fonts/Roboto.woff2"]) {
    assert.equal(shipsFile(file), true, file);
  }
  for (const file of ["index.html.gz", "assets/main.js.br", "modules/Crypto.js.gz", "BundleAnalyzerReport.html", "CyberChef_v11.6.0.zip"]) {
    assert.equal(shipsFile(file), false, file);
  }
});

test("only ua-parser-js 1.x (MIT) may be built in, never the AGPL 2.x", () => {
  assert.equal(allowedUaParser({ version: "1.0.41", license: "MIT" }), true);
  assert.equal(allowedUaParser({ version: "2.0.10", license: "AGPL-3.0-or-later" }), false);
  assert.equal(allowedUaParser({ version: "2.0.0", license: "MIT" }), false);
  assert.equal(allowedUaParser({ version: "1.0.41", license: "AGPL-3.0" }), false);
});

test("tar unpacks the source by relative names, so a Windows drive letter never reaches it", () => {
  const args = tarExtractArgs();
  for (const arg of args) assert.doesNotMatch(arg, /^[A-Za-z]:|^[\\/]/, arg);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cyberchef-tar-"));
  try {
    fs.mkdirSync(path.join(work, "pack", "CyberChef-11.6.0"), { recursive: true });
    fs.writeFileSync(path.join(work, "pack", "CyberChef-11.6.0", "package.json"), "{}");
    const packed = spawnSync("tar", ["-czf", "../source.tar.gz", "CyberChef-11.6.0"], { cwd: path.join(work, "pack") });
    assert.equal(packed.status, 0, String(packed.stderr));
    fs.mkdirSync(path.join(work, "extract"));
    const unpacked = spawnSync("tar", args, { cwd: work });
    assert.equal(unpacked.status, 0, String(unpacked.stderr));
    assert.ok(fs.existsSync(path.join(work, "extract", "CyberChef-11.6.0", "package.json")));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
