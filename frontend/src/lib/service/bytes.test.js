import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBase64Bytes, decodeBase64Text, encodeBase64Text } from "./bytes.js";

test("decodeBase64Bytes preserves arbitrary binary bytes losslessly", () => {
  // PNG magic header + NUL + invalid UTF-8 bytes + gzip magic
  const original = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x1f, 0x8b, 0x08]);
  const b64 = Buffer.from(original).toString("base64");
  const decoded = decodeBase64Bytes(b64);
  assert.ok(decoded instanceof Uint8Array);
  assert.deepEqual([...decoded], [...original]);
});

test("decodeBase64Bytes returns null for empty or falsy inputs", () => {
  assert.equal(decodeBase64Bytes(""), null);
  assert.equal(decodeBase64Bytes(null), null);
  assert.equal(decodeBase64Bytes(undefined), null);
});

test("decodeBase64Text and encodeBase64Text round-trip UTF-8 text", () => {
  const sample = "HTTP/1.1 200 OK\r\n\r\ncafé — 日本語";
  const encoded = encodeBase64Text(sample);
  assert.equal(decodeBase64Text(encoded), sample);
  assert.equal(decodeBase64Text(""), "");
  assert.equal(decodeBase64Text(null), "");
});
