// Service-client route-table tests for service updates:
// initial GET /update on connect and reconnect, clearing and superseding on
// connection switch, POST /update/check, POST /update/install (including join,
// 409 already_installed, 409 update_in_progress, install_path_not_writable),
// DELETE /update/install (cancel and 409 install_not_cancellable), live SSE
// update.* events, and 404/501/development graceful degradation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceClient } from "../lib/service/client.js";
import { createConnectionStore } from "./createConnectionStore.js";
import { connectionServiceApi } from "./connectionServiceApi.js";
import { createServiceUpdateApi } from "./serviceUpdateApi.js";
import { createServiceUpdateStore, followConnection, SERVICE_UPDATE_EVENTS, serviceUpdateToast } from "./serviceUpdate.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const remote = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };

const REFUSAL = Symbol("refusal");
const refusal = (status, body) => ({ [REFUSAL]: { status, body } });
const accepted = (body) => ({ [STATUS]: { status: 202, body } });
const STATUS = Symbol("status");

function makeEventSourceClass() {
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
    dispatch(type, event) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
    emit(type, data, id = "") {
      if (this.closed) return;
      this.lastEventId = id || this.lastEventId || "";
      this.dispatch(type, { data: JSON.stringify(data), lastEventId: id });
    }
    drop() {
      if (this.closed) return;
      this.onerror?.({ status: null });
    }
    close() {
      this.closed = true;
    }
  }
  return { FakeEventSource, currentStream: () => streams.findLast((s) => !s.closed) ?? streams.at(-1) };
}

function makeTimers() {
  const pending = new Map();
  let next = 0;
  return {
    setTimeout: (fn, ms) => {
      pending.set(++next, { fn, ms });
      return next;
    },
    clearTimeout: (id) => pending.delete(id),
    fire: () => {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.fn();
      }
    },
  };
}

function reached(store, phase) {
  return new Promise((resolve) => {
    const stop = store.subscribe((state) => {
      if (state.phase !== phase) return;
      queueMicrotask(() => stop());
      resolve(state);
    });
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const baseStatus = {
  version: "20.11.2026",
  api: 1,
  os: "darwin",
  channel: "release",
  restart_required: false,
  run_id: "run-1",
  project: "/p/app.marasi",
  proxy_listener: "127.0.0.1:8080",
};

const baseUpdate = {
  installed: { version: "20.11.2026", channel: "release" },
  development: false,
  channel: "release",
  auto_check: true,
  last_check: null,
  available: null,
  install: { state: "idle" },
  restart_required: false,
  install_path: "/usr/local/bin/marasi",
};

async function setup({ activeId = "local", routes = {} } = {}) {
  const requests = [];
  const { FakeEventSource, currentStream } = makeEventSourceClass();
  const fullRoutes = {
    "GET /service/status": () => baseStatus,
    "GET /update": () => baseUpdate,
    ...routes,
  };

  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const req = { method, host: parsed.host, path: parsed.pathname, body };
    requests.push(req);
    const key = `${method} ${parsed.pathname}`;
    let answer = fullRoutes[key];
    if (typeof answer === "function") answer = await answer(body, req, currentStream());
    const refused = answer?.[REFUSAL];
    if (refused) {
      return {
        ok: false,
        status: refused.status,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(refused.body),
      };
    }
    const custom = answer?.[STATUS];
    if (custom) {
      return {
        ok: custom.status >= 200 && custom.status < 300,
        status: custom.status,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(custom.body),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(answer ?? {}),
    };
  };

  const client = createServiceClient({ fetch, EventSource: FakeEventSource });
  const projectStore = {
    leave: () => {},
    loadService: async () => {},
    reload: async () => {},
    closeFollowed: () => {},
  };
  const api = {
    ...connectionServiceApi(client, projectStore),
    listConnections: async () => ({ connections: [local, remote], activeId }),
    connectLocal: async () => ({ url: "http://127.0.0.1:51391", password: "pw", instance: "default", startedByApp: true }),
    connectionPassword: async () => "remote-pw",
    claimOwnedRun: async () => {},
    confirmSwitch: async () => true,
    confirmFollow: async () => true,
    setActive: async () => {},
    clearStores: async () => {},
    serviceStopped: async () => {},
    resync: async () => {},
  };

  const conn = createConnectionStore(api, makeTimers());
  const updateStore = createServiceUpdateStore(createServiceUpdateApi(client));
  for (const name of SERVICE_UPDATE_EVENTS) client.on(name, (data) => updateStore.onEvent(name, data));
  const stopFollowing = followConnection(conn, updateStore);

  conn.start();
  await reached(conn, "connected");
  await settle();
  await settle();

  return { conn, updateStore, client, requests, currentStream, stopFollowing };
}

test("entering connected fetches GET /update and populates available, install path, and channel", async () => {
  const { updateStore, requests, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        available: {
          version: "24.11.2026",
          channel: "release",
          published: "2026-11-24T00:00:00Z",
          notes: "Faster proxy",
          page: "https://example.com/releases/24.11.2026",
        },
      }),
    },
  });
  stopFollowing();

  assert.equal(requests.filter((r) => r.method === "GET" && r.path === "/update").length, 1);
  const state = get(updateStore);
  assert.equal(state.loaded, true);
  assert.equal(state.supported, true);
  assert.equal(state.development, false);
  assert.equal(state.channel, "release");
  assert.equal(state.installPath, "/usr/local/bin/marasi");
  assert.equal(state.restartRequired, false);
  assert.deepEqual(state.available, {
    version: "24.11.2026",
    channel: "release",
    published: "2026-11-24T00:00:00Z",
    notes: "Faster proxy",
    page: "https://example.com/releases/24.11.2026",
  });
});

