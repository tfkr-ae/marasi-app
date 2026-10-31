import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createLocalConnections } from "./local.js";

const configDir = join("/cfg", "Marasi");
const instancesDir = join(configDir, "instances");
const bundled = "/app/resources/bin/marasi";

const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

// A fake machine: `running` maps each running instance to its control
// listener (null for none). `run` is the process runner: it fakes Marasi's
// `service start`, recording each command line, and `call` the socket.
// With `portBusy`, a start on Marasi's default proxy port fails.
function fakeMachine(running = {}, { portBusy = false } = {}) {
  const instances = new Map(Object.entries(running));
  const commands = [];
  const stopped = [];
  let nextPort = 50100;
  const run = async (file, args) => {
    commands.push([file, ...args]);
    const instance = args[args.indexOf("--instance") + 1];
    assert.deepEqual(args.slice(0, 2), ["--config-dir", configDir]);
    if (instances.has(instance)) {
      const error = `instance ${instance} is already running`;
      throw Object.assign(new Error("Command failed: exit status 1"), { stdout: JSON.stringify({ error }) + "\n" });
    }
    if (portBusy && !args.includes("--port")) {
      const error = "binding proxy listener on address 127.0.0.1 port 8080: bind: address already in use";
      throw Object.assign(new Error("Command failed: exit status 1"), { stdout: JSON.stringify({ error }) + "\n" });
    }
    const control = `127.0.0.1:${nextPort++}`;
    instances.set(instance, control);
    return { stdout: JSON.stringify({ instance, proxy_listener: "127.0.0.1:8080", control_listener: control }) + "\n" };
  };
  const call = async (socketPath, method, path) => {
    const instance = socketPath.slice(instancesDir.length + 1).replace(/\.sock$/, "");
    if (!instances.has(instance)) throw refused;
    const control = instances.get(instance);
    if (method === "GET" && path === "/service/status") {
      return { status: 200, body: { status: "running", instance, control_listener: control } };
    }
    if (method === "POST" && path === "/service/control-listener/start") {
      instances.set(instance, "127.0.0.1:50999");
      return { status: 200, body: { status: "active", control_listener: "127.0.0.1:50999" } };
    }
    if (method === "GET" && path === "/service/control-listener/token") return { status: 200, body: { token: `token-${instance}` } };
    if (method === "POST" && path === "/service/stop") {
      stopped.push(instance);
      instances.delete(instance);
      return { status: 202, body: { status: "shutdown_in_progress" } };
    }
    return { status: 404, body: null };
  };
  return { run, call, commands, stopped, instances };
}

const local = (machine, marasiBin = () => bundled) =>
  createLocalConnections({ configDir, run: machine.run, call: machine.call, marasiBin });

test("a first launch with no instance running starts default on the scratchpad and connects", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  const connection = await connections.startup(1);
  assert.deepEqual(machine.commands, [
    [bundled, "--config-dir", configDir, "--instance", "default", "--json", "service", "start", "--control-address", "127.0.0.1:0"],
  ]);
  assert.deepEqual(connection, {
    instance: "default",
    origin: "http://127.0.0.1:50100",
    token: "token-default",
    loopbackTurnedOn: false,
  });
  assert.equal(connections.get(1), connection);
});

test("a launch while a CLI-started default is running connects to it, and quitting leaves it running", async () => {
  const machine = fakeMachine({ default: "127.0.0.1:50037" });
  const connections = local(machine);
  const connection = await connections.startup(1);
  assert.equal(machine.commands.length, 0);
  assert.equal(connection.origin, "http://127.0.0.1:50037");
  assert.deepEqual(await connections.quit(), []);
  assert.deepEqual(machine.stopped, []);
});

test("quitting stops an instance the app started, even after its window closed", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  await connections.startup(1);
  connections.forget(1);
  assert.equal(connections.get(1), undefined);
  assert.deepEqual(await connections.quit(), ["default"]);
  assert.deepEqual(machine.stopped, ["default"]);
});

