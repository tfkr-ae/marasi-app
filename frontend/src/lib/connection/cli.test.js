// How the Marasi CLI setup and Settings → Marasi CLI read Go's results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cliMissing, cliResultText, cliSourceLabel, shouldOfferCLISetup } from "./cli.js";

test("a connection that failed for want of the CLI asks for the CLI setup", () => {
  const error = "finding the Marasi CLI: cli_missing (): the Marasi CLI isn't installed";
  assert.equal(cliMissing(error), true);
  assert.equal(cliMissing("starting the local instance: instance_failed (): exit 1"), false);
  assert.equal(cliMissing(null), false);
});

test("the setup opens by itself once per missing-CLI failure", () => {
  const missing = { phase: "failed", error: "finding the Marasi CLI: cli_missing (): gone" };
  assert.equal(shouldOfferCLISetup(missing, false), true);
  assert.equal(shouldOfferCLISetup(missing, true), false);
  assert.equal(shouldOfferCLISetup({ phase: "connecting", error: null }, false), false);
  assert.equal(shouldOfferCLISetup({ phase: "failed", error: "instance_failed (): x" }, false), false);
});

test("each outcome reads as a short message", () => {
  assert.equal(cliResultText({ outcome: "installed", version: "06.11.2026" }), "Marasi CLI 06.11.2026 installed");
  assert.equal(cliResultText({ outcome: "up-to-date", version: "06.11.2026" }), "Marasi CLI is up to date");
  assert.equal(cliResultText({ outcome: "dev" }), "Development build, not updated");
  assert.equal(
    cliResultText({ outcome: "failed", failure: { kind: "no-build", reason: "No Marasi CLI build for this platform" } }),
    "No Marasi CLI build for this platform",
  );
});

test("where the CLI came from", () => {
  assert.equal(cliSourceLabel("custom"), "Custom path");
  assert.equal(cliSourceLabel("installed"), "Installed by Marasi");
  assert.equal(cliSourceLabel("path"), "PATH");
});