for (const [label, route] of [
  ["404", () => refusal(404, { error: "not_found" })],
  ["501 updates_unavailable", () => refusal(501, { error: "updates_unavailable" })],
]) {
  test(`GET /update returning ${label} degrades gracefully with supported=false and no error`, async () => {
    const { updateStore, stopFollowing } = await setup({
      routes: { "GET /update": route },
    });
    stopFollowing();

    const state = get(updateStore);
    assert.equal(state.loaded, true);
    assert.equal(state.supported, false);
    assert.equal(state.error, null);
    assert.equal(state.available, null);
  });
}

test("GET /update reporting development: true marks development without error", async () => {
  const { updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        installed: { version: "dev", channel: null },
        development: true,
        channel: null,
      }),
    },
  });
  stopFollowing();

  const state = get(updateStore);
  assert.equal(state.loaded, true);
  assert.equal(state.supported, true);
  assert.equal(state.development, true);
  assert.equal(state.error, null);
});

test("switching connections clears prior state immediately and loads GET /update for the new connection", async () => {
  let activeHost = "127.0.0.1:51391";
  let finishRemoteUpdate;
  const { conn, updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": (_body, req) => {
        if (req.host === activeHost) {
          return {
            ...baseUpdate,
            available: {
              version: "24.11.2026",
              channel: "release",
              notes: "Local notes",
              page: "https://example.com/local",
            },
          };
        }
        return new Promise((resolve) => {
          finishRemoteUpdate = resolve;
        });
      },
    },
  });

  assert.equal(get(updateStore).available?.version, "24.11.2026");

  // Switch to remote: once confirmed, prior state clears immediately before remote connects or GET /update settles.
  conn.switchTo("remote-1");
  await reached(conn, "connecting");
  assert.equal(get(updateStore).available, null);
  assert.equal(get(updateStore).loaded, false);

  await reached(conn, "connected");
  await settle();
  // Remote GET /update is still in flight; local data must never leak back.
  assert.equal(get(updateStore).available, null);

  finishRemoteUpdate({
    ...baseUpdate,
    channel: "nightly",
    installed: { version: "23.11.2026 (nightly aaa1111)", channel: "nightly" },
    restart_required: true,
  });
  await settle();
  await settle();
  stopFollowing();

  const state = get(updateStore);
  assert.equal(state.loaded, true);
  assert.equal(state.channel, "nightly");
  assert.equal(state.restartRequired, true);
  assert.equal(state.available, null);
});

