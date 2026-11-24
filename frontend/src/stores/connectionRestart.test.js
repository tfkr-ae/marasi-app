// Service-client route-table tests for restarting any connected service
// (local or remote) through POST /service/restart with {"force": false}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import { createServiceClient } from "../lib/service/client.js";
import { createConnectionStore } from "./createConnectionStore.js";
import { connectionServiceApi } from "./connectionServiceApi.js";

const local = { id: "local", kind: "local", name: "Local", url: "" };
const remote = { id: "remote-1", kind: "remote", name: "Lab", url: "http://10.0.0.5:9000", noPassword: false };

const REFUSAL = Symbol("refusal");
const refusal = (status, body) => ({ [REFUSAL]: { status, body } });

// Fake EventSource that lets tests emit SSE events and simulate stream drops.
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
    waits: () => [...pending.values()].map((t) => t.ms),
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

/**
 * Boots a real createServiceClient + connectionServiceApi + createConnectionStore
 * backed by a route table and SSE fake, connected to either local or remote.
 */
async function setup({
  activeId = "local",
  owned = true,
  routes = {},
  confirmSwitch = () => true,
} = {}) {
  const requests = [];
  const calls = [];
  const claimed = [];
  const { FakeEventSource, currentStream } = makeEventSourceClass();

  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const req = { method, host: parsed.host, path: parsed.pathname, body };
    requests.push(req);
    const key = `${method} ${parsed.pathname}`;
    let answer = routes[key];
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
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(answer ?? {}),
    };
  };

  const client = createServiceClient({ fetch, EventSource: FakeEventSource });
  const projectStore = {
    leave: () => calls.push("leave"),
    loadService: async (project) => calls.push(["loadProject", project]),
    reload: async (project) => calls.push(["reloadProject", project]),
    closeFollowed: () => calls.push("closeFollowed"),
  };

  let ownedRunId = null;
  const timers = makeTimers();
  const api = {
    ...connectionServiceApi(client, projectStore),
    listConnections: async () => ({ connections: [local, remote], activeId }),
    connectLocal: async (id) => {
      calls.push(["connectLocal", id]);
      // Mirror Go's ConnectLocal: ownsRun matches only when run_id matches saved ownedRunId.
      const statusResp =
        typeof routes["GET /service/status"] === "function"
          ? await routes["GET /service/status"]()
          : routes["GET /service/status"];
      const currentRun = statusResp?.run_id ?? "";
      if (ownedRunId === null) ownedRunId = owned ? currentRun : "";
      const startedByApp = Boolean(ownedRunId && currentRun === ownedRunId);
      if (!startedByApp) ownedRunId = "";
      return { url: "http://127.0.0.1:51391", password: "pw", instance: "default", startedByApp };
    },
    connectionPassword: async (id) => {
      calls.push(["connectionPassword", id]);
      return "remote-pw";
    },
    claimOwnedRun: async (id, runId) => {
      claimed.push([id, runId]);
      ownedRunId = runId;
    },
    confirmSwitch: async () => {
      calls.push("confirmSwitch");
      return confirmSwitch();
    },
    confirmFollow: async () => true,
    setActive: async (id) => calls.push(["setActive", id]),
    clearStores: async () => calls.push("clearStores"),
    serviceStopped: async () => calls.push("serviceStopped"),
    resync: async () => calls.push("resync"),
  };

  const store = createConnectionStore(api, timers);
  client.on("service.restarting", (restart) => store.dispatch({ type: "SERVICE_RESTARTING", restart }));
  client.on("service.restart_failed", (failure) => store.dispatch({ type: "SERVICE_RESTART_FAILED", failure }));

  store.start();
  await reached(store, "connected");
  await settle();
  requests.length = 0;
  calls.length = 0;
  claimed.length = 0;

  return { store, client, requests, calls, claimed, timers, currentStream };
}

