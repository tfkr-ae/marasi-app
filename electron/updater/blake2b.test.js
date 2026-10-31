import assert from "node:assert/strict";
import { createHash, getHashes, randomBytes } from "node:crypto";
import { test } from "node:test";
import { blake2b512 } from "./blake2b.js";

test("BLAKE2b-512 of \"abc\" is RFC 7693's Appendix A digest", () => {
  assert.equal(
    blake2b512(Buffer.from("abc")).toString("hex"),
    "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
      "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
  );
});

// Electron's BoringSSL has no blake2b512, which is why this module exists.
const openSSL = getHashes().includes("blake2b512");

test("BLAKE2b-512 agrees with OpenSSL's on empty, block-sized and longer input", { skip: !openSSL && "no OpenSSL BLAKE2b" }, () => {
  for (const size of [0, 1, 127, 128, 129, 256, 1000, 65536]) {
    const data = randomBytes(size);
    assert.equal(blake2b512(data).toString("hex"), createHash("blake2b512").update(data).digest("hex"), `${size} bytes`);
  }
});