test("reconnecting onto a new run_id after restart reloads GET /update and clears restartRequired", async () => {
  let status = { ...baseStatus, run_id: "run-1", restart_required: true };
  let updateResp = {
    ...baseUpdate,
    restart_required: true,
    install: { state: "installed", version: "24.11.2026" },
  };
  const { conn, updateStore, requests, stopFollowing } = await setup({
    routes: {
      "GET /service/status": () => status,
      "GET /update": () => updateResp,
      "POST /service/restart": () => {
        status = { ...status, version: "24.11.2026", run_id: "run-2", restart_required: false };
        updateResp = {
          ...baseUpdate,
          installed: { version: "24.11.2026", channel: "release" },
          restart_required: false,
          install: { state: "idle" },
        };
        return { instance: "default", status: "restarted", version: "24.11.2026" };
      },
    },
  });

  assert.equal(get(updateStore).restartRequired, true);
  const getsBefore = requests.filter((r) => r.method === "GET" && r.path === "/update").length;

  conn.restart();
  await settle();
  await settle();
  await settle();
  await settle();
  stopFollowing();

  assert.equal(get(conn).runId, "run-2");
  assert.equal(requests.filter((r) => r.method === "GET" && r.path === "/update").length, getsBefore + 1);
  const state = get(updateStore);
  assert.equal(state.restartRequired, false);
  assert.equal(state.install, null);
  assert.equal(state.installed?.version, "24.11.2026");
});

test("POST /update/check reports up-to-date, available update, or check failure cleanly", async () => {
  let checkResp = { ...baseUpdate };
  const { updateStore, requests, stopFollowing } = await setup({
    routes: {
      "POST /update/check": () => checkResp,
    },
  });

  // 1. Up to date
  const upToDate = await updateStore.check();
  assert.equal(requests.filter((r) => r.method === "POST" && r.path === "/update/check").length, 1);
  assert.equal(upToDate.ok, true);
  assert.equal(upToDate.kind, "up-to-date");
  assert.equal(get(updateStore).checking, false);
  assert.equal(get(updateStore).error, null);
  assert.equal(get(updateStore).checkResult?.kind, "up-to-date");

  // 2. Update found
  checkResp = {
    ...baseUpdate,
    available: {
      version: "24.11.2026",
      channel: "release",
      notes: "Bug fixes",
      page: "https://example.com/24.11.2026",
    },
  };
  const found = await updateStore.check();
  assert.equal(found.ok, true);
  assert.equal(found.kind, "available");
  assert.equal(get(updateStore).available?.version, "24.11.2026");
  assert.equal(get(updateStore).error, null);

  // 3. Check failure reported via last_check.error
  checkResp = {
    ...baseUpdate,
    last_check: { at: "2026-11-24T00:00:00Z", latest: null, error: "github unreachable" },
  };
  const failed = await updateStore.check();
  stopFollowing();
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, "error");
  assert.equal(get(updateStore).checking, false);
  assert.equal(get(updateStore).error?.message, "github unreachable");
});

test("in-flight GET /update and POST /update/check are superseded silently on connection switch", async () => {
  let finishCheck;
  let remoteGets = 0;
  const { conn, updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": (_body, req) => {
        if (req.host === "10.0.0.5:9000") {
          remoteGets++;
          return { ...baseUpdate, channel: "nightly" };
        }
        return baseUpdate;
      },
      "POST /update/check": () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    },
  });

  const pending = updateStore.check();
  assert.equal(get(updateStore).checking, true);

  // Switch connection while POST /update/check is still in flight on Local.
  conn.switchTo("remote-1");
  await reached(conn, "connected");
  await settle();
  await settle();

  // Late failure from Local must be discarded silently without touching Remote's state.
  finishCheck(refusal(500, { error: "internal_server_error", message: "stale local error" }));
  const result = await pending;
  stopFollowing();

  assert.equal(result.ok, false);
  assert.equal(result.superseded, true);
  assert.equal(remoteGets, 1);
  const state = get(updateStore);
  assert.equal(state.channel, "nightly");
  assert.equal(state.checking, false);
  assert.equal(state.error, null);
  assert.equal(state.available, null);
});

