import assert from "node:assert/strict";
import { test } from "node:test";
import { createSigner } from "./testing/minisignSigner.js";
import { readBuildInfo } from "./buildInfo.js";

test("a checkout or local package is a development build with no channel or key", () => {
  const { build, signingKey, releaseSource } = readBuildInfo({ version: "2.0.0-dev" });
  assert.deepEqual(build, { Channel: "dev", Version: "2.0.0-dev" });
  assert.equal(signingKey, null);
  assert.equal(releaseSource, undefined);
});

test("a nightly carries the channel, version and signing key the workflow set", () => {
  const signer = createSigner();
  const pkg = {
    version: "2.0.0-dev",
    marasiBuild: { channel: "v2-nightly", version: "18.10.2026 (v2-nightly def5678)", signingPublicKey: signer.publicKey },
  };
  const { build, signingKey } = readBuildInfo(pkg);
  assert.deepEqual(build, { Channel: "v2-nightly", Version: "18.10.2026 (v2-nightly def5678)" });
  assert.ok(signingKey);
});

test("a malformed signing key is logged and leaves the build unable to install", () => {
  const lines = [];
  const { build, signingKey } = readBuildInfo(
    { version: "x", marasiBuild: { channel: "v2-nightly", version: "18.10.2026 (v2-nightly def5678)", signingPublicKey: "RWQ=" } },
    { warn: (line) => lines.push(line) },
  );
  assert.equal(build.Channel, "v2-nightly");
  assert.equal(signingKey, null);
  assert.match(lines[0], /malformed/);
});
