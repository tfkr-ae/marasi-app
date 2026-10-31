import { test } from "node:test";
import assert from "node:assert/strict";
import { createCertificateFile } from "./certificateFile.js";

// A fake fs that records writes, and a save dialog that answers `chosen`.
function setup(chosen, env = {}) {
  const writes = [];
  const asked = [];
  const certificateFile = createCertificateFile({
    fs: { writeFile: async (path, contents, options) => writes.push({ path, contents, options }) },
    dialog: { save: async (options) => (asked.push(options), chosen) },
    env,
    home: "/Users/r",
  });
  return { certificateFile, writes, asked };
}

test("save writes the certificate where the researcher chose, as v1 did", async () => {
  const { certificateFile, writes, asked } = setup("/Users/r/Downloads/marasi-proxy.crt");
  assert.equal(await certificateFile.save("PEM"), "/Users/r/Downloads/marasi-proxy.crt");
  assert.equal(asked[0].title, "Save Proxy Certificate");
  assert.equal(asked[0].defaultPath, "/Users/r/Downloads/marasi-proxy.crt");
  assert.deepEqual(writes, [{ path: "/Users/r/Downloads/marasi-proxy.crt", contents: "PEM", options: { mode: 0o600 } }]);
});

test("a cancelled save writes nothing", async () => {
  const { certificateFile, writes } = setup(null);
  assert.equal(await certificateFile.save("PEM"), "");
  assert.deepEqual(writes, []);
});

test("MARASI_CERTIFICATE_FILE saves without a dialog, for headless verification", async () => {
  const { certificateFile, writes, asked } = setup(null, { MARASI_CERTIFICATE_FILE: "/tmp/cert.crt" });
  assert.equal(await certificateFile.save("PEM"), "/tmp/cert.crt");
  assert.deepEqual(asked, []);
  assert.equal(writes[0].path, "/tmp/cert.crt");
});

test("save refuses anything that isn't a certificate's text", async () => {
  const { certificateFile, writes } = setup("/tmp/x");
  await assert.rejects(certificateFile.save(42), /certificate/);
  assert.deepEqual(writes, []);
});