test("disconnecting from an instance the app started leaves it running at quit", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  await connections.startup(1);
  connections.disconnect(1);
  assert.equal(connections.get(1), undefined);
  assert.ok(machine.instances.has("default"));
  assert.deepEqual(await connections.quit(), []);
  assert.deepEqual(machine.stopped, []);
});

test("startup connects a window once: after a disconnect and a reload, it has no connection", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  await connections.startup(1);
  connections.disconnect(1);
  assert.equal(await connections.startup(1), null);
  assert.equal(machine.commands.length, 1);
});

test("startup takes up the window's connection after a reload, marked resumed", async () => {
  const machine = fakeMachine({ default: "127.0.0.1:50037" });
  const connections = local(machine);
  const first = await connections.startup(1);
  assert.equal(first.resumed, undefined);
  assert.deepEqual(await connections.startup(1), { ...first, resumed: true });
});

test("a window opened for another instance starts with no connection and starts nothing", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  connections.open(2);
  assert.equal(await connections.startup(2), null);
  assert.deepEqual(machine.commands, []);
});

test("a launch whose default can't take the proxy port starts it on a free one", async () => {
  const machine = fakeMachine({}, { portBusy: true });
  const connections = local(machine);
  const connection = await connections.startup(1);
  assert.equal(connection.instance, "default");
  assert.deepEqual(machine.commands.at(-1).slice(-4), ["--control-address", "127.0.0.1:0", "--port", "0"]);
  assert.deepEqual(await connections.quit(), ["default"]);
});

test("Start with a name starts a second instance on the project and connects the window to it", async () => {
  const machine = fakeMachine({ default: "127.0.0.1:50037" });
  const connections = local(machine);
  await connections.startup(1);
  const connection = await connections.start(2, { instance: "acme", project: "/work/acme.marasi" });
  assert.deepEqual(machine.commands, [
    [bundled, "--config-dir", configDir, "--instance", "acme", "--json", "service", "start", "--control-address", "127.0.0.1:0", "--port", "0", "--project", "/work/acme.marasi"],
  ]);
  assert.equal(connection.instance, "acme");
  assert.equal(connection.origin, "http://127.0.0.1:50100");
  assert.equal(connections.get(2), connection);
  assert.deepEqual(await connections.quit(), ["acme"]);
});

test("Start refused by Marasi rejects with Marasi's reason and owns nothing", async () => {
  const machine = fakeMachine({ acme: "127.0.0.1:50037" });
  const connections = local(machine);
  await assert.rejects(connections.start(1, { instance: "acme", project: null }), { message: "instance acme is already running" });
  assert.equal(connections.get(1), undefined);
  assert.deepEqual(await connections.quit(), []);
});

test("with a Marasi from a path chosen, Start runs that binary", async () => {
  const machine = fakeMachine();
  let chosen = null;
  const connections = local(machine, () => chosen ?? bundled);
  chosen = "/opt/marasi-dev/marasi";
  await connections.start(1, { instance: "acme", project: null });
  assert.equal(machine.commands[0][0], "/opt/marasi-dev/marasi");
});

test("connecting a window to a running instance takes no ownership of it", async () => {
  const machine = fakeMachine({ acme: null });
  const connections = local(machine);
  const connection = await connections.connect(1, "acme");
  assert.equal(connection.loopbackTurnedOn, true);
  assert.equal(connections.get(1), connection);
  assert.deepEqual(await connections.quit(), []);
});

test("a remote named like an instance the app started doesn't keep that instance running at quit", async () => {
  const machine = fakeMachine();
  const connections = local(machine);
  await connections.startup(1);
  const remote = { instance: "default", origin: "http://10.1.26.31:7070", token: "t", remote: true, loopbackTurnedOn: false };
  connections.use(2, remote);
  assert.equal(connections.get(2), remote);
  // The remote isn't the local default: disconnecting window 1 leaves
  // the default running at quit, as with no other window.
  connections.disconnect(1);
  assert.deepEqual(await connections.quit(), []);
  connections.disconnect(2);
  assert.equal(connections.get(2), undefined);
});
