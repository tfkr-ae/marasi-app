// A throwaway minisign key for tests: signs as `minisign -S` does (the
// prehashed "ED" algorithm), with a fresh Ed25519 key each time.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { blake2b512 } from "../updater/blake2b.js";

export function createSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "jwk" });
  const keyId = randomBytes(8);
  const keyBytes = Buffer.from(raw.x, "base64url");
  return {
    publicKey: Buffer.concat([Buffer.from("Ed"), keyId, keyBytes]).toString("base64"),
    sign(data, trustedComment = "marasi-app test") {
      const hashed = blake2b512(data);
      const signature = sign(null, hashed, privateKey);
      const global = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey);
      return Buffer.from(
        "untrusted comment: test signature\n" +
          `${Buffer.concat([Buffer.from("ED"), keyId, signature]).toString("base64")}\n` +
          `trusted comment: ${trustedComment}\n` +
          `${global.toString("base64")}\n`,
      );
    },
  };
}
