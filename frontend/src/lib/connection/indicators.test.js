// Proactive indicators for connected service updates: Connection tile dot
// (desktop app rail + mobile bottom bar) and dismissible ConnectionBanner strips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceClient } from "../service/client.js";
import { createConnectionStore } from "../../stores/createConnectionStore.js";
import { connectionServiceApi } from "../../stores/connectionServiceApi.js";
import { createServiceUpdateApi } from "../../stores/serviceUpdateApi.js";
import { createServiceUpdateStore, followConnection, SERVICE_UPDATE_EVENTS } from "../../stores/serviceUpdate.js";
import { connectionActionBanner, connectionTileIndicator, restartBannerKey } from "./indicators.js";

const conn = (overrides = {}) => ({
  phase: "connected",
  session: 1,
  connection: { id: "local", kind: "local", name: "Local", url: "" },
  version: "20.11.2026",
  runId: "run-1",
  restarting: false,
  restartAsk: false,
  restartSupported: true,
  restartRequired: false,
  apiWarning: null,
  ...overrides,
});

const upd = (overrides = {}) => ({
  loaded: true,
  supported: true,
  development: false,
  restartRequired: false,
  installedSeq: 0,
  available: null,
  install: null,
  ...overrides,
});

test("connectionTileIndicator shows for available update, restartRequired (from either store), or carriedUpgrade, and clears when healthy or disconnected", () => {
  // Healthy and up to date -> no dot
  assert.equal(connectionTileIndicator(conn(), upd()), null);

  // Available service update -> primary dot
  assert.deepEqual(
    connectionTileIndicator(
      conn(),
      upd({ available: { version: "24.11.2026", channel: "release", notes: "", page: "" } }),
    ),
    { kind: "available", label: "Marasi 24.11.2026 available" },
  );

  // restartRequired from serviceUpdateStore -> takes precedence over available
  assert.deepEqual(
    connectionTileIndicator(
      conn(),
      upd({
        restartRequired: true,
        install: { state: "installed", version: "24.11.2026", installPath: "/usr/local/bin/marasi" },
        available: { version: "24.11.2026", channel: "release", notes: "", page: "" },
      }),
    ),
    { kind: "restart-required", label: "24.11.2026 ready — restart to apply" },
  );

  // restartRequired discovered from GET /service/status alone (before GET /update settles)
  assert.deepEqual(
    connectionTileIndicator(conn({ restartRequired: true }), upd({ loaded: false })),
    { kind: "restart-required", label: "Restart to finish updating" },
  );

  // Ticket 06 hook: carriedUpgrade plugs in cleanly alongside available and restartRequired
  assert.deepEqual(
    connectionTileIndicator(conn(), upd(), { carriedUpgrade: { version: "25.11.2026" } }),
    { kind: "carried-upgrade", label: "Marasi CLI 25.11.2026 included" },
  );
  assert.deepEqual(
    connectionTileIndicator(conn(), upd(), { carriedUpgrade: true }),
    { kind: "carried-upgrade", label: "Marasi CLI update included" },
  );
  // restartRequired beats carriedUpgrade
  assert.equal(
    connectionTileIndicator(conn({ restartRequired: true }), upd(), { carriedUpgrade: { version: "25.11.2026" } })?.kind,
    "restart-required",
  );

  // Clears when disconnected, stopped, switching, reconnecting, or actively restarting
  for (const phase of ["idle", "starting", "connecting", "reconnecting", "project-changed", "failed", "auth-failed", "stopped", "unpaired"]) {
    assert.equal(
      connectionTileIndicator(
        conn({ phase, restartRequired: true }),
        upd({ restartRequired: true, available: { version: "24.11.2026" } }),
        { carriedUpgrade: { version: "25.11.2026" } },
      ),
      null,
    );
  }
  assert.equal(
    connectionTileIndicator(
      conn({ restarting: true, restartRequired: true }),
      upd({ restartRequired: true }),
    ),
    null,
  );

  // Hidden on development or unsupported services (service updates)
  assert.equal(
    connectionTileIndicator(
      conn({ version: "dev" }),
      upd({ available: { version: "24.11.2026" }, restartRequired: true }),
    ),
    null,
  );
  assert.equal(
    connectionTileIndicator(
      conn(),
      upd({ development: true, available: { version: "24.11.2026" }, restartRequired: true }),
    ),
    null,
  );
  assert.equal(
    connectionTileIndicator(
      conn(),
      upd({ supported: false, available: { version: "24.11.2026" }, restartRequired: true }),
    ),
    null,
  );
  assert.equal(
    connectionTileIndicator(
      conn({ restartSupported: false, restartRequired: true }),
      upd({ restartRequired: true }),
    ),
    null,
  );
});

