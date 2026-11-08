// How a connection's phase reads in the rail tile, the Connections modal and
// Settings → Connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filePickerShown,
  pagesHeld,
  phaseLabel,
  phaseTone,
  reachingText,
  removeBlock,
  startupOffersConnections,
  startupText,
  statusHint,
  whereText,
} from "./status.js";

test("the dot is green when connected, amber on the way, red when it failed", () => {
  assert.equal(phaseTone("connected"), "bg-success-500");
  for (const phase of ["starting", "connecting", "reconnecting", "project-changed"]) {
    assert.equal(phaseTone(phase), "bg-warning-500", phase);
  }
  assert.equal(phaseTone("failed"), "bg-error-500");
  assert.equal(phaseTone("auth-failed"), "bg-error-500");
  assert.equal(phaseTone("idle"), "bg-surface-400");
});

test("every phase has a label", () => {
  for (const phase of ["idle", "starting", "connecting", "connected", "reconnecting", "project-changed", "failed"]) {
    assert.equal(typeof phaseLabel(phase), "string", phase);
  }
  assert.equal(phaseLabel("reconnecting"), "Reconnecting");
  assert.equal(phaseLabel("failed"), "Couldn't connect");
  assert.equal(phaseLabel("auth-failed"), "Password refused");
});

test("the local connection is this machine and its instance", () => {
  assert.equal(whereText({ kind: "local" }, "default"), "This machine · instance default");
  assert.equal(whereText({ kind: "local" }, null), "This machine");
});

test("Settings' hint names the active connection and its status", () => {
  const state = { phase: "connected", connection: { name: "Local" } };
  assert.equal(statusHint(state), "Local · Connected");
});

test("a remote is its address", () => {
  assert.equal(whereText({ kind: "remote", url: "http://10.0.0.5:9000" }, "default"), "10.0.0.5:9000");
});

test("the native file picker shows only on the local connection", () => {
  assert.equal(filePickerShown({ kind: "local" }), true);
  assert.equal(filePickerShown({ kind: "remote", url: "http://10.0.0.5:9000" }), false);
});

test("a stopped connection reads Stopped, with a grey dot", () => {
  assert.equal(phaseLabel("stopped"), "Stopped");
  assert.equal(phaseTone("stopped"), "bg-surface-400");
});

test("the pages are held, dimmed and inert, while another project waits or Marasi is stopped", () => {
  assert.equal(pagesHeld("project-changed"), true);
  assert.equal(pagesHeld("stopped"), true);
  for (const phase of ["connected", "reconnecting", "starting", "failed"]) assert.equal(pagesHeld(phase), false, phase);
});

test("the start screen names the remote it's reaching", () => {
  const office = { id: "r1", kind: "remote", name: "Office", url: "http://10.0.0.5:9000" };
  assert.equal(startupText({ phase: "connecting", connection: office }), "Connecting to Office…");
  assert.equal(startupText({ phase: "failed", connection: office }), "Couldn't reach Office");
});

test("the start screen reads as before on Local", () => {
  const local = { id: "local", kind: "local", name: "Local" };
  assert.equal(startupText({ phase: "idle", connection: local }), "Starting…");
  assert.equal(startupText({ phase: "starting", connection: local }), "Starting Marasi…");
  assert.equal(startupText({ phase: "connecting", connection: local }), "Connecting to Marasi…");
  assert.equal(startupText({ phase: "connected", connection: local }), "Loading project…");
  assert.equal(startupText({ phase: "failed", connection: local }), "Couldn't reach Marasi");
  assert.equal(startupText({ phase: "auth-failed", connection: local }), "Password refused");
});

test("the start screen names a named local connection other than Local", () => {
  const work = { id: "local-abc", kind: "local", name: "Work", instance: "work" };
  assert.equal(startupText({ phase: "starting", connection: work }), "Connecting to Work…");
  assert.equal(startupText({ phase: "connecting", connection: work }), "Connecting to Work…");
  assert.equal(startupText({ phase: "failed", connection: work }), "Couldn't reach Work");
});

test("the start screen offers Connections… until it reaches the service, and after it fails", () => {
  for (const phase of ["starting", "connecting", "failed", "auth-failed"]) {
    assert.equal(startupOffersConnections(phase), true, phase);
  }
  for (const phase of ["idle", "connected"]) {
    assert.equal(startupOffersConnections(phase), false, phase);
  }
});

test("the switch banner reads as the start screen while it reaches the connection", () => {
  const work = { id: "local-abc", kind: "local", name: "Work", instance: "work" };
  const local = { id: "local", kind: "local", name: "Local" };
  assert.equal(reachingText({ phase: "starting", connection: work }), "Connecting to Work…");
  assert.equal(reachingText({ phase: "starting", connection: local }), "Starting Marasi…");
  assert.equal(reachingText({ phase: "connecting", connection: local }), "Connecting to Marasi…");
  assert.equal(reachingText({ phase: "connected", connection: local }), null);
});

test("Remove waits for a switch away, then for a stop of the run the app owns", () => {
  assert.equal(removeBlock({ isActive: true, ownedRun: false }), "Switch away first");
  assert.equal(removeBlock({ isActive: true, ownedRun: true }), "Switch away first");
  assert.equal(removeBlock({ isActive: false, ownedRun: true }), "Stop it first");
  assert.equal(removeBlock({ isActive: false, ownedRun: false }), null);
});
