// Pure decision helpers for desktop local carried-CLI upgrades, per-version
// dismissal persistence, channel-mismatch detection, and Install & restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCarriedCLI,
  isCarriedNewer,
  localChannelMismatch,
  proactiveCarriedUpgrade,
  readDismissedCarriedVersion,
  runCarriedInstall,
  writeDismissedCarriedVersion,
} from "./carried.js";
import { superseded } from "../service/errors.js";

test("isCarriedNewer orders release versions by DD.MM.YYYY and natural re-release suffix, never downgrading", () => {
  const carried = (version, channel = "release") => ({ available: true, version, channel });
  const cli = (version, channel = "release") => ({ found: true, version, channel });

  // Later calendar date (day, month, year boundaries)
  assert.equal(isCarriedNewer(carried("24.11.2026"), cli("20.11.2026")), true);
  assert.equal(isCarriedNewer(carried("01.12.2026"), cli("30.11.2026")), true);
  assert.equal(isCarriedNewer(carried("01.01.2027"), cli("31.12.2026")), true);

  // Same-day re-release suffixes in natural order: plain < -1 < -2 < -10
  assert.equal(isCarriedNewer(carried("24.11.2026-1"), cli("24.11.2026")), true);
  assert.equal(isCarriedNewer(carried("24.11.2026-2"), cli("24.11.2026-1")), true);
  assert.equal(isCarriedNewer(carried("24.11.2026-10"), cli("24.11.2026-2")), true);
  assert.equal(isCarriedNewer(carried("24.11.2026-rc10"), cli("24.11.2026-rc2")), true);

  // Equal or older (never downgrade)
  assert.equal(isCarriedNewer(carried("24.11.2026"), cli("24.11.2026")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026-2"), cli("24.11.2026-2")), false);
  assert.equal(isCarriedNewer(carried("20.11.2026"), cli("24.11.2026")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026"), cli("24.11.2026-1")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026-2"), cli("24.11.2026-10")), false);

  // Invalid / malformed release strings or impossible calendar dates
  assert.equal(isCarriedNewer(carried("31.02.2026"), cli("01.02.2026")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026-"), cli("24.11.2026")), false);
  assert.equal(isCarriedNewer(carried("v1.2.3"), cli("20.11.2026")), false);
});

test("isCarriedNewer orders nightly versions strictly by later date and distinct commit, rejecting same-commit, same-day, older, dev, and cross-channel", () => {
  const carried = (version, channel = "nightly") => ({ available: true, version, channel });
  const cli = (version, channel = "nightly") => ({ found: true, version, channel });

  // Later date with different commit -> strictly newer
  assert.equal(
    isCarriedNewer(carried("24.11.2026 (nightly bbbb222)"), cli("23.11.2026 (nightly aaaa111)")),
    true,
  );
  assert.equal(
    isCarriedNewer(carried("01.12.2026 (nightly 7d411bd0)"), cli("30.11.2026 (nightly 1a2b3c4d)")),
    true,
  );

  // Same commit (exact, case-insensitive, or short/full prefix) -> never an upgrade
  assert.equal(
    isCarriedNewer(carried("24.11.2026 (nightly aaaa111)"), cli("24.11.2026 (nightly aaaa111)")),
    false,
  );
  assert.equal(
    isCarriedNewer(carried("25.11.2026 (nightly AAAA111)"), cli("24.11.2026 (nightly aaaa111222333)")),
    false,
  );

  // Same day with different commit -> unorderable, never risk a same-day downgrade
  assert.equal(
    isCarriedNewer(carried("24.11.2026 (nightly bbbb222)"), cli("24.11.2026 (nightly aaaa111)")),
    false,
  );

  // Older date -> never downgrade
  assert.equal(
    isCarriedNewer(carried("22.11.2026 (nightly bbbb222)"), cli("23.11.2026 (nightly aaaa111)")),
    false,
  );

  // Cross-channel, dev builds, unavailable, or missing CLI -> false
  assert.equal(
    isCarriedNewer(carried("24.11.2026 (nightly bbbb222)", "nightly"), cli("20.11.2026", "release")),
    false,
  );
  assert.equal(
    isCarriedNewer(carried("24.11.2026", "release"), cli("20.11.2026 (nightly aaaa111)", "nightly")),
    false,
  );
  assert.equal(isCarriedNewer(carried("24.11.2026", "release"), cli("dev", "")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026", "release"), cli("dev", "release")), false);
  assert.equal(isCarriedNewer({ available: false, version: "24.11.2026", channel: "release" }, cli("20.11.2026", "release")), false);
  assert.equal(isCarriedNewer(carried("24.11.2026", "release"), { found: false }), false);
  assert.equal(isCarriedNewer(null, cli("20.11.2026", "release")), false);
});

const localConn = (overrides = {}) => ({
  phase: "connected",
  connection: { id: "local", kind: "local", name: "Local", url: "" },
  version: "20.11.2026",
  channel: "release",
  restarting: false,
  restartRequired: false,
  restartSupported: true,
  ...overrides,
});

const updState = (overrides = {}) => ({
  loaded: true,
  supported: true,
  development: false,
  channel: "release",
  restartRequired: false,
  ...overrides,
});

test("proactiveCarriedUpgrade triggers only on desktop local for a strictly newer same-channel non-dev carried CLI", () => {
  const base = {
    mobile: false,
    connectionState: localConn(),
    updateState: updState(),
    carried: { available: true, version: "24.11.2026", channel: "release" },
    cli: { found: true, path: "/usr/local/bin/marasi", source: "path", version: "20.11.2026", channel: "release" },
    dismissedVersion: null,
  };

  assert.deepEqual(proactiveCarriedUpgrade(base), { version: "24.11.2026", channel: "release" });

  // Works even when the older local service lacks /update (supported: false)
  assert.deepEqual(
    proactiveCarriedUpgrade({ ...base, updateState: updState({ supported: false, channel: null }) }),
    { version: "24.11.2026", channel: "release" },
  );

  // Suppressed on mobile
  assert.equal(proactiveCarriedUpgrade({ ...base, mobile: true }), null);

  // Suppressed immediately on remote connections
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ connection: { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" } }),
    }),
    null,
  );

  // Suppressed when not connected or restarting
  assert.equal(proactiveCarriedUpgrade({ ...base, connectionState: localConn({ phase: "stopped" }) }), null);
  assert.equal(proactiveCarriedUpgrade({ ...base, connectionState: localConn({ restarting: true }) }), null);

  // Suppressed when restartRequired is true on either store
  assert.equal(proactiveCarriedUpgrade({ ...base, connectionState: localConn({ restartRequired: true }) }), null);
  assert.equal(proactiveCarriedUpgrade({ ...base, updateState: updState({ restartRequired: true }) }), null);

  // Suppressed for dev service or dev local CLI
  assert.equal(proactiveCarriedUpgrade({ ...base, connectionState: localConn({ version: "dev" }) }), null);
  assert.equal(proactiveCarriedUpgrade({ ...base, updateState: updState({ development: true }) }), null);
  assert.equal(
    proactiveCarriedUpgrade({ ...base, cli: { ...base.cli, version: "dev", channel: "" } }),
    null,
  );

  // Suppressed when service configured channel switched away from carried channel
  assert.equal(proactiveCarriedUpgrade({ ...base, updateState: updState({ channel: "nightly" }) }), null);

  // Suppressed when dismissed for this exact carried version, resurfaces for a newer carried version
  assert.equal(proactiveCarriedUpgrade({ ...base, dismissedVersion: "24.11.2026" }), null);
  assert.deepEqual(
    proactiveCarriedUpgrade({
      ...base,
      carried: { available: true, version: "25.11.2026", channel: "release" },
      dismissedVersion: "24.11.2026",
    }),
    { version: "25.11.2026", channel: "release" },
  );

  // Suppressed when the active connected local service is already equal or newer,
  // even if LocateCLI still points to an older binary on PATH.
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "26.11.2026", channel: "release" }),
    }),
    null,
  );
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "24.11.2026", channel: "release" }),
    }),
    null,
  );
  // Same check for nightly: externally started newer nightly suppresses older carried nightly
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "26.11.2026 (nightly bbbb222)", channel: "nightly" }),
      updateState: updState({ channel: "nightly" }),
      carried: { available: true, version: "24.11.2026 (nightly cccc333)", channel: "nightly" },
      cli: { found: true, path: "/usr/local/bin/marasi", source: "path", version: "22.11.2026 (nightly aaaa111)", channel: "nightly" },
    }),
    null,
  );
  // Externally started running nightly binary never gets overwritten by a release carried CLI
  // even if updateState.channel was switched to release
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "24.11.2026 (nightly bbbb222)", channel: "nightly" }),
      updateState: updState({ channel: "release" }),
    }),
    null,
  );
  // Older service lacking channel in /service/status still compares active version safely
  assert.deepEqual(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "20.11.2026", channel: null }),
      updateState: updState({ supported: false, channel: null }),
    }),
    { version: "24.11.2026", channel: "release" },
  );
  assert.equal(
    proactiveCarriedUpgrade({
      ...base,
      connectionState: localConn({ version: "26.11.2026", channel: null }),
      updateState: updState({ supported: false, channel: null }),
    }),
    null,
  );
});

