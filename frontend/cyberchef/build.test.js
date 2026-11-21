import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedUaParser, shipsFile } from "./build.js";

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
