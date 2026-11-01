import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { connectLocal, listLocalInstances, stopLocal } from "./instances.js";

const configDir = join("/cfg", "Marasi");
const instancesDir = join(configDir, "instances");

const status = (instance, extra = {}) => ({
  status: "running",
  version: "v2-backlog-3a55b06 (dev)",
  channel: null,
  instance,
  project: `/cfg/Marasi/projects/${instance}.marasi`,
  proxy_listener: "127.0.0.1:8080",
  restart_required: false,
  control_listener: null,
  os: "darwin",
  ...extra,
});

const refused = (code) => Object.assign(new Error(`connect ${code}`), { code });

// A fake instances directory, and a socket call that answers each socket
// with `answers[name](method, path, body)`, recording every call.
function fakeMachine(files, answers) {
  const calls = [];
  const readdir = async (dir) => {
    assert.equal(dir, instancesDir);
    if (!files) throw refused("ENOENT");
    return files;
  };
  const call = async (socketPath, method, path, body) => {
    calls.push({ socketPath, method, path, body });
    const name = socketPath.slice(instancesDir.length + 1).replace(/\.sock$/, "");
    const answer = answers[name];
    if (!answer) throw refused("ECONNREFUSED");
    return answer(method, path, body);
  };
  return { readdir, call, calls };
}

test("each running instance is listed with its status", async () => {
  const { readdir, call, calls } = fakeMachine(["default.sock", "default.lock", "default.log", "acme.sock", "acme.token"], {
    default: () => ({ status: 200, body: status("default") }),
    acme: () => ({ status: 200, body: status("acme", { proxy_listener: null }) }),
  });
  const items = await listLocalInstances({ configDir, readdir, call });
  assert.deepEqual(
    items.map((item) => [item.instance, item.project, item.version, item.proxy_listener]),
    [
      ["acme", "/cfg/Marasi/projects/acme.marasi", "v2-backlog-3a55b06 (dev)", null],
      ["default", "/cfg/Marasi/projects/default.marasi", "v2-backlog-3a55b06 (dev)", "127.0.0.1:8080"],
    ],
  );
  assert.ok(calls.every((c) => c.method === "GET" && c.path === "/service/status"));
  assert.equal(calls.find((c) => c.socketPath.endsWith("default.sock")).socketPath, join(instancesDir, "default.sock"));
});

test("a socket that refuses the dial is a stopped instance and is left out", async () => {
  const { readdir, call } = fakeMachine(["stale.sock", "default.sock"], {
    default: () => ({ status: 200, body: status("default") }),
  });
  const items = await listLocalInstances({ configDir, readdir, call });
  assert.deepEqual(
    items.map((item) => item.instance),
    ["default"],
  );
});

test("an instance that answers badly is listed as unhealthy", async () => {
  const { readdir, call } = fakeMachine(["slow.sock", "odd.sock"], {
    slow: () => {
      throw refused("ETIMEDOUT");
    },
    odd: () => ({ status: 500, body: { error: "internal_server_error" } }),
  });
  const items = await listLocalInstances({ configDir, readdir, call });
  assert.deepEqual(items, [
    { status: "unhealthy", instance: "odd" },
    { status: "unhealthy", instance: "slow" },
  ]);
});

test("no instances directory lists no instances", async () => {
  const { readdir, call } = fakeMachine(null, {});
  assert.deepEqual(await listLocalInstances({ configDir, readdir, call }), []);
});

test("connecting reads the token through the socket and uses the network address", async () => {
  const { call, calls } = fakeMachine([], {
    default: (method, path) => {
      if (path === "/service/status") return { status: 200, body: status("default", { control_listener: "127.0.0.1:50037" }) };
      if (path === "/service/control-listener/token") return { status: 200, body: { token: "a".repeat(64) } };
      return { status: 404, body: null };
    },
  });
  const connection = await connectLocal({ configDir, instance: "default", call });
  assert.deepEqual(connection, {
    instance: "default",
    origin: "http://127.0.0.1:50037",
    token: "a".repeat(64),
    loopbackTurnedOn: false,
  });
  assert.ok(!calls.some((c) => c.method === "POST"));
});

