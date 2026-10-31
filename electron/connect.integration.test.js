// Starts a real Marasi on a temporary config directory and connects to it
// the way a window does: discovery and the token through the socket, the
// header the session adds, and the renderer's client module. Marasi is
// MARASI_BIN, or the bundled Marasi in resources/bin; with neither, the
// suite is skipped.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectLocal, listLocalInstances } from "./instances.js";
import { callSocket, streamSocket } from "./socket.js";
import { createRemotes } from "./remotes.js";
import { watchToken } from "./tokenWatch.js";
import { withBearer } from "./bearer.js";
import { createMarasiClient, isNeedsNewerMarasi } from "../frontend/src/lib/bindings/marasi.js";
import { codeIDs } from "../frontend/src/lib/errorCodes.js";
import { createEventStream } from "../frontend/src/lib/eventStream.js";
import { createLogStore } from "../frontend/src/stores/createLogStore.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const marasiBin = process.env.MARASI_BIN || join(root, "resources", "bin", process.platform === "win32" ? "marasi.exe" : "marasi");
const skip = existsSync(marasiBin) ? false : `no Marasi at ${marasiBin}; set MARASI_BIN`;

let configDir;
const instance = "itest";
const marasi = (...args) => run(marasiBin, ["--config-dir", configDir, "--instance", instance, "--json", ...args]);

// The fetch a connected window makes: the session adds the token to
// requests to its instance's origin.
const windowFetch = (connection) => (url, init = {}) =>
  fetch(url, {
    ...init,
    headers: withBearer({ url: String(url), webContentsId: 1, requestHeaders: init.headers ?? {} }, (id) =>
      id === 1 ? connection : null,
    ),
  });

before(async () => {
  if (skip) return;
  // A short path: the instance's socket path must stay under 104 bytes.
  configDir = await mkdtemp("/tmp/mv2.");
  // No network address, so connecting turns one on.
  await marasi("service", "start", "--port", "0");
});

after(async () => {
  if (skip || !configDir) return;
  await marasi("service", "stop").catch(() => {});
  await rm(configDir, { recursive: true, force: true });
});

let connection;

test("discovery lists the running instance with its project, version and listener", { skip }, async () => {
  const items = await listLocalInstances({ configDir, readdir, call: callSocket });
  assert.equal(items.length, 1);
  assert.equal(items[0].instance, instance);
  assert.match(items[0].project, /scratchpad\.marasi$/);
  assert.ok(items[0].version);
  assert.match(items[0].proxy_listener, /^127\.0\.0\.1:\d+$/);
  assert.equal(items[0].control_listener, null);
});

test("connecting turns on a loopback address and fetches the status through the client", { skip }, async () => {
  connection = await connectLocal({ configDir, instance, call: callSocket });
  assert.equal(connection.loopbackTurnedOn, true);
  assert.match(connection.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const status = await client.get("/service/status");
  assert.equal(status.instance, instance);
  assert.equal(`http://${status.control_listener}`, connection.origin);
});

test("connecting again keeps the network address it has", { skip }, async () => {
  const again = await connectLocal({ configDir, instance, call: callSocket });
  assert.equal(again.loopbackTurnedOn, false);
  assert.equal(again.origin, connection.origin);
  assert.equal(again.token, connection.token);
});

test("the network address needs the header the session adds", { skip }, async () => {
  const bare = await fetch(`${connection.origin}/service/status`);
  assert.equal(bare.status, 401);
  // Only the window's own instance gets the token.
  const elsewhere = withBearer(
    { url: "http://127.0.0.1:1/service/status", webContentsId: 1, requestHeaders: {} },
    () => connection,
  );
  assert.equal(elsewhere.Authorization, undefined);
});

test("a coded refusal reaches the caller as an error the code helpers read", { skip }, async () => {
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const error = await client.post("/project/open", {}).then(
    () => assert.fail("opened"),
    (err) => err,
  );
  assert.equal(error.status, 400);
  assert.deepEqual(codeIDs(error, "invalid_project_request"), []);
});

test("an unknown route reads Needs a newer Marasi", { skip }, async () => {
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const error = await client.get("/no-such-route").then(
    () => assert.fail("answered"),
    (err) => err,
  );
  assert.ok(isNeedsNewerMarasi(error));
  assert.equal(String(error), "Needs a newer Marasi");
});

// An EventSource on fetch, as Node has none: it sends the header the
// session adds, as a window's stream gets it. drop() cuts every open
// stream, as a network blip does.
function windowEventSource(connection) {
  const open = new Set();
  class WindowEventSource {
    constructor(url) {
      this.listeners = {};
      this.abort = new AbortController();
      open.add(this);
      this.read(url).catch(() => this.fire("error", {}));
    }
    addEventListener(name, listener) {
      (this.listeners[name] ??= []).push(listener);
    }
    fire(name, event) {
      if (this.closed && name !== "error") return;
      for (const listener of this.listeners[name] ?? []) listener(event);
    }
    close() {
      this.closed = true;
      open.delete(this);
      this.abort.abort();
    }
    async read(url) {
      const response = await windowFetch(connection)(url, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.fire("open", {});
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = frame.match(/^event: (.*)$/m)?.[1];
          const data = frame.match(/^data: (.*)$/m)?.[1];
          if (name && data !== undefined) this.fire(name, { data });
        }
      }
      throw new Error("stream ended");
    }
  }
  return {
    WindowEventSource,
    drop: () => {
      for (const source of open) source.abort.abort();
    },
  };
}

