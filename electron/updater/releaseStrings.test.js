// The strings the updater, the packaging config and the v2-nightly workflow
// must agree on (docs/agents/maps/updates.md "Strings that must match").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { updateAssets } from "./installers.js";
import { parseNightlyVersion } from "./version.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const nightly = read(".github/workflows/v2-nightly.yml");
const build = read(".github/workflows/build.yml");

test("each platform's build is packaged under the asset name the updater installs", () => {
  const artifact = (section, ext) => pkg.build[section].artifactName.replace("${ext}", ext);
  assert.equal(artifact("mac", "zip"), updateAssets.darwin);
  assert.equal(artifact("portable", "exe"), updateAssets.win32);
  assert.equal(artifact("appImage", "AppImage"), updateAssets.linux);
  assert.deepEqual(pkg.build.win.target.map((t) => t.target), ["portable"]);
  assert.ok(pkg.build.linux.target.some((t) => t.target === "AppImage"));
  assert.ok(pkg.build.mac.target.some((t) => t.target === "zip" && t.arch.includes("universal")));
});

test("the v2-nightly workflow builds each asset, lists it in the signed checksums and publishes it", () => {
  const checksums = nightly.slice(nightly.indexOf("sha256sum"), nightly.indexOf("> checksums.txt"));
  const publish = nightly.slice(nightly.indexOf("gh release create v2-nightly"));
  for (const asset of Object.values(updateAssets)) {
    assert.ok(build.includes(asset), `build.yml collects ${asset}`);
    assert.ok(checksums.includes(asset), `checksums list ${asset}`);
    assert.ok(publish.includes(`dist/${asset}`), `the release carries ${asset}`);
  }
  assert.ok(publish.includes("dist/checksums.txt.minisig"));
});

test("the v2 nightly is its own prerelease, titled with a version only the v2-nightly channel reads", () => {
  assert.match(nightly, /channel: v2-nightly/);
  assert.match(nightly, /--prerelease \\\n\s+--latest=false/);
  assert.match(nightly, /git tag -f v2-nightly "\$SHA"/);
  assert.doesNotMatch(nightly, /refs\/tags\/nightly\b|release (view|delete|create) nightly\b/);
  const format = /echo "version=\$\(date -u '\+%d\.%m\.%Y'\) \(v2-nightly \$\{sha:0:7\}\)"/;
  assert.match(nightly, format);
  assert.ok(parseNightlyVersion("18.10.2026 (v2-nightly def5678)", "v2-nightly"));
  assert.equal(parseNightlyVersion("18.10.2026 (v2-nightly def5678)", "nightly"), null);
  assert.match(nightly, /Commit: %s/);
});

test("a v2 build is its own app beside v1", () => {
  assert.equal(pkg.build.appId, "ae.tfkr.marasi-app.v2");
  assert.equal(pkg.build.productName, "Marasi v2");
  assert.equal(pkg.productName, "Marasi v2");
});
