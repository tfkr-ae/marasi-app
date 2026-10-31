import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDevBridge } from "./devBridge.js";

const token = "a".repeat(64);

// Serves `handler` on a free loopback port; resolves to its origin and a close.
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

// A fake instance's control listener, which records each request's
// method, path, Authorization header and body.
async function fakeInstance(answer = (req, res) => res.end(JSON.stringify({ ok: true }))) {
  const seen = [];
  const listener = await serve((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body });
      answer(req, res);
    });
  });
  return { ...listener, seen };
}

// A fake socket `call` for instances `running`, by name, each with the
// control listener at `origin`.
function fakeSockets(running) {
  const calls = [];
  const call = async (socketPath, method, path) => {
    calls.push([socketPath, method, path]);
    const instance = socketPath.split("/").pop().replace(/\.sock$/, "");
    const origin = running[instance];
    if (!origin) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    if (path === "/service/status") {
      return { status: 200, body: { status: "running", instance, control_listener: origin.replace("http://", "") } };
    }
    if (path === "/service/control-listener/token") return { status: 200, body: { token } };
    return { status: 404, body: null };
  };
  const readdir = async () => Object.keys(running).map((name) => `${name}.sock`);
  return { call, readdir, calls };
}

// The dev server: the bridge, and 404 for what it passes on.
async function devServer(bridge) {
  return serve((req, res) => bridge.handle(req, res, () => {
    res.statusCode = 404;
    res.end("not the bridge");
  }));
}

async function setup(running) {
  const instance = await fakeInstance();
  const sockets = fakeSockets(Object.fromEntries(running.map((name) => [name, instance.origin])));
  const bridge = createDevBridge({ configDir: "/cfg", call: sockets.call, readdir: sockets.readdir });
  const dev = await devServer(bridge);
  return { instance, sockets, dev, close: () => Promise.all([instance.close(), dev.close()]) };
}

