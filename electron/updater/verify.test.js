import assert from "node:assert/strict";
import { test } from "node:test";
import { createSigner } from "../testing/minisignSigner.js";
import { parsePublicKey, verifyChecksums } from "./verify.js";

// Made with aead.dev/minisign v0.3.0, the CLI the release workflows sign
// with: `minisign -G -W`, then `minisign -S -t "marasi-app v2-nightly test"`.
const publicKey = "RWTZ8kKcw/TbI0oBjiAYmVQY4v/ucRg2bNmb2jwwZuNCdYPY/6NAe9nH";
const otherKey = "RWROELBI75Zg8/WoTvsl8xfAiFXbFrDJo2kHP8njBTVbVNih7qVUuLzh";
const checksums = Buffer.from(`${"0".repeat(64)}  marasi-v2-linux.AppImage\n`);
const signature = Buffer.from(`untrusted comment: signature from minisign secret key
RUTZ8kKcw/TbI5DP4IQNeRzw4MwI2LSVuLxt3Monb2ZP1F5pV2IUvH0719eOv3OnbXLDtxOePCeZmPdLUjaGwWdtqoHV1nPsnQk=
trusted comment: marasi-app v2-nightly test
5sfoMqClRnJ9xGekA3NqV2xf+yZONzPsFIFfF8eR894/8mElKDLWLcB7v0Y6QsmF4LosIlhVXycYfmyg+Ho5Bg==
`);

test("checksums signed by the Marasi signing key give their sums by asset name", () => {
  assert.deepEqual(verifyChecksums(parsePublicKey(publicKey), checksums, signature), {
    "marasi-v2-linux.AppImage": "0".repeat(64),
  });
});

test("checksums signed by another key, or changed after signing, are refused", () => {
  const refused = (key, data, sig) => {
    assert.throws(() => verifyChecksums(parsePublicKey(key), data, sig), (error) => error.kind === "signature");
  };
  refused(otherKey, checksums, signature);
  refused(publicKey, Buffer.from(`${"1".repeat(64)}  marasi-v2-linux.AppImage\n`), signature);
  refused(publicKey, checksums, Buffer.from(String(signature).replace("v2-nightly test", "v2-nightly tesT")));
  refused(publicKey, checksums, Buffer.from("not a signature"));
});

test("a malformed public key is no key", () => {
  assert.equal(parsePublicKey(""), null);
  assert.throws(() => parsePublicKey("RWQ="));
});

test("the test signer makes signatures the verifier accepts", () => {
  const signer = createSigner();
  const data = Buffer.from(`${"a".repeat(64)}  *marasi-v2-mac.zip\nnot a line\n`);
  assert.deepEqual(verifyChecksums(parsePublicKey(signer.publicKey), data, signer.sign(data)), {
    "marasi-v2-mac.zip": "a".repeat(64),
  });
});