// A Svelte store's current value.
function get(store) {
  let value;
  store.subscribe((current) => (value = current))();
  return value;
}

// Waits up to `ms` for `check()` to hold.
async function until(check, ms = 10000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail("timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Restarts the proxy listener, which Marasi logs as "Marasi Service
// Started on <address>". Resolves to that line's address.
async function restartListener(client) {
  await client.post("/listener/stop");
  const status = await client.post("/listener/start", { address: "127.0.0.1", port: 0 });
  return status.proxy_listener;
}

test("the log follows the event stream, and reloads after the stream reopens", { skip }, async () => {
  const client = createMarasiClient({ baseURL: connection.origin, fetch: windowFetch(connection) });
  const log = createLogStore({
    getLogs: (cursor) => client.get(`/logs?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  });
  await log.reload();
  const { WindowEventSource, drop } = windowEventSource(connection);
  let opens = 0;
  let reloads = 0;
  const stream = createEventStream({
    url: `${connection.origin}/events`,
    handlers: { "log.added": (line) => log.onLogAdded(line) },
    onReconnect: () => {
      reloads++;
      return log.reload();
    },
    EventSource: class extends WindowEventSource {
      constructor(url) {
        super(url);
        this.addEventListener("open", () => opens++);
      }
    },
  });
  const shows = (address) => get(log).items.some((line) => line.message === `Marasi Service Started on ${address}`);
  try {
    await until(() => opens === 1);
    // A round trip: the line arrives as log.added.
    const live = await restartListener(client);
    await until(() => shows(live));

    // While the stream is down the line has no event to arrive on, so it
    // shows only once the reopened stream reloads the log.
    drop();
    const missed = await restartListener(client);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(shows(missed), false);
    await until(() => reloads === 1 && shows(missed));
    assert.ok(shows(live));
    const ids = get(log).items.map((line) => line.id);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    stream.stop();
  }
});

test("connecting by address and token reaches the instance as a remote does", { skip }, async () => {
  const remotes = createRemotes({ appConfig: null, safeStorage: null, fetch });
  const remote = await remotes.connect({ url: connection.origin, token: connection.token, name: "lab" });
  assert.equal(remote.instance, "lab");
  await assert.rejects(remotes.connect({ url: connection.origin, token: "0".repeat(64) }), (err) => err.tokenRefused);
});

test("a rotated token is read again for a local window and asked for by a remote one", { skip }, async () => {
  const local = { ...connection };
  const remote = { ...connection, instance: "lab", remote: true };
  const localWatch = watchToken(local, { configDir, streamSocket, call: callSocket });
  let refused;
  const asked = new Promise((resolve) => (refused = resolve));
  watchToken(remote, { fetch, onRefused: refused });
  // Both streams are open before the rotation.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rotated = await callSocket(join(configDir, "instances", `${instance}.sock`), "POST", "/service/control-listener/token/rotate");
  assert.equal(rotated.status, 200);
  await asked;
  for (let i = 0; i < 50 && local.token === connection.token; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  localWatch.stop();
  assert.equal(local.token, rotated.body.token);
  const client = createMarasiClient({ baseURL: local.origin, fetch: windowFetch(local) });
  assert.equal((await client.get("/service/status")).instance, instance);
});