test("connecting to an instance with no network address turns one on at loopback", async () => {
  const { call, calls } = fakeMachine([], {
    default: (method, path, body) => {
      if (path === "/service/status") return { status: 200, body: status("default") };
      if (method === "POST" && path === "/service/control-listener/start") {
        assert.deepEqual(body, { address: "127.0.0.1", port: 0 });
        return { status: 200, body: { status: "active", control_listener: "127.0.0.1:61000" } };
      }
      if (path === "/service/control-listener/token") return { status: 200, body: { token: "b".repeat(64) } };
      return { status: 404, body: null };
    },
  });
  const connection = await connectLocal({ configDir, instance: "default", call });
  assert.equal(connection.origin, "http://127.0.0.1:61000");
  assert.equal(connection.loopbackTurnedOn, true);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("an instance listening on every address is reached at loopback", async () => {
  for (const [listener, origin] of [
    ["0.0.0.0:4000", "http://127.0.0.1:4000"],
    ["[::]:4000", "http://[::1]:4000"],
    ["192.168.1.5:4000", "http://192.168.1.5:4000"],
  ]) {
    const { call } = fakeMachine([], {
      default: (method, path) =>
        path === "/service/status"
          ? { status: 200, body: status("default", { control_listener: listener }) }
          : { status: 200, body: { token: "c".repeat(64) } },
    });
    assert.equal((await connectLocal({ configDir, instance: "default", call })).origin, origin);
  }
});

test("a refused connect names Marasi's code", async () => {
  const { call } = fakeMachine([], {
    default: (method, path) =>
      path === "/service/status"
        ? { status: 200, body: status("default") }
        : { status: 409, body: { error: "listener_unavailable", message: "address in use" } },
  });
  await assert.rejects(connectLocal({ configDir, instance: "default", call }), /listener_unavailable: address in use/);
});

test("connecting to an instance that isn't running says so", async () => {
  const { call } = fakeMachine([], {});
  await assert.rejects(connectLocal({ configDir, instance: "gone", call }), /gone isn't running/);
});

test("a name that isn't an instance name reaches no socket", async () => {
  const { call, calls } = fakeMachine([], {});
  for (const instance of ["../x", "a/b", "a\\b", "..", ".", "", "x.sock", 7]) {
    await assert.rejects(connectLocal({ configDir, instance, call }), /not an instance name/);
  }
  assert.equal(calls.length, 0);
});

// An instance stopping as Marasi does: its socket answers a few more times,
// then its network address, which closes after the locks are released.
function stoppingInstance({ socketPolls, networkPolls, listener = "127.0.0.1:50037" }) {
  const events = [];
  let stopAsked = false;
  const { call } = fakeMachine([], {
    default: (method, path) => {
      if (stopAsked && socketPolls-- <= 0) throw refused("ENOENT");
      if (path === "/service/status") return { status: 200, body: status("default", { control_listener: listener }) };
      if (path === "/service/control-listener/token") return { status: 200, body: { token: "t".repeat(64) } };
      if (method === "POST" && path === "/service/stop") {
        stopAsked = true;
        return { status: 202, body: { status: "shutdown_in_progress" } };
      }
      return { status: 404, body: null };
    },
  });
  const fetch = async (url, init) => {
    assert.equal(url, `http://${listener}/service/status`);
    assert.equal(init.headers.Authorization, `Bearer ${"t".repeat(64)}`);
    if (!stopAsked || networkPolls-- > 0) return new Response(JSON.stringify(status("default")), { status: 200 });
    events.push("released");
    throw Object.assign(new TypeError("fetch failed"), { cause: refused("ECONNREFUSED") });
  };
  return { call, fetch, events };
}

test("stopping waits until the instance has released its locks, as marasi service stop does", async () => {
  const machine = stoppingInstance({ socketPolls: 2, networkPolls: 3 });
  await stopLocal({ configDir, instance: "default", call: machine.call, fetch: machine.fetch, pollMs: 1 });
  assert.deepEqual(machine.events, ["released"]);
});

test("stopping an instance with no network address waits for its socket to go", async () => {
  let stopAsked = false;
  let polls = 3;
  const { call } = fakeMachine([], {
    default: (method, path) => {
      if (stopAsked && polls-- <= 0) throw refused("ENOENT");
      if (method === "POST" && path === "/service/stop") stopAsked = true;
      return { status: 200, body: status("default") };
    },
  });
  await stopLocal({ configDir, instance: "default", call, fetch: () => assert.fail("no network address"), pollMs: 1 });
  assert.equal(polls, -1);
});

test("stopping gives up when the instance doesn't stop in time", async () => {
  const machine = stoppingInstance({ socketPolls: Infinity, networkPolls: Infinity });
  await assert.rejects(
    stopLocal({ configDir, instance: "default", call: machine.call, fetch: machine.fetch, pollMs: 1, timeoutMs: 20 }),
    /default didn't stop/,
  );
});
