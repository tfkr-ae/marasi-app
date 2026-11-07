// Download and Copy Certificate: the PEM comes from the service's
// GET /certificate and goes to Go's save dialog or the clipboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCertificateActions } from "./certificate.js";

const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

function setup({ saved = "/Users/r/Downloads/marasi-proxy.crt", certificate = { pem, subject: "Marasi" } } = {}) {
  const calls = [];
  const client = {
    get: async (path) => {
      calls.push(["GET", path]);
      if (certificate instanceof Error) throw certificate;
      return certificate;
    },
  };
  const actions = createCertificateActions({
    client,
    saveFileAs: async (...args) => (calls.push(["saveFileAs", ...args]), saved),
    copyCertToClipboard: async (text) => (calls.push(["copy", text]), true),
  });
  return { actions, calls };
}

test("download saves the service's PEM as marasi-proxy.crt", async () => {
  const { actions, calls } = setup();
  assert.equal(await actions.download(), "/Users/r/Downloads/marasi-proxy.crt");
  const [, title, name, filterName, pattern, content] = calls[1];
  assert.deepEqual(calls[0], ["GET", "/certificate"]);
  assert.deepEqual([title, name, filterName, pattern], ["Save Proxy Certificate", "marasi-proxy.crt", "Certificate Files (*.crt)", "*.crt"]);
  assert.equal(Buffer.from(content, "base64").toString("utf8"), pem);
});

test("a cancelled download resolves to empty", async () => {
  const { actions } = setup({ saved: "" });
  assert.equal(await actions.download(), "");
});

test("copy puts the service's PEM on the clipboard", async () => {
  const { actions, calls } = setup();
  assert.equal(await actions.copy(), true);
  assert.deepEqual(calls, [["GET", "/certificate"], ["copy", pem]]);
});

test("an unreachable service rejects without saving or copying", async () => {
  const { actions, calls } = setup({ certificate: new Error("GET /certificate: http_error: HTTP 500") });
  await assert.rejects(actions.download(), /http_error/);
  await assert.rejects(actions.copy(), /http_error/);
  assert.equal(calls.filter(([name]) => name !== "GET").length, 0);
});
