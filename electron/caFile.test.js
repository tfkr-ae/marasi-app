import { test } from "node:test";
import assert from "node:assert/strict";
import { createCAFile, maxCAFileSize } from "./caFile.js";

// A fake fs holding `files` by path, and an open dialog that answers `chosen`.
function setup(chosen, { files = {}, env = {} } = {}) {
  const asked = [];
  const caFile = createCAFile({
    fs: {
      readFile: async (path) => {
        if (!(path in files)) throw new Error(`ENOENT: ${path}`);
        return Buffer.from(files[path]);
      },
      stat: async (path) => {
        if (!(path in files)) throw new Error(`ENOENT: ${path}`);
        return { size: Buffer.byteLength(files[path]) };
      },
    },
    dialog: { open: async (options) => (asked.push(options), chosen) },
    env,
  });
  return { caFile, asked };
}

test("read answers the text of the CA file the researcher picks, as v1 did", async () => {
  const { caFile, asked } = setup("/Users/r/corp.pem", { files: { "/Users/r/corp.pem": "PEM" } });
  assert.equal(await caFile.read(), "PEM");
  assert.equal(asked[0].title, "Choose a CA Certificate");
  assert.deepEqual(asked[0].filters[0].extensions, ["pem", "crt", "cer"]);
});

test("a cancelled pick answers nothing", async () => {
  const { caFile } = setup(null);
  assert.equal(await caFile.read(), "");
});

test("MARASI_UPSTREAM_PROXY_CA_FILE reads without a dialog, for headless verification", async () => {
  const { caFile, asked } = setup(null, {
    files: { "/tmp/ca.pem": "PEM" },
    env: { MARASI_UPSTREAM_PROXY_CA_FILE: "/tmp/ca.pem" },
  });
  assert.equal(await caFile.read(), "PEM");
  assert.deepEqual(asked, []);
});

test("a file over 1 MiB is refused unread", async () => {
  const { caFile } = setup("/Users/r/big.pem", { files: { "/Users/r/big.pem": "x".repeat(maxCAFileSize + 1) } });
  await assert.rejects(caFile.read(), /big\.pem is too large for a CA certificate/);
});