test("local owned restart runs unsaved-work guard, posts force:false, reconnects to new run_id, and preserves ownership", async () => {
  let status = {
    version: "20.11.2026",
    api: 1,
    os: "darwin",
    channel: "release",
    restart_required: true,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };
  let seenRestartingPhase = false;

  const { store, requests, calls, claimed } = await setup({
    activeId: "local",
    owned: true,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": (_body, _req, stream) => {
        stream?.emit("service.restarting", { instance: "default" });
        // Handover completes to successor run-2 with the updated version.
        status = { ...status, version: "24.11.2026", restart_required: false, run_id: "run-2" };
        return { instance: "default", status: "restarted", version: "24.11.2026", proxy_listener: "127.0.0.1:8080" };
      },
    },
  });

  const unsub = store.subscribe((s) => {
    if (s.restarting) seenRestartingPhase = true;
  });

  assert.equal(store.restart(), null);
  await settle();
  await settle();
  await settle();
  await settle();
  unsub();

  const restartReqs = requests.filter((r) => r.method === "POST" && r.path === "/service/restart");
  assert.equal(restartReqs.length, 1);
  assert.deepEqual(restartReqs[0].body, { force: false });
  assert.equal(seenRestartingPhase, true);

  const state = get(store);
  assert.equal(state.phase, "connected");
  assert.equal(state.restarting, false);
  assert.equal(state.restartAsk, false);
  assert.equal(state.runId, "run-2");
  assert.equal(state.version, "24.11.2026");
  assert.equal(state.restartRequired, false);
  assert.equal(state.owned, true);
  assert.deepEqual(claimed, [["local", "run-2"]]);
  // Unsaved-work guard ran once before restart — never prompted a second time on reconnect.
  assert.equal(calls.filter((c) => c === "confirmSwitch").length, 1);
  assert.deepEqual(
    calls.filter((c) => Array.isArray(c) && c[0] === "reloadProject"),
    [["reloadProject", "/p/app.marasi"]],
  );
});

test("remote restart asks for inline confirmation first, then posts force:false and reconnects onto the new run_id", async () => {
  let status = {
    version: "20.11.2026",
    api: 1,
    os: "linux",
    channel: "release",
    restart_required: true,
    run_id: "remote-run-1",
    project: "/srv/lab.marasi",
    proxy_listener: "0.0.0.0:8080",
  };

  const { store, requests, calls, claimed } = await setup({
    activeId: "remote-1",
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": () => {
        status = { ...status, version: "24.11.2026", restart_required: false, run_id: "remote-run-2" };
        return { instance: "lab", status: "restarted", version: "24.11.2026", proxy_listener: "0.0.0.0:8080" };
      },
    },
  });

  // First click asks for inline confirmation without touching the guard or the service.
  assert.equal(store.restart(), null);
  assert.equal(get(store).restartAsk, true);
  assert.equal(requests.length, 0);
  assert.equal(calls.length, 0);

  // Cancel clears confirmation and leaves the service untouched.
  store.cancelRestart();
  assert.equal(get(store).restartAsk, false);
  assert.equal(requests.length, 0);

  // Confirm runs the unsaved-work guard, sends POST /service/restart {force:false}, and reconnects.
  store.restart();
  assert.equal(get(store).restartAsk, true);
  store.confirmRestart();
  await settle();
  await settle();
  await settle();
  await settle();

  const restartReqs = requests.filter((r) => r.method === "POST" && r.path === "/service/restart");
  assert.equal(restartReqs.length, 1);
  assert.deepEqual(restartReqs[0].body, { force: false });
  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).runId, "remote-run-2");
  assert.equal(get(store).version, "24.11.2026");
  assert.equal(get(store).restartRequired, false);
  assert.equal(get(store).restarting, false);
  assert.deepEqual(claimed, []);
  assert.equal(calls.filter((c) => c === "confirmSwitch").length, 1);
});

