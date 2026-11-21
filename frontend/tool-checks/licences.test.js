import { test } from "node:test";
import assert from "node:assert/strict";
import { bundledPackages, declaredLicence, licenceProblems } from "./licences.js";

const pkg = (name, license, extra = {}) => ({ name, version: "1.0.0", license, ...extra });

test("a GPL or AGPL package is a problem, unless the expression offers a permissive choice", () => {
  const problems = licenceProblems(
    [
      pkg("mit", "MIT"),
      pkg("gpl", "GPL-3.0"),
      pkg("agpl", "AGPL-3.0-or-later"),
      pkg("gpl-plus", "GPL-2.0+"),
      pkg("dual", "(MIT OR GPL-3.0)"),
      pkg("both", "MIT AND GPL-2.0-only"),
      pkg("old-style", "GPL"),
    ],
    {},
  );
  assert.deepEqual(
    problems.map((p) => p.name),
    ["gpl", "agpl", "gpl-plus", "both", "old-style"],
  );
  assert.match(problems[0].problem, /GPL-3\.0/);
});

test("a package that declares no licence needs an allow-list entry with a reason", () => {
  const packages = [pkg("ctph.js", ""), pkg("ntlm", undefined), pkg("exif-parser", "")];
  const problems = licenceProblems(packages, {
    "ctph.js": "BSD-style, per its source headers",
    "exif-parser": "",
  });
  assert.deepEqual(
    problems.map((p) => [p.name, p.problem]),
    [
      ["ntlm", "declares no licence and has no allow-list entry"],
      ["exif-parser", "declares no licence; its allow-list entry gives no reason"],
    ],
  );
});

test("an allow-list entry for a package that declares a licence is stale", () => {
  const problems = licenceProblems([pkg("ok", "MIT")], { ok: "was missing once" });
  assert.deepEqual(problems.map((p) => [p.name, p.problem]), [["ok", "declares MIT; drop its allow-list entry"]]);
});

test("the bundled tree is what the roots pull in through the lockfile, nested copies included, never dev-only packages", () => {
  const lock = {
    packages: {
      "": { dependencies: { a: "^1" }, devDependencies: { webpack: "^5" } },
      "node_modules/a": { version: "1.0.0", license: "MIT", dependencies: { b: "^1", c: "^2" } },
      "node_modules/b": { version: "1.0.0", license: "ISC", optionalDependencies: { d: "^1" } },
      "node_modules/c": { version: "1.0.0", license: "MIT" },
      "node_modules/a/node_modules/c": { version: "2.0.0", license: "GPL-3.0" },
      "node_modules/d": { version: "1.0.0", license: "MIT" },
      "node_modules/webpack": { version: "5.0.0", license: "MIT", dev: true },
      "node_modules/unrelated": { version: "1.0.0", license: "AGPL-3.0" },
    },
  };
  const bundled = bundledPackages(lock, ["a"]);
  assert.deepEqual(
    bundled.map((p) => `${p.name}@${p.version}:${p.license}`).sort(),
    ["a@1.0.0:MIT", "b@1.0.0:ISC", "c@2.0.0:GPL-3.0", "d@1.0.0:MIT"],
  );
});

test("an optional package that isn't installed is skipped, an installed one is checked, a missing required one is an error", () => {
  const lock = {
    packages: {
      "": { dependencies: { a: "^1" } },
      "node_modules/a": { version: "1.0.0", license: "MIT", optionalDependencies: { fsevents: "^2", "native-linux": "^1" } },
      "node_modules/fsevents": { version: "2.3.3", license: "MIT", optional: true, os: ["darwin"] },
      "node_modules/native-linux": { version: "1.0.0", license: "GPL-3.0", optional: true, os: ["linux"] },
    },
  };
  const onLinux = (at) => at !== "node_modules/fsevents";
  assert.deepEqual(
    bundledPackages(lock, ["a"], onLinux).map((p) => p.name),
    ["a", "native-linux"],
  );
  const onMac = (at) => at !== "node_modules/native-linux";
  assert.deepEqual(
    bundledPackages(lock, ["a"], onMac).map((p) => p.name),
    ["a", "fsevents"],
  );
  const required = { packages: { ...lock.packages, "node_modules/a": { version: "1.0.0", dependencies: { b: "^1" } }, "node_modules/b": { version: "1.0.0" } } };
  assert.throws(() => bundledPackages(required, ["a"], (at) => at !== "node_modules/b"), /b \(node_modules\/b\) is in the lockfile but not installed/);
});

test("a root missing from the lockfile is an error, not an empty tree", () => {
  assert.throws(() => bundledPackages({ packages: { "": {} } }, ["@excalidraw/excalidraw"]), /@excalidraw\/excalidraw is not installed/);
});

test("an installed package's licence is its license field, or its old licenses array as a choice", () => {
  assert.equal(declaredLicence({ license: " LGPL-3.0+" }), "LGPL-3.0+");
  assert.equal(declaredLicence({ license: { type: "MIT", url: "…" } }), "MIT");
  assert.equal(declaredLicence({ licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] }), "(MIT OR GPL-2.0)");
  assert.equal(declaredLicence({ licenses: [{ type: "MIT", url: "" }] }), "MIT");
  assert.equal(declaredLicence({}), "");
  assert.equal(licenceProblems([pkg("dual", "(MIT OR GPL-2.0)")], {}).length, 0);
});