const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("a call through the connected instance's base URL carries its control token", async (t) => {
  const { instance, dev, close } = await setup(["default"]);
  t.after(close);

  const connection = await (await post(`${dev.origin}/__marasi/connect`, { instance: "default" })).json();
  const answer = await fetch(`${dev.origin}${connection.baseURL}/launchpads?x=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "probe" }),
  });

  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { ok: true });
  assert.deepEqual(instance.seen, [
    { method: "POST", path: "/launchpads?x=1", authorization: `Bearer ${token}`, body: '{"name":"probe"}' },
  ]);
});

test("the bridge lists the running instances and keeps the connection across a reload until a disconnect", async (t) => {
  const { dev, close } = await setup(["default", "web"]);
  t.after(close);

  const listed = await (await fetch(`${dev.origin}/__marasi/instances`)).json();
  assert.deepEqual(listed.map((item) => item.instance), ["default", "web"]);
  assert.equal(await (await fetch(`${dev.origin}/__marasi/connection`)).json(), null);

  await post(`${dev.origin}/__marasi/connect`, { instance: "web" });
  assert.deepEqual(await (await fetch(`${dev.origin}/__marasi/connection`)).json(), {
    instance: "web",
    baseURL: "/__marasi/instance",
    loopbackTurnedOn: false,
  });

  await post(`${dev.origin}/__marasi/disconnect`);
  assert.equal(await (await fetch(`${dev.origin}/__marasi/connection`)).json(), null);
  const after = await fetch(`${dev.origin}/__marasi/instance/service/status`);
  assert.equal(after.status, 503);
  assert.deepEqual(await after.json(), { message: "Not connected to Marasi" });
});

test("a connect to an instance that isn't running answers why", async (t) => {
  const { dev, close } = await setup([]);
  t.after(close);

  const answer = await post(`${dev.origin}/__marasi/connect`, { instance: "default" });

  assert.equal(answer.status, 500);
  assert.deepEqual(await answer.json(), { message: "default isn't running" });
});

test("the instance's refusals and event stream pass through as they are", async (t) => {
  const instance = await fakeInstance((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": connected\n\n");
      res.write('event: log.added\ndata: {"message":"hi"}\n\n');
      return;
    }
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "launch_pending" }));
  });
  const sockets = fakeSockets({ default: instance.origin });
  const dev = await devServer(createDevBridge({ configDir: "/cfg", call: sockets.call, readdir: sockets.readdir }));
  const abort = new AbortController();
  t.after(() => {
    abort.abort();
    return Promise.all([instance.close(), dev.close()]);
  });
  await post(`${dev.origin}/__marasi/connect`, { instance: "default" });

  const refused = await fetch(`${dev.origin}/__marasi/instance/launch`, { method: "POST" });
  assert.equal(refused.status, 409);
  assert.equal(refused.headers.get("content-type"), "application/json");
  assert.deepEqual(await refused.json(), { error: "launch_pending" });

  // The stream stays open, so read until the event arrives.
  const events = await fetch(`${dev.origin}/__marasi/instance/events`, { signal: abort.signal });
  assert.equal(events.headers.get("content-type"), "text/event-stream");
  const reader = events.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!text.includes("log.added")) text += (await reader.read()).value;
  assert.match(text, /event: log\.added\ndata: \{"message":"hi"\}/);
  assert.equal(instance.seen.at(-1).authorization, `Bearer ${token}`);
});

test("requests that aren't the bridge's go on to the dev server", async (t) => {
  const { dev, close } = await setup(["default"]);
  t.after(close);

  const answer = await fetch(`${dev.origin}/__marasi-other`);

  assert.equal(answer.status, 404);
  assert.equal(await answer.text(), "not the bridge");
});

test("a stream the page closes is closed at the instance too", async (t) => {
  let closed;
  const streamClosed = new Promise((resolve) => (closed = resolve));
  const instance = await fakeInstance((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": connected\n\n");
    res.on("close", closed);
  });
  const sockets = fakeSockets({ default: instance.origin });
  const dev = await devServer(createDevBridge({ configDir: "/cfg", call: sockets.call, readdir: sockets.readdir }));
  t.after(() => Promise.all([instance.close(), dev.close()]));
  await post(`${dev.origin}/__marasi/connect`, { instance: "default" });

  const abort = new AbortController();
  const events = await fetch(`${dev.origin}/__marasi/instance/events`, { signal: abort.signal });
  await events.body.getReader().read();
  abort.abort();

  await streamClosed;
});

test("without a config directory the bridge reaches no instance and says how to name one", async (t) => {
  const sockets = fakeSockets({ default: "http://127.0.0.1:1" });
  const dev = await devServer(createDevBridge({ configDir: null, call: sockets.call, readdir: sockets.readdir }));
  t.after(dev.close);

  const listed = await fetch(`${dev.origin}/__marasi/instances`);
  const connected = await post(`${dev.origin}/__marasi/connect`, { instance: "default" });

  const why = { message: "Start the dev server with MARASI_CONFIG_DIR=DIR to reach the instances in DIR" };
  assert.equal(listed.status, 500);
  assert.deepEqual(await listed.json(), why);
  assert.deepEqual(await connected.json(), why);
  assert.deepEqual(sockets.calls, []);
});

test("app config calls answer as the main process's do, and profile files stay with the app", async (t) => {
  const sockets = fakeSockets({});
  const calls = [];
  const appConfig = {
    keybindings: async () => ({ config: { active: "Default" } }),
    setFlag: async (name, value) => {
      calls.push([name, value]);
      if (name === "nope") throw new Error("unknown flag nope");
    },
  };
  const dev = await devServer(createDevBridge({ configDir: "/cfg", call: sockets.call, readdir: sockets.readdir, appConfig }));
  t.after(dev.close);

  const read = await post(`${dev.origin}/__marasi/app-config/keybindings`, []);
  const set = await post(`${dev.origin}/__marasi/app-config/setFlag`, ["vim_enabled", true]);
  const refused = await post(`${dev.origin}/__marasi/app-config/setFlag`, ["nope", 1]);
  const file = await post(`${dev.origin}/__marasi/app-config/importProfile`, []);

  assert.deepEqual(await read.json(), { value: { config: { active: "Default" } } });
  assert.deepEqual(await set.json(), {});
  assert.deepEqual(await refused.json(), { error: "unknown flag nope" });
  assert.deepEqual(await file.json(), { error: "Open Marasi v2 to import or export a profile" });
  assert.deepEqual(calls, [["vim_enabled", true], ["nope", 1]]);
});