test("unowned local restart asks for inline confirmation and does not claim ownership after restart", async () => {
  let status = {
    version: "24.11.2026",
    api: 1,
    os: "darwin",
    channel: "release",
    restart_required: false,
    run_id: "ext-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };

  const { store, requests, claimed } = await setup({
    activeId: "local",
    owned: false,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": () => {
        status = { ...status, run_id: "ext-2" };
        return { instance: "default", status: "restarted", version: "24.11.2026", proxy_listener: "127.0.0.1:8080" };
      },
    },
  });

  store.restart();
  assert.equal(get(store).restartAsk, true);
  assert.equal(requests.length, 0);

  store.confirmRestart();
  await settle();
  await settle();
  await settle();
  await settle();

  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).runId, "ext-2");
  assert.equal(get(store).owned, false);
  assert.deepEqual(claimed, []);
});

test("cancelling the unsaved-work guard leaves the service untouched", async () => {
  const status = {
    version: "24.11.2026",
    api: 1,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };

  const { store, requests, calls } = await setup({
    activeId: "local",
    owned: true,
    confirmSwitch: () => false,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": () => {
        throw new Error("should not be called when unsaved-work guard cancels");
      },
    },
  });

  store.restart();
  await settle();
  await settle();

  assert.deepEqual(calls, ["confirmSwitch"]);
  assert.equal(requests.length, 0);
  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).restarting, false);
  assert.equal(get(store).runId, "run-1");
});

test("409 checkpoint_items_held opens the held-items modal, stays connected, and never forces restart", async () => {
  const status = {
    version: "24.11.2026",
    api: 1,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };

  const { store, requests } = await setup({
    activeId: "local",
    owned: true,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": (_body, _req, stream) => {
        // Even if a mid-handover rollback emitted service.restart_failed right
        // before answering 409 checkpoint_items_held, the held modal wins and
        // no raw restartError is left behind.
        stream?.emit("service.restart_failed", { instance: "default", error: "1 held Checkpoint items would be dropped" });
        return refusal(409, {
          error: "checkpoint_items_held",
          message: "1 held Checkpoint items would be dropped; forward or drop them, or force the restart",
          items: [{ id: "item-1", type: "request", summary: "GET /admin" }],
        });
      },
    },
  });

  store.restart();
  await settle();
  await settle();

  const restartReqs = requests.filter((r) => r.method === "POST" && r.path === "/service/restart");
  assert.equal(restartReqs.length, 1);
  assert.deepEqual(restartReqs[0].body, { force: false });

  const state = get(store);
  assert.equal(state.phase, "connected");
  assert.equal(state.restarting, false);
  assert.equal(state.restartError, null);
  assert.equal(state.restartHeld, 1);
  assert.equal(state.runId, "run-1");
});

test("500 restart_failed and service.restart_failed clear restarting, surface the error, and stay connected to rolled-back run", async () => {
  const status = {
    version: "20.11.2026",
    api: 1,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };

  const { store, claimed } = await setup({
    activeId: "local",
    owned: true,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": (_body, _req, stream) => {
        stream?.emit("service.restarting", { instance: "default" });
        stream?.emit("service.restart_failed", {
          instance: "default",
          error: "successor exited with status 1",
          log: "/tmp/successor.log",
        });
        return refusal(500, {
          error: "restart_failed",
          message: "successor exited with status 1 (successor log: /tmp/successor.log)",
          log: "/tmp/successor.log",
        });
      },
    },
  });

  store.restart();
  await settle();
  await settle();

  const state = get(store);
  assert.equal(state.phase, "connected");
  assert.equal(state.restarting, false);
  assert.equal(state.runId, "run-1");
  assert.equal(state.owned, true);
  assert.match(state.restartError, /successor exited with status 1/);
  assert.deepEqual(claimed, []);
});

test("HTTP-only 500 restart_failed without SSE event surfaces the error cleanly and stays connected", async () => {
  const status = {
    version: "20.11.2026",
    api: 1,
    run_id: "remote-run-1",
    project: "/srv/lab.marasi",
    proxy_listener: "0.0.0.0:8080",
  };

  const { store } = await setup({
    activeId: "remote-1",
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": () =>
        refusal(500, {
          error: "restart_failed",
          message: "successor did not become ready in time",
        }),
    },
  });

  store.confirmRestart();
  await settle();
  await settle();

  const state = get(store);
  assert.equal(state.phase, "connected");
  assert.equal(state.restarting, false);
  assert.equal(state.runId, "remote-run-1");
  assert.equal(state.restartError, "successor did not become ready in time");
});