test("POST /update/install tracks live download, verify, swap, and update.installed to restartRequired", async () => {
  const avail = {
    version: "24.11.2026",
    channel: "release",
    notes: "Release notes",
    page: "https://example.com/releases/24.11.2026",
  };
  const { updateStore, requests, currentStream, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({ ...baseUpdate, available: avail }),
      "POST /update/install": () =>
        accepted({
          joined: false,
          install: { state: "running", version: "24.11.2026", step: "download", received: 0, total: 1000 },
          install_path: "/usr/local/bin/marasi",
        }),
    },
  });

  const started = await updateStore.install();
  assert.equal(started.ok, true);
  assert.equal(requests.filter((r) => r.method === "POST" && r.path === "/update/install").length, 1);
  assert.equal(get(updateStore).startingInstall, false);
  assert.equal(get(updateStore).install?.state, "running");
  assert.equal(get(updateStore).install?.step, "download");

  currentStream().emit("update.progress", {
    instance: "default",
    version: "24.11.2026",
    step: "download",
    received: 500,
    total: 1000,
  });
  assert.equal(get(updateStore).install?.received, 500);

  currentStream().emit("update.progress", {
    instance: "default",
    version: "24.11.2026",
    step: "verify",
    received: 1000,
    total: 1000,
  });
  assert.equal(get(updateStore).install?.step, "verify");

  currentStream().emit("update.progress", {
    instance: "default",
    version: "24.11.2026",
    step: "install",
    received: 1000,
    total: 1000,
  });
  assert.equal(get(updateStore).install?.step, "install");

  currentStream().emit("update.installed", {
    instance: "default",
    version: "24.11.2026",
    install_path: "/usr/local/bin/marasi",
  });
  stopFollowing();

  const state = get(updateStore);
  assert.equal(state.restartRequired, true);
  assert.equal(state.install?.state, "installed");
  assert.equal(state.install?.version, "24.11.2026");
  assert.equal(state.available, null);
  assert.equal(state.error, null);
});

test("joining an install started by another client works via GET /update and via 202 joined: true", async () => {
  // 1. Discovered on initial GET /update
  const first = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        install: { state: "running", version: "24.11.2026", step: "verify", received: 2048, total: 2048 },
      }),
    },
  });
  first.stopFollowing();
  assert.equal(get(first.updateStore).install?.state, "running");
  assert.equal(get(first.updateStore).install?.step, "verify");
  assert.equal(get(first.updateStore).install?.joined, true);

  // 2. Joined via POST /update/install 202 { joined: true }
  const second = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        available: { version: "24.11.2026", channel: "release", notes: "", page: "" },
      }),
      "POST /update/install": () =>
        accepted({
          joined: true,
          install: { state: "running", version: "24.11.2026", step: "download", received: 400, total: 1000 },
          install_path: "/usr/local/bin/marasi",
        }),
    },
  });
  const res = await second.updateStore.install();
  second.stopFollowing();

  assert.equal(res.ok, true);
  assert.equal(res.joined, true);
  const state = get(second.updateStore);
  assert.equal(state.install?.state, "running");
  assert.equal(state.install?.joined, true);
  assert.equal(state.install?.received, 400);
  assert.equal(state.error, null);
});

test("409 already_installed transitions cleanly to restartRequired: true with no error", async () => {
  const { updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        available: { version: "24.11.2026", channel: "release", notes: "", page: "" },
      }),
      "POST /update/install": () =>
        refusal(409, {
          error: "already_installed",
          message: "an update is installed; restart the instance to run it",
        }),
    },
  });

  const res = await updateStore.install();
  stopFollowing();

  assert.equal(res.ok, true);
  assert.equal(res.alreadyInstalled, true);
  const state = get(updateStore);
  assert.equal(state.restartRequired, true);
  assert.equal(state.startingInstall, false);
  assert.equal(state.available, null);
  assert.equal(state.error, null);
});

