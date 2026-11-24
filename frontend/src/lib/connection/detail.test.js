// Presentation helpers for the Connection details layout (ConnectionDetail.svelte).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextualSlotKind,
  detailWhereText,
  formatServiceNotes,
  restartConfirmCopy,
  serviceMetaText,
  serviceUpdateAction,
  serviceUpdateCheckToast,
  serviceUpdateProgress,
  setupDisclosure,
  stopConfirmCopy,
} from "./detail.js";

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

test("restartConfirmCopy explains active connections drop while the project reopens", () => {
  const remote = { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };
  const local = { id: "local", kind: "local", name: "Local", url: "" };

  assert.deepEqual(restartConfirmCopy(remote), {
    title: "Restart Lab?",
    detail: "Active connections will drop while the project reopens.",
  });
  assert.deepEqual(restartConfirmCopy(local), {
    title: "Restart Local?",
    detail: "Active connections will drop while the project reopens.",
  });
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

const connBase = {
  version: "20.11.2026",
  busy: null,
  restarting: false,
  restartConfirming: false,
  restartSupported: true,
  restartRequired: false,
  restartError: null,
  apiWarning: null,
};

const updBase = {
  supported: true,
  development: false,
  restartRequired: false,
  available: null,
  install: null,
  checking: false,
  startingInstall: false,
  cancelling: false,
  error: null,
};

test("serviceUpdateAction adapts the top bar primary button to state and hides controls on dev or unsupported services", () => {
  // Up to date -> neutral Check update
  assert.deepEqual(serviceUpdateAction(connBase, updBase), {
    kind: "check",
    label: "Check update",
    primary: false,
    disabled: false,
    spinning: false,
    hideNeutralRestart: false,
  });

  // Checking -> disabled neutral Checking…
  assert.deepEqual(serviceUpdateAction(connBase, { ...updBase, checking: true }), {
    kind: "check",
    label: "Checking…",
    primary: false,
    disabled: true,
    spinning: true,
    hideNeutralRestart: false,
  });

  // Available -> primary Update to <version>
  assert.deepEqual(
    serviceUpdateAction(connBase, {
      ...updBase,
      available: { version: "24.11.2026", channel: "release", notes: "", page: "" },
    }),
    {
      kind: "install",
      label: "Update to 24.11.2026",
      primary: true,
      disabled: false,
      spinning: false,
      hideNeutralRestart: false,
    },
  );

  // Installing -> disabled primary Updating…
  assert.deepEqual(
    serviceUpdateAction(connBase, {
      ...updBase,
      install: { state: "running", version: "24.11.2026", step: "download", received: 100, total: 1000 },
    }),
    {
      kind: "installing",
      label: "Updating…",
      primary: true,
      disabled: true,
      spinning: false,
      hideNeutralRestart: false,
    },
  );

  // Restart required -> primary Restart to apply, hiding duplicate neutral Restart
  assert.deepEqual(serviceUpdateAction(connBase, { ...updBase, restartRequired: true }), {
    kind: "restart",
    label: "Restart to apply",
    primary: true,
    disabled: false,
    spinning: false,
    hideNeutralRestart: true,
  });

  // Restart required from GET /service/status alone also switches to Restart to apply
  assert.deepEqual(serviceUpdateAction({ ...connBase, restartRequired: true }, updBase), {
    kind: "restart",
    label: "Restart to apply",
    primary: true,
    disabled: false,
    spinning: false,
    hideNeutralRestart: true,
  });

  // Unsupported or development build -> hidden (null)
  assert.equal(serviceUpdateAction(connBase, { ...updBase, supported: false }), null);
  assert.equal(serviceUpdateAction(connBase, { ...updBase, development: true }), null);
  assert.equal(serviceUpdateAction({ ...connBase, version: "dev" }, updBase), null);
});

test("serviceUpdateProgress tracks the 4-step bar and hides Cancel once swap/install begins", () => {
  const dl = serviceUpdateProgress(
    { ...updBase, install: { state: "running", version: "24.11.2026", step: "download", received: 420, total: 1000 } },
    "Lab",
  );
  assert.deepEqual(dl.steps, ["Download", "Verify", "Install", "Restart"]);
  assert.equal(dl.stepIndex, 0);
  assert.equal(dl.percent, 42);
  assert.equal(dl.cancellable, true);
  assert.equal(dl.heading, "Downloading on Lab… 42%");

  const verify = serviceUpdateProgress(
    { ...updBase, install: { state: "running", version: "24.11.2026", step: "verify", received: 1000, total: 1000 } },
    "Lab",
  );
  assert.equal(verify.stepIndex, 1);
  assert.equal(verify.percent, undefined);
  assert.equal(verify.cancellable, true);
  assert.equal(verify.heading, "Verifying signature and checksum…");

  const swap = serviceUpdateProgress(
    { ...updBase, install: { state: "running", version: "24.11.2026", step: "install", received: 1000, total: 1000 } },
    "Lab",
  );
  assert.equal(swap.stepIndex, 2);
  assert.equal(swap.percent, undefined);
  assert.equal(swap.cancellable, false);
  assert.equal(swap.heading, "Replacing executable on Lab…");

  const restart = serviceUpdateProgress(
    { ...updBase, restartRequired: true, install: { state: "installed", version: "24.11.2026" } },
    "Lab",
  );
  assert.equal(restart.stepIndex, 3);
  assert.equal(restart.cancellable, false);
  assert.equal(restart.heading, "Marasi 24.11.2026 installed on Lab");
});

test("contextualSlotKind enforces strict precedence (at most one card at a time)", () => {
  const baseArgs = {
    isActive: true,
    phase: "connected",
    connectionState: connBase,
    updateState: updBase,
    showRestartConfirm: false,
    showStopConfirm: false,
    isCLIMissing: false,
    isOutdated: false,
    stopErrorText: null,
  };

  // Idle and healthy -> null
  assert.equal(contextualSlotKind(baseArgs), null);

  // Available -> available
  const withAvail = {
    ...baseArgs,
    updateState: { ...updBase, available: { version: "24.11.2026", channel: "release", notes: "Hi", page: "" } },
  };
  assert.equal(contextualSlotKind(withAvail), "available");

  // Install error surfaces clearly even when available stays for retrying
  const withError = {
    ...withAvail,
    updateState: {
      ...withAvail.updateState,
      error: { code: "install_path_not_writable", message: "Permission denied", installPath: "/opt/marasi", page: "" },
    },
  };
  assert.equal(contextualSlotKind(withError), "install-error");

  // Restart required beats available and error
  const withRestartReq = {
    ...withError,
    updateState: { ...withError.updateState, restartRequired: true },
  };
  assert.equal(contextualSlotKind(withRestartReq), "restart-required");

  // Installing beats restartRequired, available, error
  const withInstalling = {
    ...withRestartReq,
    updateState: {
      ...withRestartReq.updateState,
      install: { state: "running", version: "24.11.2026", step: "download", received: 10, total: 100 },
    },
  };
  assert.equal(contextualSlotKind(withInstalling), "installing");

  // Confirmations beat everything (precedence 1)
  assert.equal(contextualSlotKind({ ...withInstalling, showStopConfirm: true }), "stop-confirm");
  assert.equal(contextualSlotKind({ ...withInstalling, showRestartConfirm: true, showStopConfirm: true }), "restart-confirm");

  // Dev / unsupported hides update contextual cards while keeping restartError usable
  assert.equal(
    contextualSlotKind({
      ...withAvail,
      updateState: { ...withAvail.updateState, development: true },
    }),
    null,
  );
  assert.equal(
    contextualSlotKind({
      ...withAvail,
      updateState: { ...withAvail.updateState, supported: false },
      connectionState: { ...connBase, restartError: "successor exited" },
    }),
    "restart-error",
  );
});

test("serviceUpdateCheckToast formats up-to-date notices and stays quiet for superseded or card-backed outcomes", () => {
  assert.deepEqual(serviceUpdateCheckToast({ ok: true, kind: "up-to-date", channel: "release" }, "Lab"), {
    message: "Lab is on the latest release build",
    background: "variant-filled-success",
  });
  assert.deepEqual(serviceUpdateCheckToast({ ok: true, kind: "up-to-date", channel: null }, "Lab"), {
    message: "Lab is up to date",
    background: "variant-filled-success",
  });
  assert.equal(serviceUpdateCheckToast({ ok: false, superseded: true }, "Lab"), null);
  assert.equal(serviceUpdateCheckToast({ ok: true, kind: "available" }, "Lab"), null);
  assert.equal(serviceUpdateCheckToast({ ok: false, kind: "error" }, "Lab"), null);
});

test("formatServiceNotes strips nightly metadata headers and keeps release notes verbatim", () => {
  assert.equal(
    formatServiceNotes({
      channel: "nightly",
      notes: "Ref: main\nCommit: abc1234\n- Fix proxy\n- Faster search\n",
    }),
    "- Fix proxy\n- Faster search",
  );
  assert.equal(
    formatServiceNotes({
      channel: "release",
      notes: "  Bug fixes and improvements  ",
    }),
    "Bug fixes and improvements",
  );
});