for (const [label, answer] of [
  ["404", refusal(404, { error: "not_found", message: "404 page not found" })],
  ["501 restart_unavailable", refusal(501, { error: "restart_unavailable" })],
]) {
  test(`older service returning ${label} hides restart gracefully without erroring and resets on connection switch`, async () => {
    const status = {
      version: "10.10.2026",
      api: 1,
      run_id: "old-run-1",
      project: "/p/app.marasi",
      proxy_listener: "127.0.0.1:8080",
    };

    const { store, requests } = await setup({
      activeId: "local",
      owned: true,
      routes: {
        "GET /service/status": () => status,
        "POST /service/restart": () => answer,
      },
    });

    assert.equal(get(store).restartSupported, true);
    store.restart();
    await settle();
    await settle();

    const after = get(store);
    assert.equal(after.phase, "connected");
    assert.equal(after.restarting, false);
    assert.equal(after.restartError, null);
    assert.equal(after.restartSupported, false);

    // Further restart attempts are refused without hitting the service.
    const countBefore = requests.length;
    assert.notEqual(store.restart(), null);
    assert.equal(requests.length, countBefore);

    // Switching connections resets restartSupported to true for the new connection.
    store.switchTo("remote-1");
    await reached(store, "connected");
    await settle();
    assert.equal(get(store).connection.id, "remote-1");
    assert.equal(get(store).restartSupported, true);
  });
}

test("stream drop during handover transitions through reconnecting and reconnects cleanly onto the new run_id", async () => {
  let status = {
    version: "20.11.2026",
    api: 1,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };
  let finishPost;

  const { store, timers, claimed, currentStream } = await setup({
    activeId: "local",
    owned: true,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": (_body, _req, stream) => {
        stream?.emit("service.restarting", { instance: "default" });
        return new Promise((resolve) => {
          finishPost = resolve;
        });
      },
    },
  });

  store.restart();
  await settle();
  await settle();
  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).restarting, true);

  // Old server exits and drops the SSE stream before POST resolves.
  status = { ...status, version: "24.11.2026", run_id: "run-2" };
  currentStream().drop();
  assert.equal(get(store).phase, "reconnecting");
  assert.equal(get(store).restarting, true);

  // When POST resolves 200 OK while reconnecting, it skips waiting and reconnects immediately.
  finishPost({ instance: "default", status: "restarted", version: "24.11.2026" });
  await settle();
  await settle();
  await settle();

  assert.equal(get(store).phase, "connected");
  assert.equal(get(store).restarting, false);
  assert.equal(get(store).runId, "run-2");
  assert.equal(get(store).version, "24.11.2026");
  assert.equal(get(store).owned, true);
  assert.deepEqual(claimed, [["local", "run-2"]]);
  assert.deepEqual(timers.waits(), []);
});

test("switching connections while POST /service/restart is in flight ignores the late response", async () => {
  const status = {
    version: "24.11.2026",
    api: 1,
    run_id: "run-1",
    project: "/p/app.marasi",
    proxy_listener: "127.0.0.1:8080",
  };
  let finishPost;

  const { store } = await setup({
    activeId: "local",
    owned: true,
    routes: {
      "GET /service/status": () => status,
      "POST /service/restart": () =>
        new Promise((resolve) => {
          finishPost = resolve;
        }),
    },
  });

  store.restart();
  await settle();
  await settle();
  assert.equal(get(store).restarting, true);

  store.switchTo("remote-1");
  await reached(store, "connected");
  await settle();

  // Late failure from the old connection must not touch the newly active remote.
  finishPost(refusal(500, { error: "restart_failed", message: "stale failure" }));
  await settle();
  await settle();

  const state = get(store);
  assert.equal(state.connection.id, "remote-1");
  assert.equal(state.phase, "connected");
  assert.equal(state.restarting, false);
  assert.equal(state.restartError, null);
});
