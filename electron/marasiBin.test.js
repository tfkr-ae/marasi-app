import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarasiChoice } from "./marasiBin.js";

const file = "/user-data/marasi.json";
const bundled = "/app/resources/bin/marasi";

// A fake filesystem holding `files` by path.
function fakeFiles(files = {}) {
  return {
    files,
    readFile: async (path) => {
      if (!(path in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[path];
    },
    writeFile: async (path, text) => {
      files[path] = text;
    },
  };
}

test("Start runs the bundled Marasi until the researcher chooses one", async () => {
  const fs = fakeFiles();
  const choice = await createMarasiChoice({ file, bundled, ...fs });
  assert.equal(choice.bin(), bundled);
  assert.deepEqual(choice.shown(), { path: null, bundled });
});

test("a chosen Marasi is used and kept across restarts, until it is cleared", async () => {
  const fs = fakeFiles();
  const choice = await createMarasiChoice({ file, bundled, ...fs });
  await choice.choose("/opt/marasi-dev/marasi");
  assert.equal(choice.bin(), "/opt/marasi-dev/marasi");

  const restarted = await createMarasiChoice({ file, bundled, ...fs });
  assert.equal(restarted.bin(), "/opt/marasi-dev/marasi");
  await restarted.choose(null);
  assert.equal(restarted.bin(), bundled);
  assert.equal((await createMarasiChoice({ file, bundled, ...fs })).bin(), bundled);
});

test("an unreadable choice file falls back to the bundled Marasi", async () => {
  const fs = fakeFiles({ [file]: "not json" });
  const choice = await createMarasiChoice({ file, bundled, ...fs });
  assert.equal(choice.bin(), bundled);
});
