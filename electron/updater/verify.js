// Checking a release against the Marasi signing key built into the app
// (docs/adr/2026-10-17-updates-are-signed-with-an-embedded-key.md). A port
// of v1's update_verify.go, which used aead.dev/minisign: the release
// workflows sign checksums.txt with the minisign CLI, and this verifies the
// result with node:crypto's Ed25519.
import { createHash, createPublicKey, verify } from "node:crypto";
import { failed } from "./failure.js";

// The DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 key bytes follow.
const ed25519SPKI = Buffer.from("302a300506032b6570032100", "hex");

/**
 * The base64 public key line of minisign.pub as {id, key}, or null for ""
 * (a development build carries no key). A malformed key throws.
 */
export function parsePublicKey(text) {
  if (!text) return null;
  const raw = Buffer.from(text.trim(), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") {
    throw new Error("not a minisign public key");
  }
  return {
    id: raw.subarray(2, 10),
    key: createPublicKey({ key: Buffer.concat([ed25519SPKI, raw.subarray(10)]), format: "der", type: "spki" }),
  };
}

// Whether signature is minisign's signature of message by key: the
// signature line ("Ed" over the message, or "ED" over its BLAKE2b-512) and
// the global signature over it and the trusted comment.
function minisignVerify(key, message, signature) {
  const lines = String(signature).split(/\r?\n/);
  if (lines.length < 4 || !lines[2].startsWith("trusted comment: ")) return false;
  const sig = Buffer.from(lines[1], "base64");
  const global = Buffer.from(lines[3], "base64");
  if (sig.length !== 74 || global.length !== 64) return false;
  const algorithm = sig.subarray(0, 2).toString();
  if (!sig.subarray(2, 10).equals(key.id)) return false;
  let signed;
  if (algorithm === "ED") signed = createHash("blake2b512").update(message).digest();
  else if (algorithm === "Ed") signed = message;
  else return false;
  const ed = sig.subarray(10);
  const comment = Buffer.from(lines[2].slice("trusted comment: ".length));
  try {
    return verify(null, signed, key.key, ed) && verify(null, Buffer.concat([ed, comment]), key.key, global);
  } catch {
    return false;
  }
}

/**
 * Checks that signature is the signing key's signature over checksums, and
 * returns the sums it signs by asset name, as lowercase hex SHA-256.
 */
export function verifyChecksums(key, checksums, signature) {
  if (!minisignVerify(key, checksums, signature)) {
    throw failed("signature", "the release's checksums are not signed by the Marasi signing key");
  }
  return parseChecksums(checksums);
}

// sha256sum output: "<64 hex>  <name>" per line, "*<name>" in binary
// mode. Other lines are skipped.
function parseChecksums(checksums) {
  const sums = {};
  for (const line of String(checksums).split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2 || !/^[0-9a-fA-F]{64}$/.test(fields[0])) continue;
    sums[fields[1].replace(/^\*/, "")] = fields[0].toLowerCase();
  }
  return sums;
}