test("connectionActionBanner renders restart-required copy with known version or fallback, and never shows for merely-available updates", () => {
  const remote = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };

  // Merely-available update -> NEVER shows a persistent page banner (tile dot only)
  const availState = upd({
    available: { version: "24.11.2026", channel: "release", notes: "Fixes", page: "https://example.com" },
  });
  assert.equal(connectionActionBanner(conn({ connection: remote }), availState), null);
  assert.equal(connectionTileIndicator(conn({ connection: remote }), availState)?.kind, "available");

  // Running install -> no persistent page banner
  assert.equal(
    connectionActionBanner(
      conn({ connection: remote }),
      upd({ install: { state: "running", version: "24.11.2026", step: "download", received: 50, total: 100 } }),
    ),
    null,
  );

  // restartRequired with known installed version -> "<name> updated to <version>."
  const withVersion = connectionActionBanner(
    conn({ connection: remote }),
    upd({
      restartRequired: true,
      install: { state: "installed", version: "24.11.2026", installPath: "/usr/local/bin/marasi" },
    }),
  );
  assert.equal(withVersion?.kind, "restart-required");
  assert.equal(withVersion?.name, "Lab");
  assert.equal(withVersion?.version, "24.11.2026");
  assert.equal(withVersion?.text, "Lab updated to 24.11.2026.");

  // restartRequired discovered from GET /service/status without a known installed version -> fallback copy
  const unknownVersion = connectionActionBanner(
    conn({ connection: remote, restartRequired: true }),
    upd({ loaded: false }),
  );
  assert.equal(unknownVersion?.kind, "restart-required");
  assert.equal(unknownVersion?.name, "Lab");
  assert.equal(unknownVersion?.version, null);
  assert.equal(unknownVersion?.text, "Lab needs a restart to finish updating.");

  // restartRequired with empty version in install snapshot -> fallback copy
  const emptyVersion = connectionActionBanner(
    conn(),
    upd({ restartRequired: true, install: { state: "installed", version: "" } }),
  );
  assert.equal(emptyVersion?.version, null);
  assert.equal(emptyVersion?.text, "Local needs a restart to finish updating.");

  // Hidden while restarting, disconnected, apiWarning, dev build, or unsupported restart
  assert.equal(
    connectionActionBanner(conn({ restarting: true, restartRequired: true }), upd({ restartRequired: true })),
    null,
  );
  assert.equal(
    connectionActionBanner(conn({ phase: "reconnecting", restartRequired: true }), upd({ restartRequired: true })),
    null,
  );
  assert.equal(
    connectionActionBanner(conn({ apiWarning: "API too old", restartRequired: true }), upd({ restartRequired: true })),
    null,
  );
  assert.equal(
    connectionActionBanner(conn({ version: "dev", restartRequired: true }), upd({ restartRequired: true })),
    null,
  );
  assert.equal(
    connectionActionBanner(conn({ restartSupported: false, restartRequired: true }), upd({ restartRequired: true })),
    null,
  );
});

