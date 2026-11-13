import { test } from "node:test";
import assert from "node:assert/strict";
import { scanOnAndroid } from "./androidScan.js";

// A window with the app's scanner, which answers with `detail`.
function fakeWindow(detail) {
  const target = new EventTarget();
  target.MarasiAndroid = {
    scanQr: () => queueMicrotask(() => target.dispatchEvent(new CustomEvent("marasi-qr", { detail }))),
  };
  return target;
}

test("a scanned code comes back as its text", async () => {
  assert.equal(await scanOnAndroid(fakeWindow({ text: '{"url":"http://10.0.0.5:9000"}' })), '{"url":"http://10.0.0.5:9000"}');
});

test("backing out of the scanner comes back as null", async () => {
  assert.equal(await scanOnAndroid(fakeWindow({ cancelled: true })), null);
});

test("without the app's scanner it fails as no-camera", async () => {
  await assert.rejects(scanOnAndroid(new EventTarget()), /no-camera/);
});
