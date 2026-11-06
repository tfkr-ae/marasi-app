// How a connection's phase reads in the rail tile, the Connections modal and
// Settings → Connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseLabel, phaseTone, statusHint, whereText } from "./status.js";

test("the dot is green when connected, amber on the way, red when it failed", () => {
  assert.equal(phaseTone("connected"), "bg-success-500");
  for (const phase of ["starting", "connecting", "reconnecting", "project-changed"]) {
    assert.equal(phaseTone(phase), "bg-warning-500", phase);
  }
  assert.equal(phaseTone("failed"), "bg-error-500");
  assert.equal(phaseTone("idle"), "bg-surface-400");
});

test("every phase has a label", () => {
  for (const phase of ["idle", "starting", "connecting", "connected", "reconnecting", "project-changed", "failed"]) {
    assert.equal(typeof phaseLabel(phase), "string", phase);
  }
  assert.equal(phaseLabel("reconnecting"), "Reconnecting");
  assert.equal(phaseLabel("failed"), "Couldn't connect");
});

test("the local connection is this machine and its instance", () => {
  assert.equal(whereText({ kind: "local" }, "default"), "This machine · instance default");
  assert.equal(whereText({ kind: "local" }, null), "This machine");
});

test("Settings' hint names the active connection and its status", () => {
  const state = { phase: "connected", connection: { name: "Local" } };
  assert.equal(statusHint(state), "Local · Connected");
});
