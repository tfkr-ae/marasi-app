// Desktop local Marasi CLI store: LocateCLI, CarriedCLI, BuildInfo,
// per-version dismissal persistence, path changes, Install & restart, and
// refreshing located CLI when a local connection connects or restarts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, writable } from "svelte/store";
import { createLocalCLIStore, followLocalConnection } from "./createLocalCLIStore.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test("createLocalCLIStore loads CLI info, carried CLI, build channel, and persists per-version dismissal across instances", async () => {
  const storage = memoryStorage();
  const api = {
    locateCLI: async () => ({ found: true, path: "/usr/local/bin/marasi", source: "path", version: "20.11.2026", channel: "release", problem: "" }),
    carriedCLI: async () => ({ available: true, version: "24.11.2026", channel: "release" }),
    getBuildInfo: async () => ({ Channel: "release", Version: "24.11.2026" }),
  };

  const store = createLocalCLIStore(api, storage);
  await store.load();

  assert.equal(get(store).loaded, true);
  assert.equal(get(store).cli?.version, "20.11.2026");
  assert.equal(get(store).carried?.version, "24.11.2026");
  assert.equal(get(store).appChannel, "release");
  assert.equal(get(store).dismissedVersion, null);

  // Dismissing persists to storage and survives a fresh store (next app launch)
  store.dismissCarried("24.11.2026");
  assert.equal(get(store).dismissedVersion, "24.11.2026");

  const nextLaunch = createLocalCLIStore(api, storage);
  assert.equal(get(nextLaunch).dismissedVersion, "24.11.2026");
});

test("createLocalCLIStore changes and resets local CLI path via BrowseCLIPath/UseCLIPath/ClearCLIPath", async () => {
  const calls = [];
  const api = {
    locateCLI: async () => ({ found: true, path: "/usr/local/bin/marasi", source: "path", version: "20.11.2026", channel: "release" }),
    carriedCLI: async () => ({ available: false }),
    getBuildInfo: async () => ({ Channel: "release" }),
    browseCLIPath: async () => {
      calls.push("browse");
      return "/opt/marasi/marasi";
    },
    useCLIPath: async (p) => {
      calls.push(["use", p]);
      return { found: true, path: p, source: "custom", version: "21.11.2026", channel: "release" };
    },
    clearCLIPath: async () => {
      calls.push("clear");
      return { found: true, path: "/usr/local/bin/marasi", source: "path", version: "20.11.2026", channel: "release" };
    },
  };

  const store = createLocalCLIStore(api, memoryStorage());
  await store.load();

  await store.browseAndUsePath();
  assert.deepEqual(calls, ["browse", ["use", "/opt/marasi/marasi"]]);
  assert.equal(get(store).cli?.source, "custom");
  assert.equal(get(store).cli?.path, "/opt/marasi/marasi");

  await store.clearPath();
  assert.deepEqual(calls, ["browse", ["use", "/opt/marasi/marasi"], "clear"]);
  assert.equal(get(store).cli?.source, "path");
  assert.equal(get(store).changingPath, false);
});

test("createLocalCLIStore installCarried updates located CLI and delegates restart, and followLocalConnection refreshes CLI on local run changes only", async () => {
  let locateCalls = 0;
  let currentVersion = "20.11.2026";
  const calls = [];
  const api = {
    locateCLI: async () => {
      locateCalls++;
      return { found: true, path: "/usr/local/bin/marasi", source: "path", version: currentVersion, channel: "release" };
    },
    carriedCLI: async () => ({ available: true, version: "24.11.2026", channel: "release" }),
    getBuildInfo: async () => ({ Channel: "release" }),
    installCarriedCLI: async () => {
      currentVersion = "24.11.2026";
      return {
        outcome: "installed",
        version: "24.11.2026",
        channel: "release",
        cli: { found: true, path: "/usr/local/bin/marasi", source: "path", version: "24.11.2026", channel: "release" },
      };
    },
    restartLocalInstance: async (id) => calls.push(["restart-local", id]),
  };

  const store = createLocalCLIStore(api, memoryStorage());
  await store.load();
  assert.equal(locateCalls, 1);

  const conn = writable({
    phase: "connected",
    connection: { id: "local", kind: "local", name: "Local", url: "" },
    runId: "run-1",
    restartSupported: true,
  });

  const stop = followLocalConnection(conn, store, { isMobile: () => false });
  // Switching to a remote does NOT re-probe the local CLI
  const beforeRemote = locateCalls;
  conn.set({
    phase: "connected",
    connection: { id: "r1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" },
    runId: "r-run-1",
    restartSupported: true,
  });
  assert.equal(locateCalls, beforeRemote);

  // Returning to local (or a new local runId after a service update restart) refreshes LocateCLI
  conn.set({
    phase: "connected",
    connection: { id: "local", kind: "local", name: "Local", url: "" },
    runId: "run-2",
    restartSupported: true,
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(locateCalls, beforeRemote + 1);
  stop();

  // installCarried updates cli immediately and triggers service restart
  const outcome = await store.installCarried({
    connectionState: get(conn),
    connectionId: "local",
    isActive: true,
    restartService: () => calls.push("restart-service"),
    retryConnection: () => calls.push("retry"),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.method, "service");
  assert.equal(get(store).cli?.version, "24.11.2026");
  assert.equal(get(store).installing, false);
  assert.deepEqual(calls, ["restart-service"]);
});
