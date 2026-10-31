import { test } from "node:test";
import assert from "node:assert/strict";
import { createKeybindingFiles } from "./keybindingFiles.js";
import { memoryFS } from "./testing/memoryFS.js";

function setup({ choose = null, env = {}, files = {} } = {}) {
  const fs = memoryFS(files);
  const asked = [];
  const dialog = {
    async save(options) {
      asked.push(["save", options]);
      return choose;
    },
    async open(options) {
      asked.push(["open", options]);
      return choose;
    },
  };
  return { fs, asked, files: createKeybindingFiles({ fs, dialog, env, home: "/Users/r" }) };
}

test("export writes the profile where the researcher chose, suggesting Downloads", async () => {
  const { fs, asked, files } = setup({ choose: "/tmp/mine.json" });
  assert.equal(await files.exportProfile("../mine.json", "{}"), "/tmp/mine.json");
  assert.equal(fs.files.get("/tmp/mine.json"), "{}");
  assert.equal(asked[0][1].defaultPath, "/Users/r/Downloads/mine.json");
});

test("a cancelled dialog writes and reads nothing", async () => {
  const { fs, files } = setup();
  assert.equal(await files.exportProfile("mine.json", "{}"), "");
  assert.deepEqual(await files.importProfile(), { path: "", contents: "" });
  assert.equal(fs.files.size, 0);
});

test("import returns the chosen file's text unparsed", async () => {
  const { files } = setup({ choose: "/tmp/in.json", files: { "/tmp/in.json": "not json" } });
  assert.deepEqual(await files.importProfile(), { path: "/tmp/in.json", contents: "not json" });
});

test("a file over 1 MiB is refused", async () => {
  const { files } = setup({ choose: "/tmp/big.json", files: { "/tmp/big.json": "x".repeat((1 << 20) + 1) } });
  await assert.rejects(files.importProfile(), /big.json is too large/);
});

test("MARASI_KEYBINDINGS_PROFILE_FILE stands in for the dialog, for tests and verification", async () => {
  const { fs, asked, files } = setup({ env: { MARASI_KEYBINDINGS_PROFILE_FILE: "/tmp/fixed.json" } });
  await files.exportProfile("mine.json", "{\"a\":1}");
  assert.deepEqual(await files.importProfile(), { path: "/tmp/fixed.json", contents: "{\"a\":1}" });
  assert.equal(asked.length, 0);
  assert.equal(fs.modes.get("/tmp/fixed.json"), 0o600);
});
