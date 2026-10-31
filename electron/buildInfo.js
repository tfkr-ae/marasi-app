// The running build, as v1's build_info.go: its channel, its version and the
// Marasi signing key it verifies updates with
// (docs/adr/2026-10-17-updates-are-signed-with-an-embedded-key.md). The
// build workflow sets them in package.json's marasiBuild before packaging,
// as v1's set them with -ldflags. A build without them is a development
// build: no channel, no key, so it never checks or installs.
import { parsePublicKey } from "./updater/verify.js";

/** {build: {Channel, Version}, signingKey} from the packaged package.json. */
export function readBuildInfo(pkg, log = console) {
  const { channel, version, signingPublicKey } = pkg.marasiBuild ?? {};
  const build = channel && version ? { Channel: channel, Version: version } : { Channel: "dev", Version: pkg.version };
  let signingKey = null;
  try {
    signingKey = parsePublicKey(signingPublicKey ?? "");
  } catch (error) {
    log.warn(`the Marasi signing key built into this app is malformed, so it cannot install updates: ${error.message}`);
  }
  return { build, signingKey };
}