test("409 update_in_progress follows the active install without erroring", async () => {
  let getCount = 0;
  const { updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": () => {
        getCount++;
        if (getCount === 1) {
          return {
            ...baseUpdate,
            available: { version: "24.11.2026", channel: "release", notes: "", page: "" },
          };
        }
        return {
          ...baseUpdate,
          install: { state: "running", version: "24.11.2026", step: "download", received: 300, total: 1000 },
        };
      },
      "POST /update/install": () =>
        refusal(409, {
          error: "update_in_progress",
          message: "an update is already installing",
        }),
    },
  });

  const res = await updateStore.install();
  stopFollowing();

  assert.equal(res.ok, true);
  assert.equal(res.joined, true);
  const state = get(updateStore);
  assert.equal(state.startingInstall, false);
  assert.equal(state.error, null);
  assert.equal(state.install?.state, "running");
  assert.equal(state.install?.received, 300);
});

test("409 install_path_not_writable surfaces install_path and release page without stuck busy state", async () => {
  const { updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        install_path: "/opt/marasi/bin/marasi",
        available: {
          version: "24.11.2026",
          channel: "release",
          notes: "Fixes",
          page: "https://example.com/releases/24.11.2026",
        },
      }),
      "POST /update/install": () =>
        refusal(409, {
          error: "install_path_not_writable",
          message: "permission denied replacing /opt/marasi/bin/marasi",
          page: "https://example.com/releases/24.11.2026",
        }),
    },
  });

  const res = await updateStore.install();
  stopFollowing();

  assert.equal(res.ok, false);
  const state = get(updateStore);
  assert.equal(state.startingInstall, false);
  assert.equal(state.install?.state, "failed");
  assert.equal(state.error?.code, "install_path_not_writable");
  assert.equal(state.error?.installPath, "/opt/marasi/bin/marasi");
  assert.equal(state.error?.page, "https://example.com/releases/24.11.2026");
  assert.match(state.error?.message, /permission denied/);
  // Available update stays so the user can retry after fixing permissions.
  assert.equal(state.available?.version, "24.11.2026");
});

test("DELETE /update/install cancels cleanly during download and leaves no error card", async () => {
  const { updateStore, requests, currentStream, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        available: { version: "24.11.2026", channel: "release", notes: "Notes", page: "https://example.com/r" },
      }),
      "POST /update/install": () =>
        accepted({
          joined: false,
          install: { state: "running", version: "24.11.2026", step: "download", received: 100, total: 1000 },
          install_path: "/usr/local/bin/marasi",
        }),
      "DELETE /update/install": (_body, _req, stream) => {
        stream?.emit("update.failed", {
          instance: "default",
          version: "24.11.2026",
          kind: "cancelled",
          step: "download",
          message: "the install was cancelled: context canceled",
        });
        return {
          install: {
            state: "failed",
            version: "24.11.2026",
            step: "download",
            error: { kind: "cancelled", step: "download", message: "the install was cancelled: context canceled" },
          },
        };
      },
    },
  });

  await updateStore.install();
  assert.equal(get(updateStore).install?.state, "running");

  const cancelled = await updateStore.cancel();
  stopFollowing();

  assert.equal(cancelled.ok, true);
  assert.equal(requests.filter((r) => r.method === "DELETE" && r.path === "/update/install").length, 1);
  const state = get(updateStore);
  assert.equal(state.cancelling, false);
  assert.equal(state.install, null);
  assert.equal(state.error, null);
  assert.equal(state.available?.version, "24.11.2026");
});

test("DELETE /update/install returning 409 install_not_cancellable refreshes GET /update without erroring", async () => {
  let getCount = 0;
  const { updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": () => {
        getCount++;
        if (getCount === 1) {
          return {
            ...baseUpdate,
            install: { state: "running", version: "24.11.2026", step: "verify", received: 1000, total: 1000 },
          };
        }
        return {
          ...baseUpdate,
          restart_required: true,
          install: { state: "installed", version: "24.11.2026" },
        };
      },
      "DELETE /update/install": () =>
        refusal(409, {
          error: "install_not_cancellable",
          message: "the install replaced the installed build before it could be cancelled",
        }),
    },
  });

  const res = await updateStore.cancel();
  stopFollowing();

  assert.equal(res.ok, false);
  assert.equal(res.notCancellable, true);
  const state = get(updateStore);
  assert.equal(state.cancelling, false);
  assert.equal(state.error, null);
  assert.equal(state.restartRequired, true);
});

