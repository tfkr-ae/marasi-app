// How the Marasi CLI setup and Settings → Marasi CLI read Go's results.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cliMissing,
  cliProgressPercent,
  cliProgressText,
  cliResultText,
  cliSourceLabel,
  outdatedVersion,
  shouldOfferCLISetup,
} from "./cli.js";

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

test("an install reads as its step while it runs", () => {
  assert.equal(cliProgressText(null), "Downloading…");
  assert.equal(cliProgressText({ step: "download", received: 10, total: 100 }), "Downloading…");
  assert.equal(cliProgressText({ step: "verify", received: 0, total: 0 }), "Verifying…");
  assert.equal(cliProgressText({ step: "install", received: 0, total: 0 }), "Installing…");
});

test("the download's bar fills by bytes, and is indeterminate without a size", () => {
  assert.equal(cliProgressPercent({ step: "download", received: 25, total: 100 }), 25);
  assert.equal(cliProgressPercent({ step: "download", received: 100, total: 100 }), 100);
  assert.equal(cliProgressPercent({ step: "download", received: 5, total: 0 }), undefined);
  assert.equal(cliProgressPercent(null), undefined);
  assert.equal(cliProgressPercent({ step: "verify", received: 0, total: 0 }), undefined);
});

test("an outdated local instance names the version it runs", () => {
  const error =
    "reading the local instance's address: instance_outdated (): Marasi v2-backlog-3a55b06 (dev) is running, older than this app needs: reading pairing: 404 Not Found";
  assert.equal(outdatedVersion(error), "v2-backlog-3a55b06 (dev)");
  assert.equal(outdatedVersion("reading the local instance's address: instance_failed (): reading pairing: refused"), null);
  assert.equal(outdatedVersion(null), null);
});
