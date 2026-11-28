import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodeResponseBody, MAX_DECODED_BYTES } from "./decodeBody.js";

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test("decodeResponseBody decodes gzip, x-gzip, zlib deflate, raw deflate, br, and identity", async () => {
  const sample = enc("<!doctype html><html><body>Hello compressed world!</body></html>");

  const gz = new Uint8Array(zlib.gzipSync(sample));
  const resGz = await decodeResponseBody(gz, ["gzip"]);
  assert.equal(resGz.ok, true);
  assert.equal(dec(resGz.bytes), dec(sample));

  const resXGz = await decodeResponseBody(gz, ["x-gzip"]);
  assert.equal(resXGz.ok, true);
  assert.equal(dec(resXGz.bytes), dec(sample));

  const def = new Uint8Array(zlib.deflateSync(sample));
  const resDef = await decodeResponseBody(def, ["deflate"]);
  assert.equal(resDef.ok, true);
  assert.equal(dec(resDef.bytes), dec(sample));

  const rawDef = new Uint8Array(zlib.deflateRawSync(sample));
  const resRawDef = await decodeResponseBody(rawDef, ["deflate"]);
  assert.equal(resRawDef.ok, true);
  assert.equal(dec(resRawDef.bytes), dec(sample));

  const br = new Uint8Array(zlib.brotliCompressSync(sample));
  const resBr = await decodeResponseBody(br, ["br"]);
  assert.equal(resBr.ok, true);
  assert.equal(dec(resBr.bytes), dec(sample));

  const resId = await decodeResponseBody(sample, ["identity"]);
  assert.equal(resId.ok, true);
  assert.equal(dec(resId.bytes), dec(sample));
});

test("decodeResponseBody decodes zstd payloads", async () => {
  const sample = enc("Hello zstd response body! ".repeat(20));
  const zst = new Uint8Array(zlib.zstdCompressSync(sample));
  const res = await decodeResponseBody(zst, ["zstd"]);
  assert.equal(res.ok, true);
  assert.equal(dec(res.bytes), dec(sample));
});

test("decodeResponseBody unwraps chained encodings in reverse order (gzip then br)", async () => {
  const sample = enc("<p>Chained encoding payload</p>");
  const step1 = zlib.gzipSync(sample);
  const step2 = new Uint8Array(zlib.brotliCompressSync(step1));
  const res = await decodeResponseBody(step2, ["gzip", "br"]);
  assert.equal(res.ok, true);
  assert.equal(dec(res.bytes), dec(sample));
});

test("decodeResponseBody rejects decompression bombs exceeding maxBytes without throwing", async () => {
  const big = new Uint8Array(256 * 1024); // 256 KiB of zeros
  const cap = 64 * 1024;

  const gzBomb = new Uint8Array(zlib.gzipSync(big));
  const resGz = await decodeResponseBody(gzBomb, ["gzip"], { maxBytes: cap });
  assert.equal(resGz.ok, false);
  assert.equal(resGz.reason, "too-large");
  assert.equal(resGz.coding, "gzip");

  const brBomb = new Uint8Array(zlib.brotliCompressSync(big));
  const resBr = await decodeResponseBody(brBomb, ["br"], { maxBytes: cap });
  assert.equal(resBr.ok, false);
  assert.equal(resBr.reason, "too-large");
  assert.equal(resBr.coding, "br");

  const zstBomb = new Uint8Array(zlib.zstdCompressSync(big));
  const resZst = await decodeResponseBody(zstBomb, ["zstd"], { maxBytes: cap });
  assert.equal(resZst.ok, false);
  assert.equal(resZst.reason, "too-large");
  assert.equal(resZst.coding, "zstd");

  assert.equal(MAX_DECODED_BYTES, 10 * 1024 * 1024);
});

test("decodeResponseBody returns structured errors for corrupt streams and unknown encodings", async () => {
  const corruptByCoding = {
    gzip: Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]),
    deflate: Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]),
    // Truncated real brotli stream triggers a decode error
    br: new Uint8Array(zlib.brotliCompressSync(enc("hello brotli world ".repeat(40)))).subarray(0, 8),
    zstd: Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]),
  };
  for (const [coding, garbage] of Object.entries(corruptByCoding)) {
    const res = await decodeResponseBody(garbage, [coding]);
    assert.equal(res.ok, false, coding);
    assert.equal(res.reason, "corrupt", coding);
    assert.equal(res.coding, coding);
  }

  const unknown = await decodeResponseBody(enc("hello"), ["lzma"]);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unsupported-encoding");
  assert.equal(unknown.coding, "lzma");
});