test("runCarriedInstall orchestrates install + toasts and routes thrown errors through toastError", async () => {
  // Success outcome
  {
    const toasts = [];
    const toastStore = { trigger: (t) => toasts.push(t) };
    const outcome = await runCarriedInstall({
      installCarried: async () => ({ ok: true, text: "Marasi CLI 24.11.2026 installed", method: "service" }),
      toastStore,
    });
    assert.equal(outcome?.ok, true);
    assert.deepEqual(toasts, [{ message: "Marasi CLI 24.11.2026 installed" }]);
  }

  // Failed outcome
  {
    const toasts = [];
    const toastStore = { trigger: (t) => toasts.push(t) };
    const outcome = await runCarriedInstall({
      installCarried: async () => ({ ok: false, text: "Checksum mismatch", method: "none" }),
      toastStore,
    });
    assert.equal(outcome?.ok, false);
    assert.deepEqual(toasts, [{ message: "Checksum mismatch", background: "variant-filled-error" }]);
  }

  // Thrown error uses toastError (prefixes context and hides superseded)
  {
    const toasts = [];
    const toastStore = { trigger: (t) => toasts.push(t) };
    await runCarriedInstall({
      installCarried: async () => {
        throw new Error("disk full");
      },
      toastStore,
    });
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].background, "variant-filled-error");
    assert.match(toasts[0].message, /Carried CLI install failed/);

    toasts.length = 0;
    await runCarriedInstall({
      installCarried: async () => {
        throw superseded("POST /service/restart");
      },
      toastStore,
    });
    assert.deepEqual(toasts, []);
  }
});