test("connectionActionBanner dismissal hides the banner for the session/install while keeping the tile dot, and resets on new install or connection switch", () => {
  const localConn = conn({ session: 1, runId: "run-1", restartRequired: true });
  const initialUpd = upd({ loaded: false, installedSeq: 0 });

  const first = connectionActionBanner(localConn, initialUpd);
  assert.equal(first?.kind, "restart-required");
  const dismissedRestartKey = first.key;
  assert.equal(dismissedRestartKey, restartBannerKey(localConn, initialUpd));

  // Dismissed -> banner hides, but Connection tile dot stays intact
  assert.equal(connectionActionBanner(localConn, initialUpd, { dismissedRestartKey }), null);
  assert.equal(connectionTileIndicator(localConn, initialUpd)?.kind, "restart-required");

  // Initial GET /update settling with the same already-installed update keeps it dismissed
  const settledUpd = upd({
    loaded: true,
    restartRequired: true,
    installedSeq: 0,
    install: { state: "installed", version: "24.11.2026" },
  });
  assert.equal(connectionActionBanner(localConn, settledUpd, { dismissedRestartKey }), null);

  // A new install completing (installedSeq increments) resurfaces the banner
  const newInstallUpd = upd({
    loaded: true,
    restartRequired: true,
    installedSeq: 1,
    install: { state: "installed", version: "25.11.2026" },
  });
  const afterNewInstall = connectionActionBanner(localConn, newInstallUpd, { dismissedRestartKey });
  assert.equal(afterNewInstall?.kind, "restart-required");
  assert.equal(afterNewInstall?.text, "Local updated to 25.11.2026.");

  // Switching to another connection resets dismissal
  const remoteConn = conn({
    session: 2,
    connection: { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" },
    runId: "remote-run-1",
    restartRequired: true,
  });
  const onRemote = connectionActionBanner(remoteConn, settledUpd, { dismissedRestartKey });
  assert.equal(onRemote?.kind, "restart-required");
  assert.equal(onRemote?.text, "Lab updated to 24.11.2026.");

  // Switching back to Local (new session) resets dismissal too
  const backOnLocal = conn({ session: 3, runId: "run-1", restartRequired: true });
  assert.equal(
    connectionActionBanner(backOnLocal, settledUpd, { dismissedRestartKey })?.kind,
    "restart-required",
  );
});

test("connectionActionBanner supports inline restart confirmation and Ticket 06 carriedUpgrade hook", () => {
  const remote = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000" };

  // Inline restart confirmation when restartAsk is active on a remote or unowned local connection
  assert.deepEqual(
    connectionActionBanner(conn({ connection: remote, restartAsk: true, restartRequired: true }), upd({ restartRequired: true })),
    {
      kind: "restart-confirm",
      title: "Restart Lab?",
      detail: "Active connections will drop while the project reopens.",
    },
  );

  // Ticket 06 carriedUpgrade hook: renders when not dismissed and no restart is pending
  assert.deepEqual(
    connectionActionBanner(conn(), upd(), { carriedUpgrade: { version: "25.11.2026" } }),
    {
      kind: "carried-upgrade",
      version: "25.11.2026",
      text: "Marasi CLI 25.11.2026 included.",
    },
  );
  assert.equal(
    connectionActionBanner(conn(), upd(), { carriedUpgrade: { version: "25.11.2026" }, carriedDismissed: true }),
    null,
  );
  // restartRequired takes precedence over carriedUpgrade
  assert.equal(
    connectionActionBanner(conn({ restartRequired: true }), upd(), { carriedUpgrade: { version: "25.11.2026" } })?.kind,
    "restart-required",
  );
});

test("serviceUpdateStore + connectionStore lifecycle drives tile dot, banner dismissal, new-install resurface, connection switch, and post-restart clear", async () => {
  const local = { id: "local", kind: "local", name: "Local", url: "" };
  const remote = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };

  const streams = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      streams.push(this);
      queueMicrotask(() => {
        if (!this.closed) this.onopen?.({});
      });
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }
    emit(type, data, id = "") {
      if (this.closed) return;
      for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data), lastEventId: id });
    }
    close() {
      this.closed = true;
    }
  }
  const currentStream = () => streams.findLast((s) => !s.closed) ?? streams.at(-1);

  let localStatus = {
    version: "20.11.2026",
    api: 1,
    os: "darwin",
    channel: "release",
    restart_required: true,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };
  let localUpdate = {
    installed: { version: "20.11.2026", channel: "release" },
    development: false,
    channel: "release",
    available: null,
    install: { state: "installed", version: "24.11.2026" },
    restart_required: true,
    install_path: "/usr/local/bin/marasi",
  };
  const remoteStatus = {
    version: "20.11.2026",
    api: 1,
    os: "linux",
    channel: "release",
    restart_required: false,
    run_id: "remote-run-1",
    project: "/srv/lab.marasi",
    proxy_listener: "0.0.0.0:8080",
  };
  const remoteUpdate = {
    installed: { version: "20.11.2026", channel: "release" },
    development: false,
    channel: "release",
    available: { version: "24.11.2026", channel: "release", notes: "Notes", page: "https://example.com" },
    install: { state: "idle" },
    restart_required: false,
    install_path: "/usr/local/bin/marasi",
  };

  let finishInitialLocalUpdate;
  let initialLocalUpdatePending = true;

  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const isRemote = parsed.host === "10.0.0.5:9000";
    let body = {};
    if (method === "GET" && parsed.pathname === "/service/status") {
      body = isRemote ? remoteStatus : localStatus;
    } else if (method === "GET" && parsed.pathname === "/update") {
      if (!isRemote && initialLocalUpdatePending) {
        initialLocalUpdatePending = false;
        body = await new Promise((resolve) => {
          finishInitialLocalUpdate = resolve;
        });
      } else {
        body = isRemote ? remoteUpdate : localUpdate;
      }
    } else if (method === "POST" && parsed.pathname === "/service/restart") {
      localStatus = { ...localStatus, version: "25.11.2026", run_id: "run-2", restart_required: false };
      localUpdate = {
        ...localUpdate,
        installed: { version: "25.11.2026", channel: "release" },
        install: { state: "idle" },
        restart_required: false,
      };
      body = { instance: "default", status: "restarted", version: "25.11.2026" };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(body),
    };
  };

  const client = createServiceClient({ fetch, EventSource: FakeEventSource });
  const projectStore = { leave: () => {}, loadService: async () => {}, reload: async () => {}, closeFollowed: () => {} };
  const connStore = createConnectionStore({
    ...connectionServiceApi(client, projectStore),
    listConnections: async () => ({ connections: [local, remote], activeId: "local" }),
    connectLocal: async () => ({ url: "http://127.0.0.1:51391", password: "pw", instance: "default", startedByApp: true }),
    connectionPassword: async () => "remote-pw",
    claimOwnedRun: async () => {},
    confirmSwitch: async () => true,
    confirmFollow: async () => true,
    setActive: async () => {},
    clearStores: async () => {},
    serviceStopped: async () => {},
    resync: async () => {},
  });
  const updateStore = createServiceUpdateStore(createServiceUpdateApi(client));
  for (const name of SERVICE_UPDATE_EVENTS) client.on(name, (data) => updateStore.onEvent(name, data));
  const stopFollowing = followConnection(connStore, updateStore);

  const settle = () => new Promise((r) => setTimeout(r, 0));

  connStore.start();
  await settle();
  await settle();

  // 1. Discovered on connect via GET /service/status while GET /update is still in flight
  const beforeUpdate = connectionActionBanner(get(connStore), get(updateStore));
  assert.equal(beforeUpdate?.kind, "restart-required");
  assert.equal(beforeUpdate?.text, "Local needs a restart to finish updating.");
  assert.equal(connectionTileIndicator(get(connStore), get(updateStore))?.kind, "restart-required");

  // Dismissing hides banner; initial GET /update settling keeps it dismissed, while tile dot remains
  let dismissedRestartKey = beforeUpdate.key;
  finishInitialLocalUpdate(localUpdate);
  await settle();
  await settle();
  assert.equal(connectionActionBanner(get(connStore), get(updateStore), { dismissedRestartKey }), null);
  assert.equal(connectionTileIndicator(get(connStore), get(updateStore))?.kind, "restart-required");

  // 2. A new install completing via update.installed bumps installedSeq and resurfaces the banner
  currentStream().emit("update.installed", {
    instance: "default",
    version: "25.11.2026",
    install_path: "/usr/local/bin/marasi",
  });
  const afterNewInstall = connectionActionBanner(get(connStore), get(updateStore), { dismissedRestartKey });
  assert.equal(afterNewInstall?.kind, "restart-required");
  assert.equal(afterNewInstall?.text, "Local updated to 25.11.2026.");
  assert.notEqual(afterNewInstall.key, dismissedRestartKey);

  // 3. Switching to a remote with only an available update shows tile dot ONLY (no banner)
  connStore.switchTo("remote-1");
  await settle();
  await settle();
  await settle();
  assert.equal(connectionTileIndicator(get(connStore), get(updateStore))?.kind, "available");
  assert.equal(connectionActionBanner(get(connStore), get(updateStore), { dismissedRestartKey }), null);

  // 4. Switching back to Local resets dismissal, then restarting clears both dot and banner
  connStore.switchTo("local");
  await settle();
  await settle();
  await settle();
  assert.equal(connectionActionBanner(get(connStore), get(updateStore), { dismissedRestartKey })?.kind, "restart-required");

  connStore.restart();
  await settle();
  await settle();
  await settle();
  await settle();
  stopFollowing();

  assert.equal(get(connStore).runId, "run-2");
  assert.equal(connectionTileIndicator(get(connStore), get(updateStore)), null);
  assert.equal(connectionActionBanner(get(connStore), get(updateStore), { dismissedRestartKey }), null);
});

