import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { gzipBuild } from "./gzipBuild.js";

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gzip-build-"));
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return dir;
}

function listed(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

const script = "console.log('marasi');\n".repeat(200);

test("a file that compresses well is replaced by its .gz", () => {
  const dir = tree({ "index.html": "<p>hello</p>".repeat(100), "tools/cyberchef/main.js": script });

  gzipBuild(dir);

  assert.deepEqual(listed(dir), ["index.html.gz", "tools/cyberchef/main.js.gz"]);
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(dir, "tools/cyberchef/main.js.gz"))).toString(), script);
});

test("PNGs, already compressed files and files without an extension stay as they are", () => {
  const random = crypto.randomBytes(4096);
  const dir = tree({
    "logo.png": "\x89PNG" + "a".repeat(4000),
    "fonts/Virgil.woff2": zlib.brotliCompressSync(Buffer.from(script)),
    "fonts/noise.woff": random,
    "tools/cyberchef/LICENSE": "Apache License\n".repeat(200),
  });

  gzipBuild(dir);

  assert.deepEqual(listed(dir), ["fonts/Virgil.woff2", "fonts/noise.woff", "logo.png", "tools/cyberchef/LICENSE"]);
});

test("it reports the sizes before and after", () => {
  const dir = tree({ "a.js": script, "b.png": "png" });

  const result = gzipBuild(dir);

  assert.equal(result.compressed, 1);
  assert.equal(result.before, script.length + 3);
  assert.equal(result.after, fs.statSync(path.join(dir, "a.js.gz")).size + 3);
});
