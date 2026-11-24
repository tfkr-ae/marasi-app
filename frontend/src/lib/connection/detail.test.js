// Presentation helpers for the Connection details layout (ConnectionDetail.svelte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { detailWhereText, serviceMetaText, setupDisclosure, stopConfirmCopy } from "./detail.js";

test("detailWhereText formats host, instance, and OS for local and remote connections", () => {
  const local = { id: "local", kind: "local", name: "Local", url: "" };
  const addedLocal = { id: "local-work", kind: "local", name: "Work", url: "", instance: "work" };
  const remote = { id: "r1", kind: "remote", name: "Lab", url: "https://10.0.0.5:9000" };

  assert.equal(detailWhereText(local, { instance: "default", os: "darwin" }), "This machine · instance default · darwin");
  assert.equal(detailWhereText(local, { instance: "default", os: null }), "This machine · instance default");
  assert.equal(detailWhereText(local), "This machine");
  assert.equal(detailWhereText(addedLocal), "This machine · instance work");
  assert.equal(detailWhereText(remote, { instance: "lab", os: "linux" }), "10.0.0.5:9000 · instance lab · linux");
  assert.equal(detailWhereText(remote, { instance: "default", os: null }), "10.0.0.5:9000 · instance default");
  assert.equal(detailWhereText(remote), "10.0.0.5:9000");
});

test("serviceMetaText formats Marasi version, channel, and API level, handling dev and older services", () => {
  assert.equal(
    serviceMetaText({ version: "24.11.2026", channel: "release", api: 1 }),
    "Marasi 24.11.2026 (release) · API 1",
  );
  assert.equal(
    serviceMetaText({ version: "24.11.2026 (nightly abc1234)", channel: "nightly", api: 1 }),
    "Marasi 24.11.2026 (nightly abc1234) · API 1",
  );
  assert.equal(
    serviceMetaText({ version: "24.11.2026", channel: "nightly", api: 1 }),
    "Marasi 24.11.2026 (nightly) · API 1",
  );
  assert.equal(serviceMetaText({ version: "dev", channel: null, api: 1 }), "Marasi dev · API 1");
  assert.equal(serviceMetaText({ version: "20.10.2026", channel: null, api: null }), "Marasi 20.10.2026 · API none");
  assert.equal(serviceMetaText({ version: null, channel: "release", api: 1 }), null);
});

test("stopConfirmCopy names the connection cleanly without obtuse phrasing", () => {
  const remote = { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };
  const local = { id: "local", kind: "local", name: "Local", url: "" };

  const remoteCopy = stopConfirmCopy(remote);
  assert.equal(remoteCopy.title, "Stop Lab?");
  assert.equal(remoteCopy.detail, "You'll need to start it again on the remote host.");
  assert.equal(remoteCopy.detail.includes("Marasi and its proxy"), false);

  const localCopy = stopConfirmCopy(local);
  assert.equal(localCopy.title, "Stop Local?");
  assert.equal(localCopy.detail, "Another program started this instance.");
  assert.equal(localCopy.detail.includes("Marasi and its proxy"), false);
});

test("setupDisclosure picks the collapsed disclosure title and mono summary", () => {
  const local = { id: "local", kind: "local", name: "Local", url: "" };
  const remote = { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };

  assert.deepEqual(setupDisclosure(local, { channel: "release", version: "24.11.2026", mobile: false }), {
    title: "Channel, CLI path & quit behavior",
    summary: "release",
  });
  assert.deepEqual(setupDisclosure(local, { channel: null, version: "dev", mobile: false }), {
    title: "Channel, CLI path & quit behavior",
    summary: "dev",
  });
  assert.deepEqual(setupDisclosure(remote, { channel: "nightly", version: "24.11.2026 (nightly a1b2)", mobile: false }), {
    title: "Update channel & reinstall",
    summary: "nightly",
  });
  assert.deepEqual(setupDisclosure(remote, { channel: null, version: "20.10.2026", mobile: true }), {
    title: "Update channel & reinstall",
    summary: "",
  });
});
