import { test } from "node:test";
import assert from "node:assert/strict";
import { createArtifactFile } from "./artifactFile.js";

// A fake fs that records writes, and a save dialog that answers `chosen`.
function setup(chosen, env = {}) {
  const writes = [];
  const asked = [];
  const artifactFile = createArtifactFile({
    fs: { writeFile: async (path, contents, options) => writes.push({ path, contents, options }) },
    dialog: { save: async (options) => (asked.push(options), chosen) },
    env,
    home: "/Users/r",
  });
  return { artifactFile, writes, asked };
}

const bytes = new Uint8Array([137, 80, 78, 71]);

test("save writes the artifact where the researcher chose, offering its name in Downloads as v1 did", async () => {
  const { artifactFile, writes, asked } = setup("/Users/r/Desktop/shot.png");
  assert.equal(await artifactFile.save("shot.png", bytes), "/Users/r/Desktop/shot.png");
  assert.equal(asked[0].title, "Save Artifact");
  assert.equal(asked[0].defaultPath, "/Users/r/Downloads/shot.png");
  assert.deepEqual(writes, [{ path: "/Users/r/Desktop/shot.png", contents: bytes, options: { mode: 0o600 } }]);
});

test("the offered name drops any directories in the artifact's name", async () => {
  const { artifactFile, asked } = setup(null);
  await artifactFile.save("../../etc/passwd", bytes);
  assert.equal(asked[0].defaultPath, "/Users/r/Downloads/passwd");
});

test("a cancelled save writes nothing", async () => {
  const { artifactFile, writes } = setup(null);
  assert.equal(await artifactFile.save("shot.png", bytes), "");
  assert.deepEqual(writes, []);
});

test("MARASI_ARTIFACT_DIR saves under the artifact's name there without a dialog, for headless verification", async () => {
  const { artifactFile, writes, asked } = setup(null, { MARASI_ARTIFACT_DIR: "/tmp/artifacts" });
  assert.equal(await artifactFile.save("../shot.png", bytes), "/tmp/artifacts/shot.png");
  assert.deepEqual(asked, []);
  assert.equal(writes[0].path, "/tmp/artifacts/shot.png");
});

test("save refuses anything that isn't bytes", async () => {
  const { artifactFile, writes } = setup("/tmp/x");
  await assert.rejects(artifactFile.save("x", "text"), /bytes/);
  assert.deepEqual(writes, []);
});