test("carried-CLI dismissal persists per version and degrades gracefully without storage", () => {
  const data = new Map();
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };

  assert.equal(readDismissedCarriedVersion(storage), null);
  writeDismissedCarriedVersion("24.11.2026", storage);
  assert.equal(readDismissedCarriedVersion(storage), "24.11.2026");

  // Newer version replaces dismissed marker
  writeDismissedCarriedVersion("25.11.2026", storage);
  assert.equal(readDismissedCarriedVersion(storage), "25.11.2026");

  // Clearing removes key
  writeDismissedCarriedVersion(null, storage);
  assert.equal(readDismissedCarriedVersion(storage), null);

  // Missing or throwing storage never throws
  assert.equal(readDismissedCarriedVersion(null), null);
  assert.doesNotThrow(() => writeDismissedCarriedVersion("24.11.2026", null));
  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.equal(readDismissedCarriedVersion(broken), null);
  assert.doesNotThrow(() => writeDismissedCarriedVersion("24.11.2026", broken));
});

test("localChannelMismatch detects desktop app vs connected non-dev local service channel mismatch only", () => {
  const base = {
    mobile: false,
    connectionState: localConn({ channel: "release" }),
    updateState: updState({ loaded: true, channel: "release" }),
    appChannel: "nightly",
  };

  assert.deepEqual(localChannelMismatch(base), { appChannel: "nightly", serviceChannel: "release" });
  assert.deepEqual(
    localChannelMismatch({
      ...base,
      appChannel: "release",
      connectionState: localConn({ channel: "nightly" }),
      updateState: updState({ loaded: true, channel: "nightly" }),
    }),
    { appChannel: "release", serviceChannel: "nightly" },
  );

  // Uses configured updateState.channel over running connectionState.channel once loaded
  assert.equal(
    localChannelMismatch({
      ...base,
      appChannel: "nightly",
      connectionState: localConn({ channel: "release" }),
      updateState: updState({ loaded: true, channel: "nightly" }),
    }),
    null,
  );

  // Suppressed when channels match
  assert.equal(localChannelMismatch({ ...base, appChannel: "release" }), null);

  // Suppressed on mobile, remote, disconnected, dev app, dev service, or unsupported/unloaded /update
  assert.equal(localChannelMismatch({ ...base, mobile: true }), null);
  assert.equal(
    localChannelMismatch({
      ...base,
      connectionState: localConn({ connection: { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" } }),
    }),
    null,
  );
  assert.equal(localChannelMismatch({ ...base, connectionState: localConn({ phase: "stopped" }) }), null);
  assert.equal(localChannelMismatch({ ...base, appChannel: "" }), null);
  assert.equal(localChannelMismatch({ ...base, appChannel: "dev" }), null);
  assert.equal(localChannelMismatch({ ...base, connectionState: localConn({ version: "dev" }) }), null);
  assert.equal(localChannelMismatch({ ...base, updateState: updState({ development: true }) }), null);
  assert.equal(localChannelMismatch({ ...base, updateState: updState({ supported: false }) }), null);
  assert.equal(localChannelMismatch({ ...base, updateState: updState({ loaded: false }) }), null);
});

test("applyCarriedCLI installs offline, refreshes local CLI state, and uses POST /service/restart when connected & supported or falls back to RestartLocalInstance", async () => {
  // 1. Connected local service with restartSupported -> uses service restart flow
  {
    const calls = [];
    const newCLI = { found: true, path: "/usr/local/bin/marasi", source: "path", version: "24.11.2026", channel: "release" };
    const outcome = await applyCarriedCLI({
      installCarried: async () => {
        calls.push("install");
        return { outcome: "installed", version: "24.11.2026", channel: "release", cli: newCLI };
      },
      refreshCLI: async (cli) => calls.push(["refresh", cli?.version]),
      connectionState: localConn({ phase: "connected", restartSupported: true }),
      connectionId: "local",
      isActive: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["install", ["refresh", "24.11.2026"], "restart-service"]);
    assert.deepEqual(outcome, { ok: true, text: "Marasi CLI 24.11.2026 installed from app", method: "service" });
  }

  // 1b. Reinstalling same version from carried CLI reports "reinstalled from app"
  {
    const calls = [];
    const sameCLI = { found: true, path: "/usr/local/bin/marasi", source: "path", version: "24.11.2026", channel: "release" };
    const outcome = await applyCarriedCLI({
      installCarried: async () => {
        calls.push("install");
        return { outcome: "installed", version: "24.11.2026", channel: "release", cli: sameCLI };
      },
      refreshCLI: async (cli) => calls.push(["refresh", cli?.version]),
      connectionState: localConn({ phase: "connected", restartSupported: true }),
      connectionId: "local",
      isActive: true,
      reinstall: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["install", ["refresh", "24.11.2026"], "restart-service"]);
    assert.deepEqual(outcome, { ok: true, text: "Marasi CLI 24.11.2026 reinstalled from app", method: "service" });
  }

  // 2. Connected local service without /service/restart support -> falls back to RestartLocalInstance + retryNow
  {
    const calls = [];
    const outcome = await applyCarriedCLI({
      installCarried: async () => {
        calls.push("install");
        return { outcome: "installed", version: "24.11.2026", channel: "release", cli: { found: true, version: "24.11.2026" } };
      },
      refreshCLI: async () => calls.push("refresh"),
      connectionState: localConn({ phase: "connected", restartSupported: false }),
      connectionId: "local",
      isActive: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["install", "refresh", ["restart-local", "local"], "retry"]);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.method, "local");
  }

  // 3. Disconnected/failed local connection -> falls back to RestartLocalInstance + retry
  {
    const calls = [];
    const outcome = await applyCarriedCLI({
      installCarried: async () => ({ outcome: "installed", version: "24.11.2026", cli: { found: true, version: "24.11.2026" } }),
      refreshCLI: async () => calls.push("refresh"),
      connectionState: localConn({ phase: "failed" }),
      connectionId: "local",
      isActive: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["refresh", ["restart-local", "local"], "retry"]);
    assert.equal(outcome.method, "local");
  }

  // 4. Stopped local connection -> installs without restarting
  {
    const calls = [];
    const outcome = await applyCarriedCLI({
      installCarried: async () => ({ outcome: "installed", version: "24.11.2026", cli: { found: true, version: "24.11.2026" } }),
      refreshCLI: async () => calls.push("refresh"),
      connectionState: localConn({ phase: "stopped" }),
      connectionId: "local",
      isActive: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["refresh"]);
    assert.equal(outcome.method, "none");
  }

  // 5. Inactive running local connection -> restarts via RestartLocalInstance
  {
    const calls = [];
    const outcome = await applyCarriedCLI({
      installCarried: async () => ({ outcome: "installed", version: "24.11.2026", cli: { found: true, version: "24.11.2026" } }),
      refreshCLI: async () => calls.push("refresh"),
      connectionState: localConn({ phase: "connected" }),
      connectionId: "local-work",
      isActive: false,
      instanceRunning: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async (id) => calls.push(["restart-local", id]),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, ["refresh", ["restart-local", "local-work"]]);
    assert.equal(outcome.method, "local");
  }

  // 6. Failed install -> refreshes nothing and restarts nothing
  {
    const calls = [];
    const outcome = await applyCarriedCLI({
      installCarried: async () => ({ outcome: "failed", failure: { kind: "checksum", reason: "Checksum mismatch" } }),
      refreshCLI: async () => calls.push("refresh"),
      connectionState: localConn({ phase: "connected", restartSupported: true }),
      connectionId: "local",
      isActive: true,
      restartService: () => calls.push("restart-service"),
      restartLocal: async () => calls.push("restart-local"),
      retryConnection: () => calls.push("retry"),
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(outcome, { ok: false, text: "Checksum mismatch", method: "none" });
  }
});