test("in-flight POST /update/install and DELETE /update/install are superseded silently on connection switch", async () => {
  let finishInstall;
  const { conn, updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": (_body, req) =>
        req.host === "10.0.0.5:9000"
          ? { ...baseUpdate, channel: "nightly" }
          : { ...baseUpdate, available: { version: "24.11.2026", channel: "release", notes: "", page: "" } },
      "POST /update/install": () =>
        new Promise((resolve) => {
          finishInstall = resolve;
        }),
    },
  });

  const pending = updateStore.install();
  assert.equal(get(updateStore).startingInstall, true);

  conn.switchTo("remote-1");
  await reached(conn, "connected");
  await settle();
  await settle();

  finishInstall(refusal(409, { error: "install_path_not_writable", message: "stale local error" }));
  const res = await pending;
  stopFollowing();

  assert.equal(res.ok, false);
  assert.equal(res.superseded, true);
  const state = get(updateStore);
  assert.equal(state.channel, "nightly");
  assert.equal(state.startingInstall, false);
  assert.equal(state.error, null);
  assert.equal(state.install, null);
});

test("in-flight DELETE /update/install is superseded silently on connection switch and cancelled events do not toast errors", async () => {
  assert.equal(
    serviceUpdateToast("update.failed", { version: "24.11.2026", kind: "cancelled", message: "cancelled" }, "Local"),
    null,
  );

  let finishCancel;
  const { conn, updateStore, stopFollowing } = await setup({
    routes: {
      "GET /update": (_body, req) =>
        req.host === "10.0.0.5:9000"
          ? { ...baseUpdate, channel: "nightly" }
          : {
              ...baseUpdate,
              install: { state: "running", version: "24.11.2026", step: "download", received: 200, total: 1000 },
            },
      "DELETE /update/install": () =>
        new Promise((resolve) => {
          finishCancel = resolve;
        }),
    },
  });

  const pending = updateStore.cancel();
  assert.equal(get(updateStore).cancelling, true);

  conn.switchTo("remote-1");
  await reached(conn, "connected");
  await settle();
  await settle();

  finishCancel(refusal(500, { error: "internal_server_error", message: "stale cancel error" }));
  const res = await pending;
  stopFollowing();

  assert.equal(res.ok, false);
  assert.equal(res.superseded, true);
  assert.equal(get(updateStore).channel, "nightly");
  assert.equal(get(updateStore).cancelling, false);
  assert.equal(get(updateStore).error, null);
});

test("update.failed SSE event surfaces error with page and clears busy state while keeping available for retry", async () => {
  const { updateStore, currentStream, stopFollowing } = await setup({
    routes: {
      "GET /update": () => ({
        ...baseUpdate,
        available: {
          version: "24.11.2026",
          channel: "release",
          notes: "Fixes",
          page: "https://example.com/releases/24.11.2026",
        },
      }),
      "POST /update/install": () =>
        accepted({
          joined: false,
          install: { state: "running", version: "24.11.2026", step: "download", received: 0, total: 1000 },
          install_path: "/usr/local/bin/marasi",
        }),
    },
  });

  await updateStore.install();
  currentStream().emit("update.failed", {
    instance: "default",
    version: "24.11.2026",
    kind: "checksum",
    step: "verify",
    message: "checksum mismatch",
    page: "https://example.com/releases/24.11.2026",
  });
  stopFollowing();

  const state = get(updateStore);
  assert.equal(state.startingInstall, false);
  assert.equal(state.cancelling, false);
  assert.equal(state.install?.state, "failed");
  assert.equal(state.error?.message, "checksum mismatch");
  assert.equal(state.error?.page, "https://example.com/releases/24.11.2026");
  assert.equal(state.available?.version, "24.11.2026");
});
